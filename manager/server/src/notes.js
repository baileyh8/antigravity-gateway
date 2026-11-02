'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');

const file = path.join(config.dataDir, 'notes.json');
const MAX_LENGTH = 500;

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
}

function load() {
  ensureDataDir();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed.notes !== 'object' || Array.isArray(parsed.notes)) return { version: 1, notes: {} };
    return { version: 1, notes: parsed.notes };
  } catch {
    return { version: 1, notes: {} };
  }
}

function save(state) {
  ensureDataDir();
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function validId(value) {
  const id = String(value || '');
  return id.length > 0 && id.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(id);
}

function all() {
  return load().notes;
}

function set(accountId, text, actor) {
  if (!validId(accountId)) throw Object.assign(new Error('账号 ID 无效。'), { status: 400, code: 'invalid_account_id' });
  const value = String(text || '').trim();
  if (value.length > MAX_LENGTH) throw Object.assign(new Error(`备注不能超过 ${MAX_LENGTH} 个字符。`), { status: 400, code: 'note_too_long' });
  const state = load();
  if (!value) delete state.notes[accountId];
  else state.notes[accountId] = { text: value, updatedAt: new Date().toISOString(), actor: actor || '' };
  save(state);
  return value ? state.notes[accountId] : null;
}

function remove(accountId) {
  if (!validId(accountId)) return;
  const state = load();
  if (!state.notes[accountId]) return;
  delete state.notes[accountId];
  save(state);
}

module.exports = { all, remove, set };
