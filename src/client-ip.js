'use strict';

const net = require('node:net');

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

const LOOPBACK_PROXIES = ['127.0.0.1/8', '::1'];

function parseTrustedProxies(raw = process.env.ANTIGRAVITY_TRUST_PROXY) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return LOOPBACK_PROXIES;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (['0', 'false', 'off', 'no', 'none'].includes(normalized)) return [];
  if (['1', 'true', 'on', 'yes', 'loopback'].includes(normalized)) return LOOPBACK_PROXIES;
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTrustedProxy(address, trustedProxies) {
  if (!trustedProxies.length) return false;
  return ipAllowed(trustedProxies, address);
}

function resolveClientIp(req, { trustProxy } = {}) {
  const remote = normalizedAddress(req?.socket?.remoteAddress || '');
  const trusted = Array.isArray(trustProxy) ? trustProxy : parseTrustedProxies(trustProxy);
  if (!remote || !isTrustedProxy(remote, trusted)) return remote;

  const forwardedRaw = String(req?.headers?.['x-forwarded-for'] || '').trim();
  if (forwardedRaw) {
    const hops = forwardedRaw
      .split(',')
      .map((part) => normalizedAddress(part))
      .filter((hop) => net.isIP(hop));
    // Walk from right to left and pick the first non-trusted hop so a client
    // cannot prepend a spoofed allowlisted IP ahead of the reverse proxy hop.
    for (let index = hops.length - 1; index >= 0; index -= 1) {
      if (!isTrustedProxy(hops[index], trusted)) return hops[index];
    }
    if (hops.length) return hops[0];
  }

  const realIp = normalizedAddress(req?.headers?.['x-real-ip'] || '');
  if (net.isIP(realIp)) return realIp;

  return remote;
}

module.exports = {
  LOOPBACK_PROXIES,
  ipAllowed,
  isTrustedProxy,
  normalizedAddress,
  parseTrustedProxies,
  resolveClientIp
};
