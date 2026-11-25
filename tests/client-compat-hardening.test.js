'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');
const { envelopeClientInstructions, semanticEnvelopeMode, semanticEnvelopeMatches, PRECEDENCE } = require('../src/client-instruction-envelope');
const { capturedNativeClient, CLAUDE_GENERIC_CLIENT_PROFILE, CODEX_CLIENT_PROFILE } = require('../src/agy-client-profile');
const { classifyTool, explainToolDecline, buildRule } = require('../src/agy-tool-semantics');
const { prepareToolAdapter } = require('../src/agy-tool-adapter');
const { sanitizeClientIdentity } = require('../src/client-identity');
const { normalizeAnthropic, normalizeChat, normalizeResponses } = require('../src/protocol');
const { buildDirectRequest } = require('../src/direct-provider');
const { diagnoseClientRequest } = require('../src/client-compat-diagnose');
const { closeSchemaWorkers } = require('../src/schema-contract');

test.after(closeSchemaWorkers);

// 1. Tiered semantic instruction envelope
test('semantic instruction envelope supports off / neon / gemini4 / all scopes', (t) => {
  const old = process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;
  t.after(() => {
    if (old === undefined) delete process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;
    else process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE = old;
  });

  assert.equal(semanticEnvelopeMode('0'), 'off');
  assert.equal(semanticEnvelopeMode('1'), 'neon');
  assert.equal(semanticEnvelopeMode('neon'), 'neon');
  assert.equal(semanticEnvelopeMode('gemini4'), 'gemini4');
  assert.equal(semanticEnvelopeMode('all'), 'all');

  process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE = 'gemini4';
  for (const model of ['gemini-4-neon-high', 'gemini-4-hydrogen-high', 'gemini-4-hydrogen-sonar', 'gemini-4-carbon-medium', 'gemini-4-argon-high']) {
    assert.equal(semanticEnvelopeMatches(model), true, model);
    const source = normalizeResponses({ model, instructions: 'Client policy rule.', input: [{ role: 'user', content: 'hi' }] });
    const native = {};
    const wire = buildDirectRequest(source, model, 'proj', 'sess', '', null, native);
    assert.equal(native.clientInstructionEnvelope, true, model);
    assert.ok(wire.request.systemInstruction.parts[0].text.includes(PRECEDENCE));
    assert.ok(wire.request.contents[0].parts[0].text.includes('Client policy rule.'));
  }
  assert.equal(semanticEnvelopeMatches('gemini-3.8-flash-high'), false);
  assert.equal(semanticEnvelopeMatches('claude-sonnet-4-6'), false);

  process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE = 'all';
  assert.equal(semanticEnvelopeMatches('gemini-3.8-flash-high'), true);
  assert.equal(semanticEnvelopeMatches('gemini-4-hydrogen-high'), true);
  assert.equal(semanticEnvelopeMatches('claude-sonnet-4-6'), false);
  const r = { systemInstruction: { parts: [{ text: 'Policy' }] }, contents: [] };
  assert.equal(envelopeClientInstructions(r, 'Policy', null, 'gemini-3.8-flash-high', { protocol: 'chat', system: 'Policy' }), true);
});

// 2. Version-independent Claude Code & proxy-resilient DSH
test('future Claude Code semver uses generic profile while preserving Read allow_large and translating Write/Edit/Bash', () => {
  const fixture304 = require('./fixtures/claude-code-2.1.304-tools.json');
  const tools = Array.isArray(fixture304) ? fixture304 : fixture304.tools;
  const req = {
    headers: {
      'user-agent': 'claude-cli/2.4.12 (external, sdk-cli)',
      'x-claude-code-session-id': 'sess-future'
    }
  };
  const normalized = normalizeAnthropic({ tools: structuredClone(tools), messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(capturedNativeClient(req, normalized), CLAUDE_GENERIC_CLIENT_PROFILE);
  const adapter = prepareToolAdapter(normalized, { clientProfile: CLAUDE_GENERIC_CLIENT_PROFILE });
  const names = adapter.normalized.tools.map(t => t.name);
  assert.ok(names.includes('write_to_file'));
  assert.ok(names.includes('replace_file_content'));
  assert.ok(names.includes('run_command'));
  assert.ok(names.includes('Read'), 'Read with allow_large stays untouched');
  assert.ok(!names.includes('view_file'));
});

test('Claude Desktop billing header accepts future semvers when framework hash matches', () => {
  const fixture = require('./fixtures/claude-desktop-2.1.330-framework.json');
  const futureSystem = fixture.system.replace('cc_version=2.1.330', 'cc_version=2.3.10');
  const normalized = normalizeChat({
    model: 'gemini-4-hydrogen-sonar',
    messages: [{ role: 'system', content: futureSystem }, { role: 'user', content: 'hello' }]
  });
  const result = sanitizeClientIdentity(normalized, { model: 'gemini-4-hydrogen-sonar' });
  assert.equal(result.metadata.profile?.client, 'claude');
  assert.ok(result.metadata.rules.includes('claude-desktop-330-model-reminder'));
});

// 3. Generic tool semantics hardening
test('semantic mapping accepts omitted additionalProperties and nullable optional fields (Zod/Pydantic style)', () => {
  const readNoClosed = {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          line_start: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'start line' },
          max_lines: { type: ['integer', 'null'], description: 'max lines' }
        },
        required: ['path']
      }
    }
  };
  const execNoClosed = {
    type: 'function',
    function: {
      name: 'run_bash',
      description: 'Run bash command',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          working_directory: { anyOf: [{ type: 'string' }, { type: 'null' }] }
        },
        required: ['command']
      }
    }
  };
  const normalized = normalizeChat({ model: 'gemini-4-neon-high', messages: [{ role: 'user', content: 'hi' }], tools: [readNoClosed, execNoClosed] });
  const adapter = prepareToolAdapter(normalized, { clientProfile: '' });
  assert.deepEqual(adapter.normalized.tools.map(t => t.name), ['view_file', 'run_command']);
  const nativeRead = adapter.normalized.tools[0];
  assert.equal(nativeRead.schema.properties.StartLine.type, 'integer');
  assert.equal(nativeRead.schema.properties.EndLine.type, 'integer');
  const nativeExec = adapter.normalized.tools[1];
  assert.equal(nativeExec.schema.properties.Cwd.type, 'string');

  // Round-trip line_start + max_lines count conversion
  const call = adapter.toClient({ id: 'c1', name: 'view_file', arguments: { AbsolutePath: '/a.js', StartLine: 10, EndLine: 19 } });
  assert.deepEqual(call.arguments, { path: '/a.js', line_start: 10, max_lines: 10 });
  const providerBack = adapter.toProvider(call);
  assert.equal(providerBack.name, 'view_file');
  assert.equal(providerBack.arguments.StartLine, 10);
  assert.equal(providerBack.arguments.EndLine, 19);
});

test('semantic mapping supports direct start_line + end_line 1:1 without converting to count', () => {
  const directRead = {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a line range',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          start_line: { type: 'integer' },
          end_line: { type: 'integer' }
        },
        required: ['path']
      }
    }
  };
  const normalized = normalizeChat({ model: 'gemini-4-neon-high', messages: [{ role: 'user', content: 'hi' }], tools: [directRead] });
  const classified = classifyTool(normalized.tools[0]);
  assert.ok(classified);
  const rule = buildRule(classified);
  assert.equal(rule.directEndLine, true);
  assert.equal(rule.lineRange, undefined);

  const adapter = prepareToolAdapter(normalized, { clientProfile: '' });
  assert.deepEqual(adapter.normalized.tools.map(t => t.name), ['view_file']);
  const call = adapter.toClient({ id: 'c1', name: 'view_file', arguments: { AbsolutePath: '/a.js', StartLine: 10, EndLine: 25 } });
  assert.deepEqual(call.arguments, { path: '/a.js', start_line: 10, end_line: 25 });
  assert.deepEqual(adapter.toProvider(call).arguments, { AbsolutePath: '/a.js', StartLine: 10, EndLine: 25 });
});

test('semantic mapping rejects additionalProperties:true, nullable required fields, and limit+end_line conflict with exact reasons', () => {
  const openMap = normalizeChat({
    model: 'gemini-4-neon-high',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'read_file', description: 'open', parameters: { type: 'object', additionalProperties: true, properties: { path: { type: 'string' } }, required: ['path'] } } }]
  }).tools[0];
  assert.equal(classifyTool(openMap), null);
  assert.equal(explainToolDecline(openMap), 'additionalProperties_not_closed');

  const nullableReq = normalizeChat({
    model: 'gemini-4-neon-high',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'read_file', description: 'req null', parameters: { type: 'object', properties: { path: { type: ['string', 'null'] } }, required: ['path'] } } }]
  }).tools[0];
  assert.equal(classifyTool(nullableReq), null);
  assert.equal(explainToolDecline(nullableReq), 'nullable_required_property:path');

  const conflict = normalizeChat({
    model: 'gemini-4-neon-high',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 'read_file', description: 'conflict', parameters: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] } } }]
  }).tools[0];
  assert.equal(classifyTool(conflict), null);
  assert.equal(explainToolDecline(conflict), 'ambiguous_line_range_limit_and_endLine');
});

// 4. Codex structural framework fallback
test('Codex structural anchor fallback normalizes future Codex prompt wording while rejecting short/unanchored prompts', () => {
  const futureCodexPrompt = [
    'You are Codex, an agent based on GPT-7.1. You and the user share one workspace, and your job is to collaborate with them until their intended goal is completely handled.',
    '',
    '# General',
    'Follow workspace rules and keep edits focused.',
    '',
    '# Editing constraints',
    'Prefer apply_patch for source edits and exec_command for verification.',
    '',
    '# Validation',
    'Run relevant tests before finalizing.',
    '',
    '# Final answer',
    'Be concise and direct.',
    '',
    'Additional guidance line. '.repeat(200)
  ].join('\n');
  assert.ok(futureCodexPrompt.length >= 4000);

  const normalized = normalizeResponses({
    model: 'gemini-4-hydrogen-sonar',
    input: [
      { role: 'developer', content: futureCodexPrompt },
      { role: 'developer', content: 'PROJECT_RULE: Never leak secrets.' },
      { role: 'user', content: 'Quoted: You are Codex, an agent based on GPT-7.1.' }
    ]
  });
  const res = sanitizeClientIdentity(normalized, { clientProfile: CODEX_CLIENT_PROFILE, model: 'gemini-4-hydrogen-sonar' });
  assert.deepEqual(res.metadata.rules, ['codex-structural-framework-identity']);
  assert.deepEqual(res.metadata.editedInstructionBlocks, [0]);
  assert.ok(res.normalized.instructionMessages[0].text.startsWith('You are a coding assistant working with the user in a shared workspace.'));
  assert.ok(res.normalized.instructionMessages[0].text.includes('# Editing constraints'));
  assert.equal(res.normalized.instructionMessages[1].text, 'PROJECT_RULE: Never leak secrets.');
  assert.equal(res.normalized.messages[0].text, 'Quoted: You are Codex, an agent based on GPT-7.1.');

  // Non-Codex client or short/unanchored prompt stays untouched
  const nonCodex = sanitizeClientIdentity(normalized, { clientProfile: '', model: 'gemini-4-hydrogen-sonar' });
  assert.deepEqual(nonCodex.normalized, normalized);

  const shortPrompt = normalizeResponses({
    model: 'gemini-4-hydrogen-sonar',
    input: [{ role: 'developer', content: 'You are Codex, an agent based on GPT-7.1.\n\n# General\n# Validation\n# Final answer\nShort.' }]
  });
  assert.deepEqual(sanitizeClientIdentity(shortPrompt, { clientProfile: CODEX_CLIENT_PROFILE, model: 'gemini-4-hydrogen-sonar' }).normalized, shortPrompt);
});

// 5. Dry-run client compatibility diagnostic (module + CLI)
test('diagnoseClientRequest and CLI --diagnose-request report profile, envelope, and tool views offline', () => {
  const sample = {
    headers: { originator: 'Codex Desktop', 'user-agent': 'Codex Desktop/0.175.0' },
    body: {
      model: 'gemini-4-neon-high',
      instructions: 'Workspace policy.',
      input: [{ role: 'user', content: 'check' }],
      tools: [
        { type: 'function', name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] } },
        { type: 'function', name: 'custom_lookup', description: 'Custom', parameters: { type: 'object', properties: { ticket_id: { type: 'string' } }, required: ['ticket_id'] } }
      ]
    }
  };
  const report = diagnoseClientRequest(sample);
  assert.equal(report.protocol, 'responses');
  assert.equal(report.detection.nativeClientProfile, CODEX_CLIENT_PROFILE);
  assert.equal(report.toolsSummary.declared, 2);
  assert.equal(report.tools[0].semantic.matched, true);
  assert.equal(report.tools[0].semantic.nativeName, 'view_file');
  assert.equal(report.tools[1].semantic.matched, false);
  assert.equal(report.tools[1].semantic.declineReason, 'unknown_property:ticket_id');

  const cliPath = path.resolve(__dirname, '..', 'antigravity-gateway.js');
  const stdout = cp.execFileSync(process.execPath, [cliPath, '--diagnose-request', '-'], {
    input: JSON.stringify(sample),
    encoding: 'utf8',
    env: { ...process.env, ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE: 'gemini4' }
  });
  const cliReport = JSON.parse(stdout);
  assert.equal(cliReport.instructionEnvelope.mode, 'gemini4');
  assert.equal(cliReport.instructionEnvelope.applied, true);
  assert.equal(cliReport.detection.nativeClientProfile, CODEX_CLIENT_PROFILE);
});

test('request log conversion records safe allowlisted clientProfile alongside identityProfile', () => {
  const { runRequestLog } = require('../src/request-log');
  const entry = {};
  runRequestLog(entry, () => {
    const source = normalizeResponses({ model: 'gemini-4-neon-high', input: [{ role: 'user', content: 'hi' }] });
    buildDirectRequest(source, 'gemini-4-neon-high', 'proj', 'sess', '', null, { clientProfile: CLAUDE_GENERIC_CLIENT_PROFILE });
  });
  assert.equal(entry.conversion?.clientProfile, CLAUDE_GENERIC_CLIENT_PROFILE);
  const entryUnknown = {};
  runRequestLog(entryUnknown, () => {
    const source = normalizeResponses({ model: 'gemini-4-neon-high', input: [{ role: 'user', content: 'hi' }] });
    buildDirectRequest(source, 'gemini-4-neon-high', 'proj', 'sess', '', null, { clientProfile: 'untrusted-profile' });
  });
  assert.equal(entryUnknown.conversion?.clientProfile, null);
});
