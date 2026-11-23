'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { RequestLog } = require('../src/request-log');

test('request log writes, filters and clears by time', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-request-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const now = Date.parse('2026-11-01T10:00:00+08:00');
  const log = new RequestLog({ configDir: directory, now: () => now });
  log.record({ at: now, requestId: 'r1', keyId: 'k1', keyName: 'prod', model: 'm1', status: 200, latencyMs: 12, usage: { total_tokens: 10 } });
  log.record({ at: now - 1000, requestId: 'r2', keyId: 'k2', keyName: 'test', model: 'm2', status: 500, latencyMs: 20 });
  await log.flush();
  assert.equal(log.query({ days: 1 }).total, 2);
  assert.equal(log.query({ days: 1, key: 'prod' }).total, 1);
  assert.equal(log.query({ days: 1, status: '5xx' }).total, 1);
  assert.equal(log.query({ days: 1, model: 'm1' }).items[0].id, 'r1');
  const cleared = log.clear({ before: new Date(now).toISOString() });
  assert.equal(cleared.removedFiles, 0);
  assert.equal(log.query({ days: 1 }).total, 1);
  await log.stop();
});

test('conversion diagnostics retain counts without private payload values', async (t) => {
  const { runRequestLog, recordConversionSummary } = require('../src/request-log');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-conversion-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const log = new RequestLog({ configDir: directory });
  t.after(() => log.stop());
  const entry = { at: Date.now(), requestId: 'conversion-proof', status: 429 };
  const privateValue = 'PRIVATE_CONVERSION_MARKER';
  runRequestLog(entry, () => recordConversionSummary({
    messages: [{ role: 'assistant', text: privateValue }, { role: 'user', text: privateValue }],
    instructionMessages: [{ role: 'developer', text: privateValue }],
    instructions: privateValue, tools: [{ name: privateValue }]
  }, {
    systemInstruction: { parts: [{ text: privateValue }] },
    contents: [{ role: 'model', parts: [{ functionCall: { name: privateValue }, thoughtSignature: privateValue }] },
      { role: 'user', parts: [{ functionResponse: { response: privateValue } }] }],
    tools: [{ functionDeclarations: [{ name: privateValue, description: privateValue }] }],
    generationConfig: { maxOutputTokens: 65536, thinkingConfig: { thinkingLevel: privateValue, thinkingBudget: 1024 } },
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
  }));
  log.record(entry);
  await log.flush();
  const rows = fs.readdirSync(log.directory).filter(name => name.endsWith('.jsonl'));
  const raw = fs.readFileSync(path.join(log.directory, rows[0]), 'utf8');
  assert.ok(!raw.includes(privateValue));
  const { conversion } = JSON.parse(raw);
  assert.deepEqual(conversion.roles, { user: 1, assistant: 1, other: 0 });
  assert.equal(conversion.instructionBlocks, 1);
  assert.equal(conversion.wireDeclarations, 1);
  assert.equal(conversion.wire.calls, 1);
  assert.equal(conversion.wire.signedCalls, 1);
  assert.equal(conversion.wire.results, 1);
  assert.equal(conversion.thinkingLevel, null);
  assert.equal(conversion.thinkingBudget, 1024);
  assert.equal(conversion.maxOutputTokens, 65536);
  assert.equal(conversion.wireSystemChars, privateValue.length);
});


test('conversion diagnostics retain captured Hydrogen XHigh numeric thinking level only', () => {
  const { runRequestLog, recordConversionSummary } = require('../src/request-log');
  for (const [level, expected] of [[100, 100], ['HIGH', 'HIGH'], ['100', null], [999, null]]) {
    const entry = {};
    runRequestLog(entry, () => recordConversionSummary({ messages: [] }, {
      contents: [], generationConfig: { thinkingConfig: { thinkingLevel: level } }
    }));
    assert.equal(entry.conversion.thinkingLevel, expected);
  }
});
