'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const keyContext = require('./key-context');
const { GatewayError } = require('./protocol');

const MAX_KEYS = 200;
const SAVE_INTERVAL_MS = 30_000;

function invalid(message, status = 400, code = 'invalid_key_config') {
  return Object.assign(new Error(message), { status, code });
}

function normalizedAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : value;
}

function ipAllowed(entries, address) {
  if (!Array.isArray(entries) || !entries.length) return true;
  const value = normalizedAddress(address);
  const family = net.isIP(value);
  if (!family) return false;
  for (const entry of entries) {
    const [ip, prefixSource] = String(entry).split('/');
    const ipFamily = net.isIP(ip);
    if (!ipFamily) continue;
    if (prefixSource === undefined) {
      if (normalizedAddress(ip) === value) return true;
      continue;
    }
    const prefix = Number(prefixSource);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (ipFamily === 6 ? 128 : 32)) continue;
    try {
      const block = new net.BlockList();
      block.addSubnet(ip, prefix, ipFamily === 6 ? 'ipv6' : 'ipv4');
      if (block.check(value, family === 6 ? 'ipv6' : 'ipv4')) return true;
    } catch { /* ignore an invalid stored entry */ }
  }
  return false;
}

function validateIpList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid('IP 白名单必须是数组。');
  if (value.length > 50) throw invalid('IP 白名单最多 50 条。');
  return value.map((item) => {
    const entry = String(item || '').trim();
    const [ip, prefixSource] = entry.split('/');
    const family = net.isIP(ip);
    const max = family === 6 ? 128 : 32;
    if (!family || (prefixSource !== undefined && (!/^\d+$/.test(prefixSource) || Number(prefixSource) > max))) {
      throw invalid(`IP 白名单条目无效：${entry}`);
    }
    return prefixSource === undefined ? ip : `${ip}/${Number(prefixSource)}`;
  });
}

function validateModels(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalid('模型白名单必须是数组。');
  if (value.length > 100) throw invalid('模型白名单最多 100 个。');
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function quotaValue(value, name) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) throw invalid(`${name}必须是非负数。`);
  return Math.floor(number);
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function usageSeed() {
  return { requests: 0, tokens: 0, byModel: {}, byDay: {} };
}

function normalizedKey(raw) {
  const key = raw && typeof raw === 'object' ? raw : {};
  return {
    id: String(key.id || ''),
    name: String(key.name || '').slice(0, 64),
    prefix: String(key.prefix || ''),
    hash: String(key.hash || ''),
    enabled: key.enabled !== false,
    createdAt: String(key.createdAt || new Date().toISOString()),
    createdBy: String(key.createdBy || ''),
    expiresAt: key.expiresAt ? String(key.expiresAt) : null,
    models: Array.isArray(key.models) ? key.models.map(String).filter(Boolean) : [],
    ipAllowlist: Array.isArray(key.ipAllowlist) ? key.ipAllowlist.map(String).filter(Boolean) : [],
    quota: {
      tokens: Math.max(0, Number(key.quota?.tokens) || 0),
      requests: Math.max(0, Number(key.quota?.requests) || 0)
    },
    ratePerMin: Math.max(0, Number(key.ratePerMin) || 0),
    note: String(key.note || '').slice(0, 200),
    lastUsedAt: key.lastUsedAt ? String(key.lastUsedAt) : '',
    usage: {
      ...usageSeed(),
      ...(key.usage && typeof key.usage === 'object' ? key.usage : {}),
      byModel: key.usage?.byModel && typeof key.usage.byModel === 'object' ? key.usage.byModel : {},
      byDay: key.usage?.byDay && typeof key.usage.byDay === 'object' ? key.usage.byDay : {}
    }
  };
}

class KeyStore {
  constructor({ configDir, pepper, multiKey = false, now = () => Date.now() }) {
    if (!configDir) throw new Error('KeyStore requires configDir');
    if (multiKey && !pepper) throw new Error('多密钥模式需要 key pepper。');
    this.file = path.join(configDir, 'api-keys.json');
    this.pepper = String(pepper || '');
    this.multiKey = Boolean(multiKey);
    this.now = now;
    this.rate = new Map();
    this.dirty = false;
    this.state = this.load();
    this.timer = setInterval(() => this.flush(), SAVE_INTERVAL_MS);
    this.timer.unref?.();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!parsed || !Array.isArray(parsed.keys)) throw new Error('invalid shape');
      return { version: 1, keys: parsed.keys.map(normalizedKey).filter((key) => key.id && key.hash), savedAt: parsed.savedAt || '' };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // A broken key file must not silently drop keys; the gateway still
        // accepts the legacy env key, but new keys stay unavailable.
        console.error('[Antigravity Gateway] api-keys.json 读取失败，密钥管理暂不可用:', error.message);
      }
      return { version: 1, keys: [], savedAt: '' };
    }
  }

  save() {
    const cutoff = dayKey(this.now() - 31 * 86400000);
    for (const key of this.state.keys) for (const day of Object.keys(key.usage.byDay)) if (day < cutoff) delete key.usage.byDay[day];
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify({ ...this.state, savedAt: new Date(this.now()).toISOString() }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporary, this.file);
      fs.chmodSync(this.file, 0o600);
      this.dirty = false;
    } finally {
      try { fs.rmSync(temporary, { force: true }); } catch { /* retain the original error */ }
    }
  }

  flush() {
    if (!this.dirty) return;
    try { this.save(); } catch (error) { console.error('[Antigravity Gateway] api-keys.json 保存失败:', error.message); }
  }

  stop() {
    clearInterval(this.timer);
    this.flush();
  }

  activeCount() {
    return this.state.keys.filter((key) => key.enabled && (!key.expiresAt || Date.parse(key.expiresAt) > this.now())).length;
  }

  list() {
    return this.state.keys.map((key) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      enabled: key.enabled,
      createdAt: key.createdAt,
      createdBy: key.createdBy,
      expiresAt: key.expiresAt,
      models: key.models,
      ipAllowlist: key.ipAllowlist,
      quota: key.quota,
      ratePerMin: key.ratePerMin,
      note: key.note,
      lastUsedAt: key.lastUsedAt,
      usage: key.usage
    }));
  }

  legacyMatches(req) {
    const envKey = String(process.env.ANTIGRAVITY_GATEWAY_API_KEY || '');
    if (!envKey) return false;
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const provided = String(bearer || req.headers['x-api-key'] || '');
    const left = Buffer.from(provided);
    const right = Buffer.from(envKey);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  authenticate(req) {
    const envKey = String(process.env.ANTIGRAVITY_GATEWAY_API_KEY || '');
    if (!envKey && !this.multiKey) {
      return { context: { id: 'anonymous', name: '本机匿名', legacy: true, models: [] } };
    }
    if (this.legacyMatches(req)) {
      return { context: { id: 'legacy', name: '内置主密钥', legacy: true, models: [] } };
    }
    if (!this.multiKey) {
      return { error: { status: 401, code: 'invalid_api_key', message: 'API key 无效。' } };
    }
    const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const provided = String(bearer || req.headers['x-api-key'] || '');
    const parsed = /^agy_sk_([a-f0-9]{8})_(.+)$/.exec(provided);
    if (!parsed) return { error: { status: 401, code: 'invalid_api_key', message: 'API key 无效。' } };
    const key = this.state.keys.find((item) => item.id === parsed[1]);
    if (!key) return { error: { status: 401, code: 'invalid_api_key', message: 'API key 无效。' } };
    const expected = Buffer.from(crypto.createHmac('sha256', this.pepper).update(provided).digest('hex'));
    const actual = Buffer.from(key.hash);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      return { error: { status: 401, code: 'invalid_api_key', message: 'API key 无效。' } };
    }
    if (!key.enabled) return { error: { status: 403, code: 'key_disabled', message: '该密钥已停用。' } };
    if (key.expiresAt && Date.parse(key.expiresAt) <= this.now()) {
      return { error: { status: 403, code: 'key_expired', message: '该密钥已过期。' } };
    }
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const address = forwarded || req.socket?.remoteAddress || '';
    if (!ipAllowed(key.ipAllowlist, address)) {
      return { error: { status: 403, code: 'ip_not_allowed', message: '来源 IP 不在该密钥的白名单内。' } };
    }
    if (key.quota.requests > 0 && key.usage.requests >= key.quota.requests) {
      return { error: { status: 429, code: 'key_quota_exceeded', message: '该密钥的请求配额已用完。' } };
    }
    if (key.quota.tokens > 0 && key.usage.tokens >= key.quota.tokens) {
      return { error: { status: 429, code: 'key_quota_exceeded', message: '该密钥的 Token 配额已用完。' } };
    }
    if (key.ratePerMin > 0) {
      const minute = Math.floor(this.now() / 60_000);
      const entry = this.rate.get(key.id);
      if (!entry || entry.minute !== minute) this.rate.set(key.id, { minute, count: 0 });
      const current = this.rate.get(key.id);
      if (current.count >= key.ratePerMin) {
        return { error: { status: 429, code: 'rate_limited', message: '该密钥的每分钟请求上限已用完。' } };
      }
      current.count += 1;
    }
    key.lastUsedAt = new Date(this.now()).toISOString();
    this.dirty = true;
    return { context: { id: key.id, name: key.name, legacy: false, models: key.models } };
  }

  checkModel(model) {
    const context = keyContext.current();
    if (!context || context.legacy || !Array.isArray(context.models) || !context.models.length) return;
    if (!context.models.includes(model)) {
      throw new GatewayError(`该密钥无权调用模型 ${model}。`, { status: 403, code: 'model_not_allowed' });
    }
  }

  recordRequest() {
    const context = keyContext.current();
    if (!context || context.legacy) return;
    const key = this.state.keys.find((item) => item.id === context.id);
    if (!key) return;
    key.usage.requests += 1;
    const day = dayKey(this.now());
    const bucket = (key.usage.byDay[day] ||= { requests: 0, tokens: 0 });
    bucket.requests += 1;
    this.dirty = true;
  }

  recordUsage({ usage = {}, model = '' } = {}) {
    const context = keyContext.current();
    if (!context || context.legacy) return;
    const key = this.state.keys.find((item) => item.id === context.id);
    if (!key) return;
    const tokens = Math.max(0, Number(usage.total_tokens) || 0);
    if (!tokens) return;
    key.usage.tokens += tokens;
    if (model) key.usage.byModel[model] = (Number(key.usage.byModel[model]) || 0) + tokens;
    const day = dayKey(this.now());
    const bucket = (key.usage.byDay[day] ||= { requests: 0, tokens: 0 });
    bucket.tokens += tokens;
    bucket.inputTokens = (Number(bucket.inputTokens) || 0) + Math.max(0, Number(usage.input_tokens) || 0);
    bucket.outputTokens = (Number(bucket.outputTokens) || 0) + Math.max(0, Number(usage.output_tokens) || 0);
    bucket.cachedTokens = (Number(bucket.cachedTokens) || 0) + Math.max(0, Number(usage.cache_read_tokens) || 0);
    bucket.detailedTokens = (Number(bucket.detailedTokens) || 0) + tokens;
    this.dirty = true;
  }

  recordLatency(entry) {
    const key = this.state.keys.find(item => item.id === entry.keyId);
    if (!key) return;
    const bucket = (key.usage.byDay[dayKey(this.now())] ||= { tokens: 0, requests: 0 });
    bucket.latencySamples = (Number(bucket.latencySamples) || 0) + 1;
    bucket.latencyMs = (Number(bucket.latencyMs) || 0) + Math.max(0, Number(entry.latencyMs) || 0);
    bucket.successfulRequests = (Number(bucket.successfulRequests) || 0) + (entry.status >= 200 && entry.status < 300 ? 1 : 0);
    this.dirty = true;
  }

  create({ name, expiresAt = null, models = [], ipAllowlist = [], quota = {}, ratePerMin = 0, note = '', actor = '' } = {}) {
    if (!this.multiKey) throw invalid('多密钥模式未启用。', 409, 'multi_key_disabled');
    if (this.state.keys.length >= MAX_KEYS) throw invalid(`最多 ${MAX_KEYS} 个密钥。`, 409, 'key_limit_reached');
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length > 64) throw invalid('密钥名称必须是 1-64 个字符。');
    const id = crypto.randomBytes(4).toString('hex');
    const secret = `agy_sk_${id}_${crypto.randomBytes(24).toString('base64url')}`;
    const key = normalizedKey({
      id,
      name: cleanName,
      prefix: `agy_sk_${id}`,
      hash: crypto.createHmac('sha256', this.pepper).update(secret).digest('hex'),
      enabled: true,
      createdAt: new Date(this.now()).toISOString(),
      createdBy: actor,
      expiresAt,
      models: validateModels(models),
      ipAllowlist: validateIpList(ipAllowlist),
      quota: { tokens: quotaValue(quota.tokens, 'Token 配额'), requests: quotaValue(quota.requests, '请求配额') },
      ratePerMin: quotaValue(ratePerMin, '每分钟请求上限'),
      note: String(note || '').slice(0, 200),
      usage: usageSeed()
    });
    this.state.keys.push(key);
    this.dirty = true;
    this.save();
    return { key: this.list().find((item) => item.id === id), secret };
  }

  update(id, patch = {}) {
    const key = this.state.keys.find((item) => item.id === id);
    if (!key) throw invalid('密钥不存在。', 404, 'key_not_found');
    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim();
      if (!name || name.length > 64) throw invalid('密钥名称必须是 1-64 个字符。');
      key.name = name;
    }
    if (patch.enabled !== undefined) key.enabled = Boolean(patch.enabled);
    if (patch.expiresAt !== undefined) key.expiresAt = patch.expiresAt ? String(patch.expiresAt) : null;
    if (patch.models !== undefined) key.models = validateModels(patch.models);
    if (patch.ipAllowlist !== undefined) key.ipAllowlist = validateIpList(patch.ipAllowlist);
    if (patch.quota !== undefined) {
      key.quota = {
        tokens: quotaValue(patch.quota.tokens, 'Token 配额'),
        requests: quotaValue(patch.quota.requests, '请求配额')
      };
    }
    if (patch.ratePerMin !== undefined) key.ratePerMin = quotaValue(patch.ratePerMin, '每分钟请求上限');
    if (patch.note !== undefined) key.note = String(patch.note || '').slice(0, 200);
    this.dirty = true;
    this.save();
    return this.list().find((item) => item.id === id);
  }

  roll(id) {
    if (!this.multiKey) throw invalid('多密钥模式未启用。', 409, 'multi_key_disabled');
    const key = this.state.keys.find((item) => item.id === id);
    if (!key) throw invalid('密钥不存在。', 404, 'key_not_found');
    const secret = `agy_sk_${id}_${crypto.randomBytes(24).toString('base64url')}`;
    key.hash = crypto.createHmac('sha256', this.pepper).update(secret).digest('hex');
    key.enabled = true;
    key.lastUsedAt = '';
    this.dirty = true;
    this.save();
    return { key: this.list().find((item) => item.id === id), secret };
  }

  resetUsage(id) {
    const key = this.state.keys.find((item) => item.id === id);
    if (!key) throw invalid('密钥不存在。', 404, 'key_not_found');
    key.usage = usageSeed();
    this.dirty = true;
    this.save();
    return this.list().find((item) => item.id === id);
  }

  remove(id) {
    const index = this.state.keys.findIndex((item) => item.id === id);
    if (index < 0) throw invalid('密钥不存在。', 404, 'key_not_found');
    const [removed] = this.state.keys.splice(index, 1);
    this.dirty = true;
    this.save();
    return { id: removed.id, name: removed.name, deleted: true };
  }
}

module.exports = { KeyStore, ipAllowed };
