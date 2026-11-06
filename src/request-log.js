'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { reverseLines, forwardLines } = require('./log-reader');
const { pipeline } = require('node:stream/promises');
const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();
const FLUSH_BYTES = 64 * 1024;
const FLUSH_MS = 200;

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function requestContext() {
  return context.getStore() || null;
}

function runRequestLog(entry, callback) {
  return context.run(entry, callback);
}

class RequestLog {
  constructor({ configDir, now = () => Date.now(), retentionDays = 30, maxBytes = 500 * 1024 * 1024 } = {}) {
    this.directory = path.join(configDir, 'logs', 'requests');
    this.now = now;
    this.retentionDays = Math.max(1, Number(retentionDays) || 30);
    this.maxBytes = Math.max(16 * 1024 * 1024, Number(maxBytes) || 500 * 1024 * 1024);
    this.pending = new Map();
    this.pendingBytes = 0;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    this.timer.unref?.();
    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), 3600000);
    this.pruneTimer.unref?.();
  }

  createContext(req, key) {
    return {
      at: this.now(),
      requestId: `req_${crypto.randomBytes(6).toString('hex')}`,
      method: String(req.method || 'GET'),
      path: String(req.url || '').split('?')[0],
      keyId: key?.id || '',
      keyName: key?.name || '',
      ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || String(req.socket?.remoteAddress || ''),
      ua: String(req.headers['user-agent'] || '').slice(0, 120),
      model: '',
      upstreamModel: '',
      account: '',
      stream: false,
      status: 0,
      code: '',
      latencyMs: 0,
      ttftMs: null,
      usage: null
    };
  }

  record(entry) {
    if (!entry || !entry.requestId) return;
    const day = dayKey(entry.at || this.now());
    const usage = entry.usage || {};
    const line = JSON.stringify({
      ts: entry.at,
      id: entry.requestId,
      key: entry.keyId || '',
      keyName: entry.keyName || '',
      model: entry.model || '',
      upstreamModel: entry.upstreamModel || '',
      account: entry.account || '',
      status: entry.status || 0,
      code: entry.code || '',
      latencyMs: Math.max(0, Number(entry.latencyMs) || 0),
      ttftMs: entry.ttftMs ?? null,
      stream: Boolean(entry.stream),
      input: Number(usage.input_tokens) || 0,
      output: Number(usage.output_tokens) || 0,
      cached: Number(usage.cache_read_tokens) || 0,
      thinking: Number(usage.thinking_tokens) || 0,
      total: Number(usage.total_tokens) || 0,
      ip: entry.ip || '',
      ua: entry.ua || '',
      tools: Number(entry.toolCount) || 0,
      mapped: Number(entry.mappedCount) || 0,
      bytes: Number(entry.bytes) || 0
    });
    if (this.pendingBytes + Buffer.byteLength(line) > 256 * 1024) { this.dropped = (this.dropped || 0) + 1; return; }
    const bucket = this.pending.get(day) || [];
    bucket.push(line);
    this.pending.set(day, bucket);
    this.pendingBytes += Buffer.byteLength(line) + 1;
    if (this.pendingBytes >= FLUSH_BYTES) this.flush();
  }

  flush() {
    if (this.writing || this.clearing || !this.pending.size) return this.writing;
    const batch = this.pending;
    this.pending = new Map();
    this.pendingBytes = 0;
    this.writing = (async () => {
      try {
        await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
        for (const [day, lines] of batch) await fs.promises.appendFile(path.join(this.directory, `${day}.jsonl`), `${lines.join('\n')}\n`, { mode: 0o600 });
      } catch {
        this.writeFailures = (this.writeFailures || 0) + 1;
      } finally { this.writing = null; }
    })();
    return this.writing;
  }

  async worker(operation, options) {
    if (this.readerBusy) throw Object.assign(new Error('日志查询繁忙，请稍后重试。'), { status: 503, code: 'log_busy' });
    this.readerBusy = true;
    try {
      await this.writing;
      await this.flush();
      if (operation === 'clear') this.clearing = true;
      return await new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: { operation, directory: this.directory, now: this.now(), options }, resourceLimits: { maxOldGenerationSizeMb: 48 } });
        const timer = setTimeout(() => { worker.terminate(); reject(new Error('日志操作超时。')); }, 15000);
        worker.once('message', message => { clearTimeout(timer); if (message.error) reject(new Error(message.error)); else resolve(message.data); });
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('exit', code => { clearTimeout(timer); if (code) reject(new Error('日志查询未完成。')); });
      });
    } finally { this.readerBusy = false; this.clearing = false; }
  }

  queryAsync(options) { return this.worker('query', options); }
  clearAsync(options) { return this.worker('clear', options); }

  files() {
    try {
      return fs.readdirSync(this.directory)
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
        .sort();
    } catch {
      return [];
    }
  }

  prune() {
    const cutoff = dayKey(this.now() - this.retentionDays * 86400_000);
    const files = this.files();
    for (const name of files) {
      if (name.slice(0, 10) < cutoff) {
        try { fs.rmSync(path.join(this.directory, name), { force: true }); } catch { /* best effort */ }
      }
    }
    let total = 0;
    const kept = this.files().map((name) => {
      const file = path.join(this.directory, name);
      let size = 0;
      try { size = fs.statSync(file).size; } catch { /* missing */ }
      return { name, file, size };
    });
    for (const item of kept) total += item.size;
    for (const item of kept) {
      if (total <= this.maxBytes) break;
      try { fs.rmSync(item.file, { force: true }); total -= item.size; } catch { /* best effort */ }
    }
  }

  query({ days = 7, key = '', model = '', status = '', ip = '', page = 1, size = 20, bulk = false } = {}) {
    const limit = Math.max(1, Math.min(bulk ? 20000 : 200, Number(size) || 20));
    const currentPage = Math.max(1, Number(page) || 1);
    const cutoff = dayKey(this.now() - Math.max(1, Math.min(90, Number(days) || 7)) * 86400_000);
    const rows = [];
    let total = 0;
    let scanned = 0;
    const files = this.files().filter((name) => name.slice(0, 10) >= cutoff).reverse();
    for (const name of files) {
      for (const line of reverseLines(path.join(this.directory, name))) {
        if (!line) continue;
        scanned += 1;
        if (scanned > 20_000) break;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (key && row.key !== key && row.keyName !== key) continue;
        if (model && !String(row.model || '').toLowerCase().includes(String(model).toLowerCase())) continue;
        if (status) {
          if (status === '2xx' && !(row.status >= 200 && row.status < 300)) continue;
          else if (status === '4xx' && !(row.status >= 400 && row.status < 500)) continue;
          else if (status === '5xx' && !(row.status >= 500 && row.status < 600)) continue;
          else if (!['2xx', '4xx', '5xx'].includes(status) && String(row.status) !== String(status)) continue;
        }
        if (ip && !String(row.ip || '').startsWith(String(ip))) continue;
        rows.push(row);
        total += 1;
      }
      if (scanned > 20_000) break;
    }
    rows.sort((left, right) => Number(right.ts) - Number(left.ts));
    const start = (currentPage - 1) * limit;
    return { items: rows.slice(start, start + limit), total, page: currentPage, size: limit, hasMore: start + limit < total, truncated: scanned > 20000 };
  }

  exportCsv({ file, accountLabels = {}, ...options }) {
    const data = this.query({ ...options, page: 1, size: 20000, bulk: true });
    const fields = ['ts', 'id', 'keyName', 'model', 'upstreamModel', 'account', 'status', 'latencyMs', 'ttftMs', 'stream', 'input', 'output', 'cached', 'thinking', 'total', 'ip'];
    const cell = value => `"${String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""')}"`;
    const fd = fs.openSync(file, 'wx', 0o600);
    try {
      fs.writeSync(fd, '\uFEFF' + fields.join(',') + '\r\n');
      for (const row of data.items) fs.writeSync(fd, fields.map(field => cell(field === 'account' ? accountLabels[row.account] || (row.account ? '已移除账号' : '') : row[field])).join(',') + '\r\n');
    } finally { fs.closeSync(fd); }
    return { rows: data.items.length, truncated: data.truncated };
  }

  async streamCsv(res, options) {
    await fs.promises.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, `.export-${crypto.randomUUID()}.csv`);
    try {
      const result = await this.worker('exportCsv', { ...options, file });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="agy-request-logs.csv"', 'Cache-Control': 'no-store', 'X-Agy-Export-Rows': String(result.rows), 'X-Agy-Export-Truncated': String(Boolean(result.truncated)) });
      await pipeline(fs.createReadStream(file), res);
    } finally { await fs.promises.rm(file, { force: true }); }
  }

  clear({ before } = {}) {
    const cutoffTime = before ? Date.parse(before) : this.now();
    if (!Number.isFinite(cutoffTime) || cutoffTime > this.now()) throw Object.assign(new Error('清理时间无效或晚于当前时间。'), { status: 400, code: 'invalid_before' });
    const cutoff = dayKey(cutoffTime);
    let removed = 0;
    for (const name of this.files()) {
      const day = name.slice(0, 10);
      if (day < cutoff) {
        try { fs.rmSync(path.join(this.directory, name), { force: true }); removed += 1; } catch { /* best effort */ }
      } else if (day === cutoff) {
        const file = path.join(this.directory, name);
        try {
          const temporary = `${file}.clear-${process.pid}`;
          const fd = fs.openSync(temporary, 'w', 0o600);
          let kept = 0;
          try {
            for (const line of forwardLines(file)) {
              try { if (Number(JSON.parse(line).ts) >= cutoffTime) { fs.writeSync(fd, `${line}\n`); kept++; } } catch { /* malformed row */ }
            }
          } finally { fs.closeSync(fd); }
          if (kept) fs.renameSync(temporary, file);
          else { fs.rmSync(temporary, { force: true }); fs.rmSync(file, { force: true }); removed++; }
        } catch { /* best effort */ }
      }
    }
    return { before: new Date(Number.isFinite(cutoffTime) ? cutoffTime : this.now()).toISOString(), removedFiles: removed };
  }

  async stop() {
    clearInterval(this.timer);
    clearInterval(this.pruneTimer);
    await this.writing;
    await this.flush();
  }
}

module.exports = { RequestLog, requestContext, runRequestLog };

if (!isMainThread && workerData) {
  const log = Object.create(RequestLog.prototype);
  log.directory = workerData.directory;
  log.now = () => workerData.now;
  try { parentPort.postMessage({ data: log[workerData.operation](workerData.options) }); }
  catch (error) { parentPort.postMessage({ error: error.message }); }
}
