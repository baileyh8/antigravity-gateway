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

// Codex CLI identifies its protocol with `originator` and its conversation with
// `session-id`. A local relay in front of Codex (for example a provider proxy
// launched under Bun) forwards both but replaces the user agent with its own
// runtime string, which previously dropped the whole Codex profile and left
// exec_command / write_stdin / view_image untranslated. The declaration match
// in supported() still decides whether any tool is actually rewritten, so
// accepting a replaced user agent cannot change an unmatched request.
function capturedCodexClient(req, normalized) {
  if (normalized.protocol !== 'responses') return false;
  const headers = req?.headers || {};
  if (headers.originator !== 'codex_exec') return false;
  return typeof headers['session-id'] === 'string' && Boolean(headers['session-id'].trim());
}

module.exports = { capturedNativeClient, capturedCodexClient, CODEX_CLIENT_PROFILE, CLAUDE_304_CLIENT_PROFILE, CLAUDE_284_CLIENT_PROFILE };
