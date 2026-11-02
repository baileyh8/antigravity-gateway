'use strict';

const crypto = require('node:crypto');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');

const config = require('./config');
const { reverseLines } = require('./log-reader');
const { hashPassword } = require('./auth');

const usersFile = path.join(config.dataDir, 'users.json');

function ensureDataDir() {
  fs.mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
}

function loadUsers({ strict = false } = {}) {
  ensureDataDir();
  if (!fs.existsSync(usersFile)) return { version: 1, users: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    if (!parsed || !Array.isArray(parsed.users)) {
      if (strict) throw new Error('users.json 结构无效，拒绝覆盖。');
      return { version: 1, users: [] };
    }
    return { version: 1, users: parsed.users.filter((user) => user && typeof user.username === 'string') };
  } catch (error) {
    if (strict) throw new Error(`users.json 无法解析，拒绝覆盖：${error.message}`);
    return { version: 1, users: [] };
  }
}

function saveUsers(state) {
  ensureDataDir();
  const temporary = `${usersFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, usersFile);
  fs.chmodSync(usersFile, 0o600);
}

function getUser(username) {
  return loadUsers().users.find((user) => user.username === username) || null;
}

function updateUser(username, patch) {
  const state = loadUsers();
  const index = state.users.findIndex((user) => user.username === username);
  if (index < 0) return null;
  state.users[index] = { ...state.users[index], ...patch };
  saveUsers(state);
  return state.users[index];
}

function bootstrapAdmin() {
  const state = loadUsers({ strict: true });
  if (state.users.length) return { created: false, username: state.users[0].username };

  let password = config.adminPassword;
  let passwordFile = '';
  if (!password) {
    password = crypto.randomBytes(18).toString('base64url');
    passwordFile = path.join(config.dataDir, 'initial-admin-password');
    fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
    fs.chmodSync(passwordFile, 0o600);
  }
  state.users.push({
    username: config.adminUsername,
    role: 'admin',
    passwordHash: hashPassword(password),
    sessionEpoch: 1,
    createdAt: new Date().toISOString()
  });
  saveUsers(state);
  return { created: true, username: config.adminUsername, passwordFile };
}

function audit({ actor, ip, action, target = '', result = 'ok', durationMs = 0, detail = '' }) {
  ensureDataDir();
  const now = new Date();
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const file = path.join(config.dataDir, `audit-${month}.jsonl`);
  const line = JSON.stringify({
    ts: now.toISOString(),
    actor: actor || 'anonymous',
    ip: ip || '',
    action,
    target,
    result,
    durationMs,
    detail
  });
  fs.appendFile(file, `${line}\n`, { mode: 0o600 }, () => {});
}

async function pruneAudit() {
  ensureDataDir();
  const cutoff = Date.now() - 180 * 86400000;
  const boundary = new Date(cutoff);
  const month = `${boundary.getFullYear()}${String(boundary.getMonth() + 1).padStart(2, '0')}`;
  const files = (await fs.promises.readdir(config.dataDir)).filter(name => /^audit-\d{6}\.jsonl$/.test(name));
  for (const name of files) {
    const key = name.slice(6, 12);
    const file = path.join(config.dataDir, name);
    if (key < month) { await fs.promises.rm(file, { force: true }); continue; }
    if (key !== month) continue;
    const temporary = `${file}.${process.pid}.prune`;
    const output = await fs.promises.open(temporary, 'w', 0o600);
    try {
      const input = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
      for await (const line of input) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (Date.parse(row.ts) >= cutoff) await output.write(`${line}\n`);
      }
      await output.close();
      await fs.promises.rename(temporary, file);
    } catch (error) { await output.close().catch(() => {}); await fs.promises.rm(temporary, { force: true }); throw error; }
  }
}

function readAudit({ days = 30, action = '', actor = '', page = 1, size = 20 } = {}) {
  ensureDataDir();
  const cutoff = Date.now() - Math.max(1, Math.min(180, Number(days) || 30)) * 86400_000;
  const rows = [];
  let files = [];
  try { files = fs.readdirSync(config.dataDir).filter((name) => /^audit-\d{6}\.jsonl$/.test(name)); } catch { files = []; }
  let scanned = 0;
  for (const name of files.sort().reverse()) {
    for (const line of reverseLines(path.join(config.dataDir, name), 4 * 1024 * 1024)) {
      if (++scanned > 20000) break;
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const at = Date.parse(row.ts);
      if (!Number.isFinite(at) || at < cutoff) continue;
      if (action && !String(row.action || '').includes(action)) continue;
      if (actor && !String(row.actor || '').toLowerCase().includes(String(actor).toLowerCase())) continue;
      rows.push(row);
    }
  }
  rows.sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
  const currentPage = Math.max(1, Number(page) || 1);
  const limit = Math.max(1, Math.min(200, Number(size) || 20));
  const start = (currentPage - 1) * limit;
  return { items: rows.slice(start, start + limit), total: rows.length, page: currentPage, size: limit, hasMore: start + limit < rows.length };
}

module.exports = { audit, bootstrapAdmin, getUser, loadUsers, pruneAudit, readAudit, saveUsers, updateUser };
