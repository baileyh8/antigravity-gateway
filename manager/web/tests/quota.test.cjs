'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/quota.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsObject = {};
new Function('exports', compiled)(exportsObject);
const { quotaKind, quotaMatrix, lowestByKind } = exportsObject;

test('shared Gemini buckets stay Gemini when their description lists Argon and Hydrogen', () => {
  const account = { quota: { groups: [{ id: 'gemini', displayName: 'Gemini Models',
    description: 'Models within this group: Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen, Gemini 3.8 Flash',
    buckets: [{ id: 'gemini-5h', window: '5h', remainingFraction: 0.73, resetTime: '2030-01-01T00:00:00Z' },
      { id: 'gemini-weekly', window: 'weekly', remainingFraction: 0.88, resetTime: '2030-01-02T00:00:00Z' }] }] } };
  const matrix = quotaMatrix(account);
  assert.equal(matrix.gemini5h.fraction, 0.73);
  assert.equal(matrix.geminiWeek.fraction, 0.88);
  assert.equal(matrix.argonWeek, null, 'do not invent a separate Argon bucket');
  assert.equal(lowestByKind(account).gemini.fraction, 0.73);
  assert.equal(lowestByKind(account).argon, undefined);
});

test('stable group IDs take precedence and separate Argon quota stays separate', () => {
  assert.equal(quotaKind({ id: 'gemini', displayName: 'Shared quota', description: 'Argon' }), 'gemini');
  assert.equal(quotaKind({ id: '3p', displayName: 'Third party', description: 'Gemini and GPT' }), 'claude');
  assert.equal(quotaKind({ id: 'argon', displayName: 'Gemini Argon', description: 'Gemini Models' }), 'argon');
  assert.equal(quotaKind({ id: 'gemini-robin', displayName: 'Gemini App' }), 'gemini');
});

test('legacy group names still work and member-only descriptions do not assign quota', () => {
  assert.equal(quotaKind({ id: 'group-0', displayName: 'Gemini Models', description: 'Includes Argon' }), 'gemini');
  assert.equal(quotaKind({ id: 'group-1', displayName: 'Claude and GPT models' }), 'claude');
  assert.equal(quotaKind({ id: 'group-2', displayName: 'Gemini Argon Models' }), 'argon');
  assert.equal(quotaKind({ id: 'future', displayName: 'Shared quota', description: 'Gemini, Argon, Claude' }), 'other');
});
