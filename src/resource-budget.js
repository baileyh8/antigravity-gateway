'use strict';
class ByteBudget {
  constructor(limit) { this.limit = limit; this.used = 0; }
  acquire(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0 || this.used + bytes > this.limit) {
      throw Object.assign(new Error('网关内存预算繁忙，请稍后重试。'), { code: 'memory_budget_exceeded', status: 503 });
    }
    this.used += bytes;
    let released = false;
    return () => { if (!released) { released = true; this.used -= bytes; } };
  }
}
// Conservative retained size estimate, without allocating a second JSON string.
function retainedBytes(value) {
  const seen = new WeakSet(), pending = [value]; let bytes = 0;
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === 'string') bytes += item.length * 2 + 24;
    else if (item && typeof item === 'object') {
      if (seen.has(item)) continue; seen.add(item);
      if (Buffer.isBuffer(item) || ArrayBuffer.isView(item)) { bytes += item.byteLength; continue; }
      bytes += 64;
      for (const [key, child] of Object.entries(item)) { bytes += key.length * 2 + 16; pending.push(child); }
    } else bytes += 8;
  }
  return bytes;
}
module.exports = { ByteBudget, retainedBytes };
