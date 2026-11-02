'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WaitBudget, ExecutionSlots, Semaphore } = require('../src/admission-control');
const entry = id => ({ account: { id } });

function take(slots, id, options = {}) {
  return slots.acquireAccount(() => slots.available('test', id) ? entry(id) : null, { provider: 'test', ...options });
}

test('global and cross-model account capacity reserve atomically; releases are idempotent', async () => {
  const slots = new ExecutionSlots({ limit: 60, accountLimit: 5 });
  const leases = await Promise.all(Array.from({ length: 5 }, () => take(slots, 'account')));
  assert.equal(slots.active, 5); assert.equal(slots.available('test', 'account'), false);
  const other = await take(slots, 'other'); assert.equal(slots.active, 6);
  for (const lease of [...leases, other]) { lease.release(); lease.release(); }
  assert.equal(slots.active, 0); assert.equal(slots.accounts.size, 0);
});

test('oldest runnable request proceeds past a blocked model without spending a global slot waiting', async () => {
  const budget = new WaitBudget({ limit: 2 });
  const slots = new ExecutionSlots({ limit: 2, accountLimit: 1, budget });
  const a = await take(slots, 'a'), b = await take(slots, 'b');
  let aStarted = false;
  const queuedA = take(slots, 'a').then(lease => { aStarted = true; return lease; });
  const queuedC = take(slots, 'c');
  assert.equal(budget.size, 2); b.release();
  const c = await queuedC; assert.equal(c.entry.account.id, 'c'); assert.equal(aStarted, false);
  assert.equal(slots.active, 2); assert.equal(budget.size, 1);
  a.release(); const nextA = await queuedA; c.release(); nextA.release();
  assert.equal(slots.active, 0); assert.equal(budget.size, 0);
});

test('all queues share one capacity, and abort frees it without leaking listeners or slots', async () => {
  const budget = new WaitBudget({ limit: 1 });
  const slots = new ExecutionSlots({ limit: 1, budget });
  const media = new Semaphore(1, 120, budget);
  const running = await slots.acquire(), releaseMedia = await media.acquire();
  const controller = new AbortController();
  const waiting = slots.acquire(controller.signal);
  await assert.rejects(media.acquire(), { code: 'gateway_busy', status: 429 });
  controller.abort(); await assert.rejects(waiting, { name: 'AbortError' });
  assert.equal(budget.size, 0); assert.equal(slots.waiters.length, 0);
  running(); releaseMedia(); assert.equal(slots.active, 0); assert.equal(media.active, 0);
});

test('queue timeout returns 429 and removes the waiter; no delayed execution follows', async () => {
  const budget = new WaitBudget({ timeoutMs: 20 });
  const slots = new ExecutionSlots({ limit: 1, budget });
  const release = await slots.acquire();
  await assert.rejects(slots.acquire(), { code: 'queue_timeout', status: 429 });
  assert.equal(slots.waiters.length, 0); assert.equal(budget.size, 0);
  release(); assert.equal(slots.active, 0);
});

test('cumulative waiting budget is shared across admission stages, excluding running time', async t => {
  let now = 1000; t.mock.method(Date, 'now', () => now);
  const budget = new WaitBudget({ timeoutMs: 30 }); const signal = new AbortController().signal;
  const leave = budget.enter(signal, () => assert.fail('manual accounting test timed out'));
  now += 25; leave(); now += 1000;
  const leaveNext = budget.enter(signal, () => assert.fail('manual accounting test timed out'));
  now += 5; leaveNext();
  assert.throws(() => budget.enter(signal, () => {}), { code: 'queue_timeout' });
  assert.equal(budget.size, 0);
});
