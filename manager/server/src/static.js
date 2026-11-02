'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

async function serveStatic(req, reply, config) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return reply.code(405).send('Method Not Allowed');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return reply.code(400).type('text/plain; charset=utf-8').send('无效路径');
  }
  if (!pathname.startsWith(config.basePath)) {
    return reply.code(404).type('text/plain; charset=utf-8').send('页面不存在');
  }

  let relative = pathname.slice(config.basePath.length) || '/';
  if (!relative.startsWith('/')) relative = `/${relative}`;
  if (relative === '/') relative = '/index.html';

  const candidates = relative.endsWith('/')
    ? [`${relative}index.html`]
    : [relative, `${relative}.html`, `${relative}/index.html`];
  const root = config.staticDir;

  for (const candidate of candidates) {
    const file = path.resolve(root, `.${candidate}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) continue;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) continue;
      const extension = path.extname(file).toLowerCase();
      const immutable = candidate.startsWith('/_next/static/');
      reply
        .header('Content-Type', MIME[extension] || 'application/octet-stream')
        .header('Content-Length', stat.size)
        .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : extension === '.html' ? 'no-store' : 'public, max-age=3600');
      if (req.method === 'HEAD') return reply.send();
      return reply.send(fs.createReadStream(file));
    } catch {
      // Try the next candidate.
    }
  }
  return reply.code(404).type('text/plain; charset=utf-8').send('页面不存在');
}

module.exports = { serveStatic };
