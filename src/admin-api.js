'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

const { reverseLines } = require('./log-reader');
const { zeroCounters } = require('./usage-store');
const { maskEmail } = require('./account-format');

const API_VERSION = 1;
const PREFIX = '/_admin/v1';
const DEFAULT_TOKEN_FILE = '/etc/agy-manager/admin-token';
const COUNTER_KEYS = Object.keys(zeroCounters());
const MAX_ACTIVE = 4;
let active = 0;
let lastDiscovery = 0;

function readAdminToken({ env = process.env, fsImpl = fs } = {}) {
  const inline = String(env.AGY_ADMIN_TOKEN || '').trim();
  if (inline) return inline;
  try {
    return String(fsImpl.readFileSync(env.AGY_ADMIN_TOKEN_FILE || DEFAULT_TOKEN_FILE, 'utf8')).trim();
  } catch {
    return '';
  }
}

function normalizedAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : value;
}

function isLoopback(address) {
  const value = normalizedAddress(address);
  return value === '127.0.0.1' || value === '::1';
}

function safeEqual(provided, expected) {
  const left = Buffer.from(String(provided || ''));
  const right = Buffer.from(String(expected || ''));
  if (!right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function addCounters(target, source) {
  for (const key of COUNTER_KEYS) target[key] += Number(source?.[key]) || 0;
  return target;
}

function sumRange(history, from, to) {
  const total = zeroCounters();
  for (const row of Array.isArray(history) ? history : []) {
    const at = Date.parse(row?.at);
    if (!Number.isFinite(at) || at < from || at > to) continue;
    addCounters(total, row);
  }
  return total;
}

function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dailyTrend(history, days, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const buckets = [];
  const index = new Map();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(start);
    date.setDate(date.getDate() - offset);
    const key = dayKey(date);
    const bucket = { date: key, ...zeroCounters() };
    buckets.push(bucket);
    index.set(key, bucket);
  }
  for (const row of Array.isArray(history) ? history : []) {
    const at = Date.parse(row?.at);
    if (!Number.isFinite(at)) continue;
    const bucket = index.get(dayKey(at));
    if (bucket) addCounters(bucket, row);
  }
  return buckets.map((bucket) => ({
    date: bucket.date,
    requests: bucket.clientRequests,
    tokens: bucket.totalTokens,
    failures: bucket.failedUpstreamCalls,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cachedTokens: bucket.cachedTokens
  }));
}

function accountSnapshot(account, { providerType, accountType, quota }) {
  return {
    id: account.id,
    emailMasked: maskEmail(account.email),
    tokenUsageKnown: typeof account.tokenUsageKnown === 'boolean' ? account.tokenUsageKnown : providerType !== 'robin',
    models: Array.isArray(account.models) ? account.models.map(String) : [],
    providerType,
    accountType,
    enabled: account.enabled !== false,
    state: account.state || (account.enabled === false ? 'disabled' : 'unknown'),
    weight: account.weight ?? 1,
    healthReason: account.healthReason || '',
    healthMessage: account.healthMessage || '',
    cooldownUntil: account.cooldownUntil || '',
    lastSuccessAt: account.lastSuccessAt || '',
    lastFailureAt: account.lastFailureAt || '',
    lastError: account.lastError || '',
    modelCooldowns: Array.isArray(account.modelCooldowns) ? account.modelCooldowns : [],
    quota: quota || null
  };
}

function accountList(deps) {
  const cloud = deps.accountPool.status().map((account) => accountSnapshot(account, {
    providerType: 'cloudcode',
    accountType: 'antigravity',
    quota: deps.quotaManager?.peek?.(account.id) || deps.quotaManager?.get?.(account.id) || null
  }));
  const robin = (deps.robinAccountPool?.status?.() || []).map((account) => accountSnapshot(account, {
    providerType: 'robin',
    accountType: 'gemini-app',
    quota: account.quota || null
  }));
  const accounts = [...cloud, ...robin];
  deps.accountLabels?.capture(accounts);
  return accounts;
}

function accountCounts(items) {
  const counts = { total: items.length, available: 0, cooldown: 0, disabled: 0, error: 0 };
  for (const item of items) {
    if (item.state === 'available') counts.available += 1;
    else if (item.state === 'cooldown') counts.cooldown += 1;
    else if (item.state === 'disabled') counts.disabled += 1;
    else counts.error += 1;
  }
  return counts;
}

function overview(deps) {
  const now = Date.now();
  const items = accountList(deps);
  const usage = deps.usageStore.summary({ live: true, detailed: true });
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const concurrency = deps.concurrency();
  return {
    version: deps.version,
    startedAt: deps.startedAt,
    uptimeSeconds: Math.max(0, Math.floor((now - Date.parse(deps.startedAt)) / 1000)),
    transport: deps.transport,
    defaultModel: deps.defaultModel,
    concurrency: {
      active: concurrency.requests.active,
      queued: concurrency.requests.queued,
      limit: concurrency.requests.limit,
      memory: concurrency.memory
    },
    accounts: {
      ...accountCounts(items),
      items
    },
    usage: {
      today: sumRange(usage.history, startOfDay.getTime(), now),
      last24h: sumRange(usage.history, now - 24 * 3600 * 1000, now),
      lifetime: usage.lifetime
    },
    trend: dailyTrend(usage.history, 14, now),
    models: { count: null },
    keys: deps.keyStore ? { active: deps.keyStore.activeCount(), total: deps.keyStore.list().length } : { active: null, total: null },
    generatedAt: new Date(now).toISOString()
  };
}

function sendJson(res, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Agy-Admin-Version': String(API_VERSION)
  });
  res.end(payload);
}

function fail(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message } });
}

function adminFail(res, error) {
  const status = Number(error?.status) || 500;
  const code = error?.code || 'admin_write_failed';
  const message = status >= 500 ? '管理操作失败，请查看基座日志。' : (error?.message || '管理操作失败。');
  fail(res, status, code, message);
}

async function readJson(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('请求体过大。'), { status: 413, code: 'body_too_large' });
    chunks.push(chunk);
  }
  if (!size) return {};
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求体不是有效 JSON。'), { status: 400, code: 'invalid_json' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('请求体须为 JSON 对象。'), { status: 400, code: 'invalid_body' });
  }
  return value;
}

function poolFor(deps, accountId, provider = '') {
  if (provider && !['cloudcode', 'robin'].includes(provider)) throw Object.assign(new Error('账号来源无效。'), { status: 400, code: 'invalid_account_provider' });
  if (provider === 'cloudcode') return deps.accountPool;
  if (provider === 'robin') {
    if (!deps.robinAccountPool) throw Object.assign(new Error('Gemini App 账号池未启用。'), { status: 503, code: 'robin_pool_disabled' });
    return deps.robinAccountPool;
  }
  const inCloud = deps.accountPool.status().some((account) => account.id === accountId);
  const inRobin = Boolean(deps.robinAccountPool?.status?.().some((account) => account.id === accountId));
  if (inCloud && inRobin) throw Object.assign(new Error('该账号 ID 同时存在于两类账号池，请指定 provider。'), { status: 409, code: 'ambiguous_account_provider' });
  return inRobin ? deps.robinAccountPool : deps.accountPool;
}

function queryProvider(url) {
  const values = url?.searchParams?.getAll('provider') || [];
  if (values.length > 1 || (values.length === 1 && !['cloudcode', 'robin'].includes(values[0]))) throw Object.assign(new Error('账号来源须唯一且为 cloudcode 或 robin。'), { status: 400, code: 'invalid_account_provider' });
  return values[0] || '';
}

function proxyBindingKey(pool, accountId, deps) {
  return pool === deps.robinAccountPool ? `robin:${accountId}` : accountId;
}

function oauthProvider(value) {
  const provider = String(value || 'cloudcode').trim().toLowerCase();
  if (!['cloudcode', 'robin'].includes(provider)) {
    throw Object.assign(new Error('授权来源必须是 cloudcode 或 robin。'), { status: 400, code: 'invalid_oauth_provider' });
  }
  return provider;
}

function queryNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function readDiagnostics({ files, days, event, account, page, size, now = Date.now() }) {
  const cutoff = now - Math.max(1, Math.min(90, days)) * 86400_000;
  const rows = [];
  let scanned = 0;
  for (const file of files.filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    for (const line of reverseLines(file, 4 * 1024 * 1024)) {
      if (++scanned > 20000) break;
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const at = Date.parse(row.at);
      if (!Number.isFinite(at) || at < cutoff) continue;
      if (event && !String(row.event || '').toLowerCase().includes(String(event).toLowerCase())) continue;
      if (account && !String(row.account || row.accountId || '').toLowerCase().includes(String(account).toLowerCase())) continue;
      rows.push(row);
    }
  }
  rows.sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const start = (page - 1) * size;
  return { items: rows.slice(start, start + size), total: rows.length, page, size, hasMore: start + size < rows.length };
}

function usageSummary(deps, { days = 7, groupBy = 'model', grain = 'day', now = Date.now() } = {}) {
  days = Math.floor(Number(days));
  if (!Number.isFinite(days) || days < 1 || days > 31 || !['model', 'account', 'key'].includes(groupBy) || !['day', 'hour'].includes(grain) || (groupBy === 'key' && grain === 'hour')) {
    throw Object.assign(new Error('用量范围须为 1–31 天，维度须为 model/account/key。'), { status: 400, code: 'invalid_usage_query' });
  }
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const cutoff = start.getTime();
  const summary = deps.usageStore.summary({ live: true, detailed: true });
  const totals = sumRange(summary.history, cutoff, now);
  const items = new Map();
  const stride = grain === 'hour' ? Math.max(1, Math.ceil((now - cutoff) / 3600000 / 199)) : 1;
  const keyFor = at => grain === 'day' ? dayKey(at) : String(Math.floor((at - cutoff) / (stride * 3600000)));
  const trend = grain === 'day' ? dailyTrend(summary.history || [], days, now) : Array.from({ length: Math.floor((now - cutoff) / (stride * 3600000)) + 1 }, (_, i) => ({ date: new Date(cutoff + i * stride * 3600000).toISOString(), tokens: 0, requests: 0, failures: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0 }));
  const trendMap = new Map(trend.map((point, i) => [grain === 'day' ? point.date : String(i), { ...point, groups: {} }]));
  if (grain === 'hour') for (const row of summary.history || []) {
    const at = Date.parse(row.at);
    if (at < cutoff || at > now) continue;
    const point = trendMap.get(keyFor(at)); if (!point) continue;
    point.tokens += Number(row.totalTokens) || 0; point.requests += Number(row.clientRequests) || 0;
    point.failures += Number(row.failedUpstreamCalls) || 0;
    point.inputTokens += Number(row.inputTokens) || 0; point.outputTokens += Number(row.outputTokens) || 0; point.cachedTokens += Number(row.cachedTokens) || 0;
  }
  const addSeries = (at, id, tokens) => { const point = trendMap.get(keyFor(at)); if (point) point.groups[id] = (point.groups[id] || 0) + (Number(tokens) || 0); };
  if (groupBy === 'key') {
    const cutoffKey = dayKey(cutoff);
    for (const key of deps.keyStore?.list?.() || []) {
      const item = { id: key.id, name: key.name, tokens: 0, requests: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, successRate: null, latencySamples: 0, latencyMs: 0, detailedTokens: 0 };
      for (const [day, values] of Object.entries(key.usage?.byDay || {})) {
        if (day < cutoffKey || day > dayKey(now)) continue;
        item.tokens += Number(values.tokens) || 0;
        item.requests += Number(values.requests) || 0;
        for (const field of ['inputTokens', 'outputTokens', 'cachedTokens', 'latencySamples', 'latencyMs', 'detailedTokens']) item[field] += Number(values[field]) || 0;
        addSeries(Date.parse(`${day}T00:00:00`), key.id, values.tokens);
      }
      item.avgLatencyMs = item.latencySamples ? item.latencyMs / item.latencySamples : null;
      if (item.detailedTokens < item.tokens) item.inputTokens = item.outputTokens = item.cachedTokens = null;
      item.cacheHitRate = item.inputTokens > 0 ? item.cachedTokens / item.inputTokens * 100 : null;
      items.set(key.id, item);
    }
    const knownTokens = [...items.values()].reduce((n, row) => n + row.tokens, 0);
    const knownRequests = [...items.values()].reduce((n, row) => n + row.requests, 0);
    items.set('unattributed', { id: 'unattributed', name: '未归属（主密钥 / 历史 / 已删除或重置）', tokens: Math.max(0, totals.totalTokens - knownTokens), requests: Math.max(0, totals.clientRequests - knownRequests), inputTokens: null, outputTokens: null, cachedTokens: null, successRate: null });
  } else {
    const labels = groupBy === 'account' ? new Map([...Object.entries(deps.accountLabels?.all() || {}), ...accountList(deps).map(row => [row.id, row.emailMasked])]) : new Map();
    const buckets = groupBy === 'account' ? summary.hourlyByAccount : summary.hourlyByModel;
    for (const [hour, groups] of Object.entries(buckets || {})) {
      const at = Date.parse(hour);
      if (!Number.isFinite(at) || at < cutoff || at > now) continue;
      for (const [id, values] of Object.entries(groups || {})) {
        const item = items.get(id) || { id, name: groupBy === 'account' ? labels.get(id) || '邮箱未登记（历史账号）' : id, requestSamples: 0, latencyMs: 0, ...zeroCounters() };
        addCounters(item, values);
        item.requestSamples += Number(values.requestSamples) || 0; item.latencyMs += Number(values.latencyMs) || 0;
        addSeries(at, id, values.totalTokens);
        items.set(id, item);
      }
    }
    for (const [id, value] of items) items.set(id, {
      ...value, tokens: value.totalTokens, requests: value.upstreamCalls,
      successRate: value.upstreamCalls ? value.successfulUpstreamCalls / value.upstreamCalls * 100 : null,
      avgLatencyMs: value.requestSamples ? value.latencyMs / value.requestSamples : null,
      latencySamples: value.requestSamples,
      cacheHitRate: value.inputTokens > 0 ? value.cachedTokens / value.inputTokens * 100 : null
    });
  }
  const list = [...items.values()].sort((a, b) => b.tokens - a.tokens);
  const top = list.filter(row => row.id !== 'unattributed').slice(0, 5);
  const series = [...top.map(row => ({ id: row.id, name: row.name })), { id: 'other', name: '其他 / 未归属' }];
  for (const point of trendMap.values()) {
    const selected = Object.fromEntries(top.map(row => [row.id, point.groups[row.id] || 0]));
    selected.other = Math.max(0, point.tokens - Object.values(selected).reduce((a, b) => a + b, 0));
    point.groups = selected;
  }
  return {
    grain, strideHours: grain === 'hour' ? stride : null, series,
    groupBy, days, from: start.toISOString(), to: new Date(now).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    totals, items: list, trend: [...trendMap.values()],
    requestBasis: groupBy === 'key' ? 'client' : 'upstream',
    note: '总请求为客户端请求；模型/账号明细为上游调用（含重试）。密钥从启用后累计，重置/删除后历史显示未归属；密钥仅按日统计；分项与延迟从升级后采集，历史缺失显示 —，延迟附样本数。'
  };
}

async function handleAdminRequest({ req, res, route, requestUrl, deps }) {
  const token = String(deps?.token || '');
  if (!token || !isLoopback(req.socket?.remoteAddress)) {
    fail(res, 404, 'admin_api_disabled', '管理接口未启用。');
    return;
  }
  const provided = req.headers['x-agy-admin-token'];
  if (!safeEqual(provided, token)) {
    fail(res, 401, 'admin_token_invalid', '管理令牌无效。');
    return;
  }
  if (active >= MAX_ACTIVE) {
    fail(res, 503, 'admin_busy', '管理接口繁忙，请稍后重试。');
    return;
  }
  active += 1;
  try {
    if (req.method === 'DELETE' && route.startsWith(`${PREFIX}/accounts/`)) accountList(deps);
    if (req.method === 'GET' && route === `${PREFIX}/health`) {
      sendJson(res, 200, {
        ok: true,
        data: { version: deps.version, startedAt: deps.startedAt, apiVersion: API_VERSION }
      });
      return;
    }
    if (req.method === 'GET' && route === `${PREFIX}/overview`) {
      sendJson(res, 200, { ok: true, data: overview(deps) });
      return;
    }
    if (req.method === 'GET' && route === `${PREFIX}/accounts`) {
      const items = accountList(deps);
      sendJson(res, 200, { ok: true, data: { items, counts: accountCounts(items), generatedAt: new Date().toISOString() } });
      return;
    }
    if (route === `${PREFIX}/usage` && req.method === 'GET') {
      sendJson(res, 200, { ok: true, data: usageSummary(deps, {
        days: requestUrl?.searchParams?.get('days') ?? 7,
        groupBy: requestUrl?.searchParams?.get('groupBy') || 'model',
        grain: requestUrl?.searchParams?.get('grain') || 'day'
      }) });
      return;
    }
    if (route === `${PREFIX}/keys` && req.method === 'GET') {
      if (!deps.keyStore) throw Object.assign(new Error('密钥存储未启用。'), { status: 503, code: 'keys_disabled' });
      sendJson(res, 200, { ok: true, data: { keys: deps.keyStore.list(), multiKey: deps.keyStore.multiKey } });
      return;
    }
    if (route === `${PREFIX}/keys` && req.method === 'POST') {
      if (!deps.keyStore) throw Object.assign(new Error('密钥存储未启用。'), { status: 503, code: 'keys_disabled' });
      const body = await readJson(req);
      sendJson(res, 200, { ok: true, data: deps.keyStore.create({ ...body, actor: String(body.actor || req.headers['x-agy-actor'] || '') }) });
      return;
    }
    const keyMatch = route.match(/^\/_admin\/v1\/keys\/([^/]+)$/);
    const keyRollMatch = route.match(/^\/_admin\/v1\/keys\/([^/]+)\/roll$/);
    const keyResetMatch = route.match(/^\/_admin\/v1\/keys\/([^/]+)\/reset-usage$/);
    if (keyRollMatch && req.method === 'POST') {
      if (!deps.keyStore) throw Object.assign(new Error('密钥存储未启用。'), { status: 503, code: 'keys_disabled' });
      sendJson(res, 200, { ok: true, data: deps.keyStore.roll(decodeURIComponent(keyRollMatch[1])) });
      return;
    }
    if (keyResetMatch && req.method === 'POST') {
      if (!deps.keyStore) throw Object.assign(new Error('密钥存储未启用。'), { status: 503, code: 'keys_disabled' });
      sendJson(res, 200, { ok: true, data: { key: deps.keyStore.resetUsage(decodeURIComponent(keyResetMatch[1])) } });
      return;
    }
    if (keyMatch) {
      if (!deps.keyStore) throw Object.assign(new Error('密钥存储未启用。'), { status: 503, code: 'keys_disabled' });
      const id = decodeURIComponent(keyMatch[1]);
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        sendJson(res, 200, { ok: true, data: { key: deps.keyStore.update(id, body) } });
        return;
      }
      if (req.method === 'DELETE') {
        sendJson(res, 200, { ok: true, data: deps.keyStore.remove(id) });
        return;
      }
    }
    if (route === `${PREFIX}/logs/requests/export` && req.method === 'GET') {
      const params = requestUrl?.searchParams;
      await deps.requestLog.streamCsv(res, { accountLabels: {...deps.accountLabels?.all(), ...Object.fromEntries(accountList(deps).map(row => [row.id, row.emailMasked]))}, days: queryNumber(params?.get('days'), 7, 1, 31), key: params?.get('key') || '', model: params?.get('model') || '', status: params?.get('status') || '', ip: params?.get('ip') || '' });
      return;
    }
    if (route === `${PREFIX}/logs/requests` && req.method === 'GET') {
      if (!deps.requestLog) throw Object.assign(new Error('请求日志未启用。'), { status: 503, code: 'request_log_disabled' });
      const params = requestUrl?.searchParams;
      const data = await deps.requestLog.queryAsync({
        days: queryNumber(params?.get('days'), 7, 1, 90),
        key: String(params?.get('key') || ''),
        model: String(params?.get('model') || ''),
        status: String(params?.get('status') || ''),
        ip: String(params?.get('ip') || ''),
        page: queryNumber(params?.get('page'), 1, 1, 100000),
        size: queryNumber(params?.get('size'), 20, 1, 200)
      });
      const labels = new Map([...Object.entries(deps.accountLabels?.all() || {}), ...accountList(deps).map(row => [row.id, row.emailMasked])]);
      data.items = data.items.map(row => ({ ...row, accountLabel: labels.get(row.account) || (String(row.account || '').includes('@') ? maskEmail(row.account) : row.account ? '已移除账号' : '—') }));
      sendJson(res, 200, { ok: true, data });
      return;
    }
    if (route === `${PREFIX}/logs/requests` && req.method === 'DELETE') {
      if (!deps.requestLog) throw Object.assign(new Error('请求日志未启用。'), { status: 503, code: 'request_log_disabled' });
      const body = await readJson(req);
      if (!body.before) throw Object.assign(new Error('请指定清理截止时间。'), { status: 400, code: 'invalid_before' });
      sendJson(res, 200, { ok: true, data: await deps.requestLog.clearAsync({ before: String(body.before) }) });
      return;
    }
    if (route === `${PREFIX}/logs/diagnostics` && req.method === 'GET') {
      const params = requestUrl?.searchParams;
      const data = readDiagnostics({
        files: [deps.diagnosticLog?.file, deps.diagnosticLog?.rotatedFile],
        days: queryNumber(params?.get('days'), 7, 1, 90),
        event: String(params?.get('event') || ''),
        account: String(params?.get('account') || ''),
        page: queryNumber(params?.get('page'), 1, 1, 100000),
        size: queryNumber(params?.get('size'), 20, 1, 200)
      });
      const labels = new Map([...Object.entries(deps.accountLabels?.all() || {}), ...accountList(deps).map(row => [row.id, row.emailMasked])]);
      data.items = data.items.map(row => { const id = String(row.account || row.accountId || ''); return { ...row, accountLabel: labels.get(id) || (id.includes('@') ? maskEmail(id) : id ? '已移除账号' : '—') }; });
      sendJson(res, 200, { ok: true, data });
      return;
    }
    if (route === `${PREFIX}/models` && req.method === 'GET') {
      if (!deps.listModels || !deps.modelSettings) throw Object.assign(new Error('模型设置未启用。'), { status: 503, code: 'models_disabled' });
      const models = await deps.listModels(false);
      const items = models.map((id) => {
        const override = deps.modelSettings.get(id);
        const metadata = deps.modelInfo?.(id) || {};
        return {
          id,
          displayName: override.displayName || metadata.display_name || id,
          enabled: override.enabled !== false,
          contextWindow: override.contextWindow || metadata.context_window || null,
          maxOutputTokens: override.maxOutputTokens || metadata.max_output_tokens || null,
          aliases: Array.isArray(override.aliases) ? override.aliases : [],
          note: override.note || '',
          defaultTemperature: override.defaultTemperature ?? null,
          defaultMaxTokens: override.defaultMaxTokens ?? null,
          source: deps.robinModels?.has?.(id) ? 'robin' : 'cloudcode'
        };
      });
      sendJson(res, 200, { ok: true, data: { items, ...deps.modelDiscovery?.() } });
      return;
    }
    if (route === `${PREFIX}/models/discover` && req.method === 'POST') {
      if (Date.now() - lastDiscovery < 10000) throw Object.assign(new Error('模型发现间隔至少 10 秒。'), { status: 429, code: 'discovery_rate_limited' });
      lastDiscovery = Date.now();
      if (!deps.listModels) throw Object.assign(new Error('模型发现未启用。'), { status: 503, code: 'models_disabled' });
      const models = await deps.listModels(true);
      const status = deps.modelDiscovery?.() || {};
      if (status.stale) throw Object.assign(new Error('上游发现失败，已保留上次目录。'), { status: 503, code: 'discovery_stale' });
      sendJson(res, 200, { ok: true, data: { count: models.length, discoveredAt: new Date().toISOString(), ...status } });
      return;
    }
    const testMatch = route.match(/^\/_admin\/v1\/models\/([^/]+)\/test$/);
    if (testMatch && req.method === 'POST') {
      if (!deps.testModel) throw Object.assign(new Error('模型测试未启用。'), { status: 503 });
      sendJson(res, 200, { ok: true, data: await deps.testModel(decodeURIComponent(testMatch[1])) });
      return;
    }
    if (route === `${PREFIX}/catalogs` && req.method === 'GET') {
      sendJson(res, 200, { ok: true, data: await deps.catalogs() });
      return;
    }
    const modelMatch = route.match(/^\/_admin\/v1\/models\/([^/]+)$/);
    if (modelMatch && req.method === 'PATCH') {
      if (!deps.modelSettings) throw Object.assign(new Error('模型设置未启用。'), { status: 503, code: 'models_disabled' });
      const body = await readJson(req);
      const id = decodeURIComponent(modelMatch[1]);
      const catalog = await deps.listModels(false);
      if (!catalog.includes(id)) throw Object.assign(new Error('模型不在当前目录中。'), { status: 404, code: 'model_not_found' });
      if (Array.isArray(body.aliases) && body.aliases.some(alias => catalog.includes(String(alias)))) throw Object.assign(new Error('别名不能覆盖已有模型 ID。'), { status: 400, code: 'invalid_model_setting' });
      const updated = deps.modelSettings.update(id, body);
      sendJson(res, 200, { ok: true, data: { model: updated } });
      return;
    }
    if (route === `${PREFIX}/catalogs/sync` && req.method === 'POST') {
      if (!deps.refreshCatalogs) throw Object.assign(new Error('目录同步未启用。'), { status: 503, code: 'models_disabled' });
      const models = await deps.refreshCatalogs();
      sendJson(res, 200, { ok: true, data: { count: models.length, syncedAt: new Date().toISOString() } });
      return;
    }
    if (req.method === 'POST' && route === `${PREFIX}/accounts/oauth/start`) {
      const body = await readJson(req);
      const provider = oauthProvider(body.provider);
      if (provider === 'robin') {
        if (!deps.robinOnboarding) throw Object.assign(new Error('Gemini App 授权未启用。'), { status: 503, code: 'robin_oauth_disabled' });
        const status = await deps.robinOnboarding.start(String(body.proxyId || ''));
        sendJson(res, 200, { ok: true, data: { provider, ...status } });
      } else {
        const status = await deps.adminOAuth.start({ proxyId: String(body.proxyId || '') });
        sendJson(res, 200, { ok: true, data: { provider, ...status } });
      }
      return;
    }
    if (req.method === 'POST' && route === `${PREFIX}/accounts/oauth/callback`) {
      const body = await readJson(req);
      const provider = oauthProvider(body.provider);
      const id = String(body.id || '');
      const callback = String(body.callback || '');
      const status = provider === 'robin'
        ? deps.robinOnboarding.submit(id, callback)
        : deps.adminOAuth.submit(id, callback);
      sendJson(res, 200, { ok: true, data: { provider, ...status } });
      return;
    }
    const oauthMatch = route.match(/^\/_admin\/v1\/accounts\/oauth\/([^/]+)(\/cancel)?$/);
    if (oauthMatch) {
      const id = decodeURIComponent(oauthMatch[1]);
      const provider = oauthProvider(requestUrl?.searchParams?.get('provider'));
      if (oauthMatch[2] && req.method === 'POST') {
        const status = provider === 'robin' ? deps.robinOnboarding.cancel(id) : deps.adminOAuth.cancel(id);
        sendJson(res, 200, { ok: true, data: { provider, ...status } });
        return;
      }
      if (!oauthMatch[2] && req.method === 'GET') {
        const status = provider === 'robin'
          ? (deps.robinOnboarding?.status?.().id === id ? deps.robinOnboarding.status() : null)
          : deps.adminOAuth.status(id);
        if (!status) { fail(res, 404, 'oauth_flow_not_found', '授权流程不存在或已过期。'); return; }
        sendJson(res, 200, { ok: true, data: { provider, ...status } });
        return;
      }
    }
    if (req.method === 'GET' && route === `${PREFIX}/proxies`) {
      sendJson(res, 200, { ok: true, data: deps.proxyManager.snapshot() });
      return;
    }
    if (req.method === 'POST' && route === `${PREFIX}/proxies`) {
      const body = await readJson(req);
      sendJson(res, 200, { ok: true, data: deps.proxyManager.upsert(body) });
      return;
    }
    const proxyCheckMatch = route.match(/^\/_admin\/v1\/proxies\/([^/]+)\/check$/);
    if (proxyCheckMatch && req.method === 'POST') {
      const proxyId = decodeURIComponent(proxyCheckMatch[1]);
      sendJson(res, 200, { ok: true, data: await deps.proxyManager.check(proxyId) });
      return;
    }
    const proxyMatch = route.match(/^\/_admin\/v1\/proxies\/([^/]+)$/);
    if (proxyMatch && req.method === 'DELETE') {
      const proxyId = decodeURIComponent(proxyMatch[1]);
      sendJson(res, 200, { ok: true, data: deps.proxyManager.remove(proxyId) });
      return;
    }
    const recheckMatch = route.match(/^\/_admin\/v1\/accounts\/([^/]+)\/recheck$/);
    if (recheckMatch && req.method === 'POST') {
      const accountId = decodeURIComponent(recheckMatch[1]);
      const pool = poolFor(deps, accountId, queryProvider(requestUrl));
      const result = await pool.recheckAccount(accountId, { signal: AbortSignal.timeout(15_000) });
      sendJson(res, 200, { ok: true, data: result });
      return;
    }
    const accountProxyMatch = route.match(/^\/_admin\/v1\/accounts\/([^/]+)\/proxy$/);
    if (accountProxyMatch && req.method === 'PUT') {
      const accountId = decodeURIComponent(accountProxyMatch[1]);
      const body = await readJson(req);
      const pool = poolFor(deps, accountId, String(body.provider || ''));
      if (!pool.status().some((account) => account.id === accountId)) {
        throw Object.assign(new Error('账号不存在或已被删除。'), { status: 404, code: 'account_not_found' });
      }
      const proxyId = body.proxyId === null ? null : String(body.proxyId || '');
      const snapshot = deps.proxyManager.bind(proxyBindingKey(pool, accountId, deps), proxyId);
      sendJson(res, 200, { ok: true, data: { snapshot } });
      return;
    }
    const accountMatch = route.match(/^\/_admin\/v1\/accounts\/([^/]+)$/);
    if (accountMatch) {
      const accountId = decodeURIComponent(accountMatch[1]);
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const pool = poolFor(deps, accountId, String(body.provider || ''));
        const result = pool.updateAccount(accountId, { enabled: body.enabled, weight: body.weight });
        sendJson(res, 200, { ok: true, data: result });
        return;
      }
      if (req.method === 'DELETE') {
        const pool = poolFor(deps, accountId, queryProvider(requestUrl));
        const result = pool.removeAccount(accountId);
        sendJson(res, 200, { ok: true, data: result });
        return;
      }
    }
    fail(res, 404, 'admin_route_not_found', '管理接口不存在。');
  } catch (error) {
    adminFail(res, error);
  } finally {
    active -= 1;
  }
}

module.exports = {
  API_VERSION,
  accountList,
  PREFIX,
  dailyTrend,
  handleAdminRequest,
  isLoopback,
  maskEmail,
  overview,
  readAdminToken,
  safeEqual,
  sumRange,
  usageSummary
};
