'use strict';

const crypto = require('node:crypto');

const ITERATIONS = 260000;
const KEY_BYTES = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), ITERATIONS, KEY_BYTES, 'sha256').toString('hex');
  return `pbkdf2_sha256$${ITERATIONS}$${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  try {
    const [algorithm, iterations, salt, expected] = String(stored || '').split('$');
    if (algorithm !== 'pbkdf2_sha256') return false;
    const digest = crypto.pbkdf2Sync(String(password), Buffer.from(salt, 'hex'), Number(iterations), KEY_BYTES, 'sha256');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return expectedBuffer.length === digest.length && crypto.timingSafeEqual(digest, expectedBuffer);
  } catch {
    return false;
  }
}

// A fixed hash keeps the not-found path as expensive as a wrong password, so
// response timing does not reveal whether a username exists.
const DUMMY_HASH = 'pbkdf2_sha256$260000$00112233445566778899aabbccddeeff$' + '0'.repeat(64);

function burnPasswordCheck(password) {
  verifyPassword(password, DUMMY_HASH);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(payload, secret) {
  const body = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifySession(token, secret) {
  const value = String(token || '');
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    return payload;
  } catch {
    return null;
  }
}

class LoginLimiter {
  constructor({ maxFailures = 5, lockMs = 10 * 60 * 1000 } = {}) {
    this.maxFailures = maxFailures;
    this.lockMs = lockMs;
    this.entries = new Map();
  }

  retryAfter(key) {
    const entry = this.entries.get(key);
    if (!entry) return 0;
    if (entry.until > Date.now()) return Math.ceil((entry.until - Date.now()) / 1000);
    if (entry.until) this.entries.delete(key);
    return 0;
  }

  fail(key) {
    const now = Date.now();
    const entry = this.entries.get(key) || { count: 0, until: 0 };
    entry.count += 1;
    if (entry.count >= this.maxFailures) {
      entry.until = now + this.lockMs;
      entry.count = 0;
    }
    this.entries.set(key, entry);
  }

  clear(key) {
    this.entries.delete(key);
  }

  prune() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.until && entry.until <= now) this.entries.delete(key);
    }
  }
}

module.exports = {
  LoginLimiter,
  burnPasswordCheck,
  hashPassword,
  signSession,
  verifyPassword,
  verifySession
};
