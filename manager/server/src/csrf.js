'use strict';
const crypto = require('node:crypto');
const { signSession, verifySession } = require('./auth');
const config = require('./config');
const COOKIE = 'agy_manager_csrf';
function issue(req, reply) {
  const existing = String(req.cookies?.[COOKIE] || '');
  const payload = verifySession(existing, config.sessionSecret);
  if (payload?.nonce && payload.exp > Date.now() + 60000) return existing;
  const token = signSession({ nonce: crypto.randomBytes(24).toString('base64url'), exp: Date.now() + 12 * 3600000 }, config.sessionSecret);
  reply.setCookie(COOKIE, token, { path: config.basePath, httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', maxAge: 12 * 3600 });
  return token;
}
function valid(req) {
  const cookie = String(req.cookies?.[COOKIE] || '');
  const header = String(req.headers['x-agy-csrf'] || '');
  const a = Buffer.from(cookie); const b = Buffer.from(header);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const payload = verifySession(header, config.sessionSecret);
  return Boolean(payload?.nonce && payload.exp > Date.now());
}
module.exports = { issue, valid };
