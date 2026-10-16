'use strict';
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const http2 = require('node:http2');
const { RobinGrpcTransport } = require('./robin-provider');

const bindingKey = id => `robin:${id}`;
function proxyError(message) { return Object.assign(new Error(message), { code: 'robin_proxy_error', status: 503 }); }
function configuredProxy(manager, key) {
  const proxyId = manager.state.bindings[key];
  const proxy = manager.state.proxies.find(p => p.id === proxyId);
  if (!proxy) throw proxyError('Gemini App 账号必须绑定有效代理；请在管理看板配置出口。');
  return proxy;
}
function accountFetch(manager, id, fetchImpl) {
  return (input, init) => manager.via(configuredProxy(manager, bindingKey(id)), input, init, fetchImpl);
}
function tunnel(origin, proxy, signal) {
  return new Promise((resolve, reject) => {
    const target = new URL(origin), url = new URL(proxy.url);
    const authority = `${target.hostname}:${target.port || 443}`;
    let socket, secure, settled = false;
    const headers = { Host: authority };
    if (url.username || url.password) headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64');
    const req = (url.protocol === 'https:' ? https : http).request({ hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), method: 'CONNECT', path: authority, headers });
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const fail = () => { if (settled) return; settled = true; cleanup(); req.destroy(); socket?.destroy(); secure?.destroy(); reject(proxyError('Gemini App 代理隧道建立失败。')); };
    const abort = fail;
    const timer = setTimeout(fail, 15_000); timer.unref?.();
    req.on('error', fail);
    req.on('connect', (response, connected, head) => {
      socket = connected;
      if (settled || response.statusCode !== 200 || head.length) { socket.destroy(); fail(); return; }
      secure = tls.connect({ socket, servername: target.hostname, ALPNProtocols: ['h2'] });
      secure.once('error', fail);
      secure.once('secureConnect', () => {
        if (secure.alpnProtocol !== 'h2') { fail(); return; }
        if (settled) { secure.destroy(); return; }
        settled = true; cleanup(); resolve(secure);
      });
    });
    if (signal?.aborted) fail();
    else { signal?.addEventListener('abort', abort, { once: true }); req.end(); }
  });
}
// Preserve the synchronous streaming transport contract while CONNECT/TLS is pending.
class ProxyRobinTransport {
  constructor({ manager, accountId, origin = 'https://robinfrontend-pa.googleapis.com', tunnelImpl = tunnel }) {
    this.manager = manager; this.accountId = accountId; this.origin = origin; this.tunnelImpl = tunnelImpl;
  }
  async unary(path, token, message = Buffer.alloc(0), options = {}) {
    const stream = this.request(path, token, options);
    stream.end(message);
    return (await stream.done)[0] || Buffer.alloc(0);
  }
  request(path, token, options = {}) {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let inner, queue = [], queuedBytes = 0;
    const done = (async () => {
      const proxy = configuredProxy(this.manager, bindingKey(this.accountId));
      this.manager.active.set(proxy.id, (this.manager.active.get(proxy.id) || 0) + 1);
      let socket;
      try {
        signal.throwIfAborted();
        socket = await this.tunnelImpl(this.origin, proxy, signal);
        signal.throwIfAborted();
        const transport = new RobinGrpcTransport({ origin: this.origin, connectImpl: origin => http2.connect(origin, { createConnection: () => socket }) });
        inner = transport.request(path, token, { ...options, signal });
        for (const [method, data] of queue) inner[method](data);
        queue = []; queuedBytes = 0;
        return await inner.done;
      } finally {
        socket?.destroy(); queue = []; queuedBytes = 0;
        this.manager.active.set(proxy.id, Math.max(0, (this.manager.active.get(proxy.id) || 1) - 1));
      }
    })();
    const send = (method, data) => {
      signal.throwIfAborted();
      if (inner) return inner[method](data);
      queuedBytes += data?.length || 0;
      if (queuedBytes > 8 * 1024 * 1024) { controller.abort(proxyError('Gemini App 待连接缓冲超过限制。')); return false; }
      queue.push([method, data]); return true;
    };
    return { write: data => send('write', data), end: data => send('end', data), close: () => controller.abort(), done };
  }
}
module.exports = { ProxyRobinTransport, accountFetch, bindingKey, configuredProxy, tunnel };
