'use strict';

const fs = require('node:fs');
const { normalizeAnthropic, normalizeChat, normalizeResponses } = require('./protocol');
const { capturedNativeClient } = require('./agy-client-profile');
const { sanitizeClientIdentity } = require('./client-identity');
const { capturedInstructionProfile } = require('./client-instruction-profile');
const { semanticEnvelopeMode, semanticEnvelopeMatches } = require('./client-instruction-envelope');
const { classifyTool, explainToolDecline } = require('./agy-tool-semantics');
const { prepareToolAdapter } = require('./agy-tool-adapter');
const { buildDirectRequest } = require('./direct-provider');

function normalizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = v;
  return out;
}

function detectProtocol(body, headers, explicit = '') {
  const forced = String(explicit || '').trim().toLowerCase();
  if (['anthropic', 'responses', 'chat'].includes(forced)) return forced;
  if (body && typeof body === 'object') {
    if (body.input !== undefined || body.instructions !== undefined || body.previous_response_id !== undefined) return 'responses';
    if (headers['anthropic-version'] || headers['x-claude-code-session-id'] || Array.isArray(body.tools) && body.tools.some(t => t && 'input_schema' in t)) {
      return 'anthropic';
    }
  }
  return 'chat';
}

function diagnoseClientRequest(input = {}) {
  const envelope = input && typeof input === 'object' && input.body && typeof input.body === 'object'
    ? input
    : { body: input, headers: {} };
  const headers = normalizeHeaders(envelope.headers);
  const body = envelope.body || {};
  const protocol = detectProtocol(body, headers, envelope.protocol);
  const model = String(envelope.model || body.model || 'gemini-4-neon-high');
  const req = { headers };

  const normalized = protocol === 'anthropic'
    ? normalizeAnthropic(body)
    : protocol === 'responses'
      ? normalizeResponses(body)
      : normalizeChat(body);

  const nativeClientProfile = capturedNativeClient(req, normalized);
  const identity = sanitizeClientIdentity(normalized, { clientProfile: nativeClientProfile, model });
  const instructionProfile = capturedInstructionProfile(identity.normalized) || identity.metadata.profile;
  const legacyAdapter = prepareToolAdapter(identity.normalized, { clientProfile: nativeClientProfile });

  const native = {
    clientProfile: nativeClientProfile,
    identityClientProfile: nativeClientProfile
  };
  const wire = buildDirectRequest(normalized, model, 'diagnose-project', 'diagnose-session', '', null, native);

  const toolRecords = Array.isArray(native.toolAdapter?.records) ? native.toolAdapter.records : [];
  const toolViews = { direct: 0, json: 0, native: 0, service: 0, legacy: 0 };
  const tools = (normalized.tools || []).filter(t => !t.internal).map((tool) => {
    const record = toolRecords.find(r => r.clientName === tool.name);
    const views = Array.isArray(record?.views) ? record.views.map(v => ({ name: v.wireName || v.name || '', mode: v.mode || '' })) : [];
    for (const v of views) {
      if (v.mode === 'mcp-direct') toolViews.direct++;
      else if (v.mode === 'mcp-json') toolViews.json++;
      else if (v.mode === 'native') toolViews.native++;
      else if (v.mode === 'native-service') toolViews.service++;
      else if (v.mode === 'mcp-legacy') toolViews.legacy++;
    }
    const classified = classifyTool(tool);
    return {
      clientName: tool.name,
      kind: tool.kind || 'function',
      views,
      semantic: classified
        ? { matched: true, family: classified.familyName, nativeName: classified.family.native, nameKnown: classified.nameKnown, parameterCount: classified.parameterCount }
        : { matched: false, declineReason: explainToolDecline(tool) }
    };
  });

  const generation = wire?.request?.generationConfig || {};
  return {
    protocol,
    model,
    headersSeen: {
      userAgent: String(headers['user-agent'] || ''),
      originator: String(headers.originator || ''),
      hasClaudeSessionId: Boolean(String(headers['x-claude-code-session-id'] || '').trim())
    },
    detection: {
      nativeClientProfile: nativeClientProfile || null,
      identityClient: identity.metadata.profile?.client || instructionProfile?.client || null,
      templateVersion: identity.metadata.profile?.templateVersion || instructionProfile?.templateVersion || null,
      frameworkVersion: identity.metadata.frameworkVersion || null,
      identityRules: identity.metadata.rules || [],
      editedInstructionBlocks: identity.metadata.editedInstructionBlocks || []
    },
    instructionEnvelope: {
      mode: semanticEnvelopeMode(),
      semanticMatchesModel: semanticEnvelopeMatches(model),
      applied: Boolean(native.clientInstructionEnvelope)
    },
    generation: {
      maxOutputTokens: generation.maxOutputTokens ?? null,
      thinkingConfig: generation.thinkingConfig || null,
      toolMode: wire?.request?.toolConfig?.functionCallingConfig?.mode || 'AUTO'
    },
    toolsSummary: {
      declared: tools.length,
      wireDeclarations: (wire?.request?.tools || []).reduce((n, item) => n + (item.functionDeclarations?.length || 0), 0),
      legacyMapped: legacyAdapter.mappingCount,
      views: toolViews
    },
    tools
  };
}

function diagnoseRequestFile(filePath, options = {}) {
  const raw = filePath === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return diagnoseClientRequest({ ...parsed, ...(options.protocol ? { protocol: options.protocol } : {}), ...(options.model ? { model: options.model } : {}) });
}

module.exports = { diagnoseClientRequest, diagnoseRequestFile, detectProtocol };
