'use strict';
const writers = new WeakMap();
class SseWriter {
  constructor(res, { maxBytes = Number(process.env.ANTIGRAVITY_GATEWAY_SSE_BUFFER_BYTES || 8 * 1024 * 1024), timeoutMs = 30_000 } = {}) {
    this.res = res; this.maxBytes = maxBytes; this.timeoutMs = timeoutMs;
    this.queue = []; this.bytes = 0; this.blocked = false; this.ending = false; this.waiters = []; this.error = null;
    res.on?.('drain', () => { clearTimeout(this.timer); this.blocked = false; this.pump(); });
    res.on?.('close', () => this.fail(new Error('SSE client closed')));
    res.on?.('error', error => this.fail(error));
  }
  fail(error) {
    if (this.error) return;
    this.error = error; clearTimeout(this.timer); this.queue = []; this.bytes = 0;
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }
  write(chunk) {
    if (this.error) throw this.error;
    const bytes = Buffer.byteLength(chunk);
    if (this.bytes + (this.res.writableLength || 0) + bytes > this.maxBytes) {
      const error = Object.assign(new Error('SSE 客户端消费过慢，输出缓冲已达上限。'), { code: 'slow_client', status: 503 });
      this.fail(error); this.res.destroy?.(); throw error;
    }
    this.queue.push(chunk); this.bytes += bytes; this.pump();
  }
  pump() {
    if (this.error || this.blocked) return;
    while (this.queue.length) {
      const chunk = this.queue.shift(); this.bytes -= Buffer.byteLength(chunk);
      if (this.res.write(chunk) === false) {
        this.blocked = true;
        this.timer = setTimeout(() => { this.fail(new Error('SSE drain timeout')); this.res.destroy?.(); }, this.timeoutMs);
        this.timer.unref?.(); return;
      }
    }
    for (const waiter of this.waiters.splice(0)) waiter.resolve();
    if (this.ending) this.res.end();
  }
  ready() {
    if (this.error) return Promise.reject(this.error);
    if (!this.blocked && !this.queue.length) return Promise.resolve();
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }
  end() { this.ending = true; this.pump(); }
}
function writer(res) { if (!writers.has(res)) writers.set(res, new SseWriter(res)); return writers.get(res); }
function writeStream(res, chunk) { writer(res).write(chunk); }
function streamReady(res) { return writer(res).ready(); }
function endStream(res) { writer(res).end(); }
module.exports = { SseWriter, writeStream, streamReady, endStream };
