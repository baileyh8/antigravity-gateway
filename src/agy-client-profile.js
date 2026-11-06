'use strict';

const { capturedClaudeClient } = require('./agy-client-compaction');
const { capturedHermesClient } = require('./agy-hermes-profile');
const { capturedDshClient } = require('./agy-dsh-profile');

const CODEX_CLIENT_PROFILE = 'codex-exec-0.159.2';
const CLAUDE_304_CLIENT_PROFILE = 'claude-code-2.1.304';
const CLAUDE_284_CLIENT_PROFILE = 'claude-code-2.1.284';

function capturedClaude304Client(req, normalized) {
  if (normalized.protocol !== 'anthropic') return '';
  const ua = req?.headers?.['user-agent'] || '';
  if (!/^claude-cli\/2\.1\.304(?:\s|$)/.test(ua)) return '';
  const sid = req?.headers?.['x-claude-code-session-id'];
  if (typeof sid !== 'string' || !sid.trim()) return '';
  return CLAUDE_304_CLIENT_PROFILE;
}

function capturedClaude284Client(req, normalized) {
  if (normalized.protocol !== 'anthropic') return '';
  const ua = req?.headers?.['user-agent'] || '';
  if (!/^claude-cli\/2\.1\.284(?:\s|\(|$)/.test(ua)) return '';
  const sid = req?.headers?.['x-claude-code-session-id'];
  if (typeof sid !== 'string' || !sid.trim()) return '';
  return CLAUDE_284_CLIENT_PROFILE;
}

// This is a versioned capability profile, not authentication or permission.
// Unknown clients retain their submitted declarations and existing routing.
function capturedNativeClient(req, normalized) {
  const claude304 = capturedClaude304Client(req, normalized);
  if (claude304) return claude304;
  const claude284 = capturedClaude284Client(req, normalized);
  if (claude284) return claude284;
  const claude = capturedClaudeClient(req, normalized);
  if (claude) return claude;
  const hermes = capturedHermesClient(normalized);
  if (hermes) return hermes;
  const dsh = capturedDshClient(req, normalized);
  if (dsh) return dsh;
  return capturedCodexClient(req, normalized) ? CODEX_CLIENT_PROFILE : '';
}

// Codex surfaces identify their protocol with `originator`. A provider proxy in
// front of Codex forwards that header only when the provider opts in through
// forwardClientHeaders, and it drops `session-id` entirely because that name is
// not on the forwardable list. Requiring the session header therefore made the
// profile unreachable for every relayed request: the user agent arrived as the
// runtime's own string (Bun/1.4.4) and the session header never arrived at all.
// The originator value alone is Codex-specific, and the declaration match in
// supported() still decides whether any tool is actually rewritten, so none of
// this can change an unmatched request.
const CODEX_ORIGINATORS = new Set([
  'codex_exec',
  'codex_cli_rs',
  'codex_app',
  'codex_work_desktop',
  'Codex Desktop'
]);

function capturedCodexClient(req, normalized) {
  if (normalized.protocol !== 'responses') return false;
  return CODEX_ORIGINATORS.has(String(req?.headers?.originator || '').trim());
}

module.exports = { capturedNativeClient, capturedCodexClient, CODEX_CLIENT_PROFILE, CODEX_ORIGINATORS, CLAUDE_304_CLIENT_PROFILE, CLAUDE_284_CLIENT_PROFILE };
