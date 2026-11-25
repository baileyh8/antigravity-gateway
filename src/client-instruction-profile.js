'use strict';
const crypto = require('node:crypto');
const profiles = require('./data/client-instruction-profiles-20261121.json');
function stable(value, depth = 0) {
  if (depth > 64) throw new Error('schema-depth');
  return Array.isArray(value) ? value.map(v => stable(v, depth + 1))
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k], depth + 1)])) : value;
}
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const desktopTitle = require('./data/claude-desktop-title-2.1.330.json');
const desktopFramework = require('./data/claude-desktop-2.1.330-framework.json');
function desktopTitleProfile(normalized) {
  if (typeof normalized?.system !== 'string' || !Array.isArray(normalized.tools)
    || normalized.tools.some(tool => !tool.internal)) return null;
  let rest = normalized.system.trimStart();
  const billing = rest.match(/^x-anthropic-billing-header: cc_version=\d+\.\d+\.\d+(?:\.[a-z0-9]{1,16})?; cc_entrypoint=claude-desktop-3p;\s*/);
  if (billing) rest = rest.slice(billing[0].length);
  const identity = desktopTitle.identities.find(text => rest.startsWith(text));
  if (identity) rest = rest.slice(identity.length).trimStart();
  if (!rest.startsWith(desktopTitle.system) || rest.split(desktopTitle.system).length !== 2) return null;
  const tail = rest.slice(desktopTitle.system.length);
  if (tail) {
    const env = tail.match(/^\n\n# Environment\nYou have been invoked in the following environment: ?\n - Primary working directory: [^\n]+\n - Is a git repository: (?:true|false)\n - Platform: [^\n]+\n - Shell: [^\n]+\n - OS Version: [^\n]+\n/);
    if (!env || hash(tail.slice(env[0].length, env[0].length + desktopFramework.environmentSafetyTextLength)) !== desktopFramework.environmentSafetyTextSha256) return null;
    const end = env[0].length + desktopFramework.environmentSafetyTextLength;
    if (!/^\n\nYou are powered by the model [A-Za-z0-9._:/\[\]-]{1,160}\.\n\nToday's date is \d{4}-\d{2}-\d{2}\.\s*$/.test(tail.slice(end))) return null;
  }
  return { client: 'claude', templateVersion: desktopTitle.version, evidence: ['claude-desktop-title-system-template'] };
}
function capturedInstructionProfile(normalized) {
  const title = desktopTitleProfile(normalized);
  if (title) return title;
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
