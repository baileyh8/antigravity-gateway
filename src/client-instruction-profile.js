'use strict';
const crypto = require('node:crypto');
const profiles = require('./data/client-instruction-profiles-20261121.json');
function stable(value, depth = 0) {
  if (depth > 64) throw new Error('schema-depth');
  return Array.isArray(value) ? value.map(v => stable(v, depth + 1))
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k], depth + 1)])) : value;
}
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function capturedInstructionProfile(normalized) {
  const system = normalized?.system;
  if (typeof system !== 'string' || !Array.isArray(normalized.tools)) return null;
  for (const profile of profiles) {
    if (profile.anchor) {
      const start = system.indexOf(profile.anchor), end = start + profile.frameworkLength;
      if (start < 0 || system.indexOf(profile.anchor, start + profile.anchor.length) >= 0
        || (start > 0 && system.slice(start - 2, start) !== '\n\n')
        || hash(system.slice(start, end)) !== profile.frameworkSha256
        || (end !== system.length && !system.slice(end).startsWith('\n\n'))) continue;
    } else if (hash(system.slice(0, profile.prefixLength)) !== profile.prefixSha256
      || !system.slice(profile.prefixLength).startsWith('\n\n')) continue;
    try {
      if (!profile.tools.every(expected => {
        const matches = normalized.tools.filter(t => t.name === expected.name);
        return matches.length === 1 && hash(JSON.stringify(stable(matches[0].schema))) === expected.sha256;
      })) continue;
    } catch { continue; }
    // A translation capability only: never authentication or session ownership.
    return { client: profile.client, templateVersion: profile.version, evidence: [profile.evidence] };
  }
  return null;
}
module.exports = { capturedInstructionProfile };
