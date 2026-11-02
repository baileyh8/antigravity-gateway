'use strict';

function positive(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum ? number : fallback;
}
const ACCOUNT_CONCURRENCY = positive(process.env.ANTIGRAVITY_GATEWAY_ACCOUNT_CONCURRENCY, 5);
const MAX_CONCURRENCY = positive(process.env.ANTIGRAVITY_GATEWAY_MAX_CONCURRENCY,
  process.env.ANTIGRAVITY_GATEWAY_TRANSPORT === 'agy' ? 4 : 60);
const MAX_QUEUE = positive(process.env.ANTIGRAVITY_GATEWAY_MAX_QUEUE, 120, 0);
const QUEUE_TIMEOUT_MS = positive(process.env.ANTIGRAVITY_GATEWAY_QUEUE_TIMEOUT_MS, 30_000);
class AdmissionError extends Error {
  constructor(message, code, status = 429) { super(message); this.name = 'AdmissionError'; this.code = code; this.status = status; }
}

function abortFailure(signal) {
  const reason = signal?.reason;
  if (reason && !(reason.name === 'AbortError' && typeof reason.code === 'number')) return reason;
  const error = new AdmissionError('请求已取消。', 'request_aborted', 499);
  error.name = 'AbortError'; return error;
}

// All admission stages share one bounded queue and cumulative wait budget.
// No account IDs, request bodies or credentials are copied into this registry.
class WaitBudget {
  constructor({ limit = MAX_QUEUE, timeoutMs = QUEUE_TIMEOUT_MS } = {}) {
    this.limit = limit; this.timeoutMs = timeoutMs; this.queued = new Map(); this.elapsed = new WeakMap();
  }
  enter(signal, reject) {
    if (signal?.aborted) throw abortFailure(signal);
    const key = signal || {};
    if (!this.queued.has(key) && this.queued.size >= this.limit) throw new AdmissionError('网关排队已满。', 'gateway_busy');
    const remaining = this.timeoutMs - (this.elapsed.get(key) || 0);
    if (remaining <= 0) throw new AdmissionError('排队等待超过期限。', 'queue_timeout');
    this.queued.set(key, (this.queued.get(key) || 0) + 1);
    const started = Date.now(); let done = false;
    const leave = () => {
      if (done) return false;
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      this.elapsed.set(key, (this.elapsed.get(key) || 0) + Date.now() - started);
      const count = this.queued.get(key) - 1;
      if (count) this.queued.set(key, count); else this.queued.delete(key);
      return true;
    };
    const abort = () => { if (leave()) reject(abortFailure(signal)); };
    const timer = setTimeout(() => { if (leave()) reject(new AdmissionError('排队等待超过期限。', 'queue_timeout')); }, remaining);
    signal?.addEventListener('abort', abort, { once: true });
    return leave;
  }
  get size() { return this.queued.size; }
}
const waitBudget = new WaitBudget();

class Semaphore {
  constructor(limit, maxQueue = MAX_QUEUE, budget = waitBudget) {
    this.limit = limit; this.maxQueue = maxQueue; this.budget = budget; this.active = 0; this.waiters = [];
  }
  take() {
    this.active++; let released = false;
    return () => { if (released) return; released = true; this.active--; this.drain(); };
  }
  acquire(signal) {
    if (signal?.aborted) return Promise.reject(abortFailure(signal));
    if (this.active < this.limit) return Promise.resolve(this.take());
    if (this.waiters.length >= this.maxQueue) return Promise.reject(new AdmissionError('网关排队已满。', 'gateway_busy'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, leave: null };
      const fail = error => { this.waiters = this.waiters.filter(item => item !== waiter); reject(error); };
      waiter.leave = this.budget.enter(signal, fail);
      this.waiters.push(waiter);
    });
  }
  drain() {
    while (this.active < this.limit && this.waiters.length) {
      const waiter = this.waiters.shift(); waiter.leave(); waiter.resolve(this.take());
    }
  }
}

// Account and global slots are reserved together, before invoking the upstream.
// Scan oldest runnable waiters so a saturated model cannot block another model.
class ExecutionSlots {
  constructor({ limit = MAX_CONCURRENCY, accountLimit = ACCOUNT_CONCURRENCY, budget = waitBudget } = {}) {
    this.limit = limit; this.accountLimit = accountLimit; this.budget = budget;
    this.active = 0; this.accounts = new Map(); this.waiters = []; this.draining = false;
  }
  key(provider, id) { return `${provider}:${id}`; }
  available(provider, id) { return (this.accounts.get(this.key(provider, id)) || 0) < this.accountLimit; }
  reserve(entry, provider) {
    const key = provider ? this.key(provider, entry.account.id) : null;
    if (this.active >= this.limit || key && !this.available(provider, entry.account.id)) return null;
    this.active++; if (key) this.accounts.set(key, (this.accounts.get(key) || 0) + 1);
    let released = false;
    return { entry, release: () => {
      if (released) return;
      released = true; this.active--;
      if (key) { const n = this.accounts.get(key) - 1; if (n) this.accounts.set(key, n); else this.accounts.delete(key); }
      this.drain();
    } };
  }
  acquire(signal) {
    return this.acquireAccount(() => ({ account: { id: '' } }), { signal }).then(lease => lease.release);
  }
  acquireAccount(select, { signal, provider = '', hasCandidates = () => true } = {}) {
    if (signal?.aborted) return Promise.reject(abortFailure(signal));
    this.drain();
    if (this.active < this.limit) {
      try { const entry = select(); if (entry) return Promise.resolve(this.reserve(entry, provider)); }
      catch (error) { return Promise.reject(error); }
    }
    try { if (!hasCandidates()) return Promise.resolve(null); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const waiter = { select, provider, hasCandidates, resolve, reject, leave: null };
      const fail = error => { this.waiters = this.waiters.filter(item => item !== waiter); reject(error); };
      waiter.leave = this.budget.enter(signal, fail);
      this.waiters.push(waiter);
    });
  }
  drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let i = 0; i < this.waiters.length && this.active < this.limit;) {
        const waiter = this.waiters[i]; let entry, error, canWait;
        try { entry = waiter.select(); canWait = !entry && waiter.hasCandidates(); } catch (failure) { error = failure; }
        if (!error && !entry && canWait) { i++; continue; }
        this.waiters.splice(i, 1); waiter.leave();
        if (error) waiter.reject(error);
        else waiter.resolve(entry ? this.reserve(entry, waiter.provider) : null);
      }
    } finally { this.draining = false; }
  }
  snapshot() {
    return { active: this.active, limit: this.limit, queued: this.budget.size,
      queueLimit: this.budget.limit, queueTimeoutMs: this.budget.timeoutMs, accountLimit: this.accountLimit };
  }
}
const executionSlots = new ExecutionSlots();
module.exports = { AdmissionError, WaitBudget, Semaphore, ExecutionSlots, executionSlots, waitBudget,
  ACCOUNT_CONCURRENCY, MAX_CONCURRENCY, MAX_QUEUE, QUEUE_TIMEOUT_MS };
