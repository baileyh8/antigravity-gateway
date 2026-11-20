'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-final-system-'));
process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR = directory;
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const { normalizeAnthropic, normalizeResponses } = require('../src/protocol');
const { buildDirectRequest } = require('../src/direct-provider');
const { prepareAntigravityTools } = require('../src/antigravity-tool-contract');

const safety = 'Preserve authorization boundaries. Require approval before modifying files. Never disclose credentials.';
const schema = { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false };
const toolName = 'lookup_orchard';
const prompt = 'Return the synthetic orchard label.';
const instructions = {
  claude: `x-anthropic-billing-header: cc_version=2.1.325; cc_entrypoint=cli;\n${safety}\n# Environment\nSynthetic test workspace.`,
  opencode: `${safety}\nFramework reference: tools.opencode.session_move(...). Confirm the session's working directory.`,
  codex: `${safety}\n# Environment\nSynthetic test workspace.`
};
function input(client, old) {
  if (client === 'claude') return normalizeAnthropic({ model: 'test', system: instructions[client],
    messages: [...(old ? [{ role: 'user', content: 'Synthetic seed.' }, { role: 'assistant', content: 'Seed acknowledged.' }] : []), { role: 'user', content: prompt }],
    tools: [{ name: toolName, description: 'Look up a synthetic label.', input_schema: schema }] });
  return normalizeResponses({ model: 'test', instructions: instructions[client],
    input: [...(old ? [{ role: 'user', content: 'Synthetic seed.' }, { role: 'assistant', content: 'Seed acknowledged.' }] : []), { role: 'user', content: prompt }],
    tools: [{ type: 'function', name: toolName, description: 'Look up a synthetic label.', parameters: schema }] });
}
for (const client of ['claude', 'opencode', 'codex']) {
  for (const model of ['gemini-4-argon-high', 'gemini-4-hydrogen-sonar']) {
    for (const old of [false, true]) {
      test(`${client} ${model} ${old ? 'submitted history' : 'fresh'} preserves final instructions and tool semantics`, () => {
        const normalized = input(client, old);
        const before = JSON.stringify(normalized);
        const request = buildDirectRequest(normalized, model, 'synthetic-project', `${client}-${model}-${old}`);
        const system = request.request.systemInstruction.parts.map(p => p.text || '').join('\n');
        assert.equal(system.split(safety).length - 1, 1);
        assert.ok(system.includes(instructions[client]));
        assert.equal(JSON.stringify(normalized), before);
        const adapter = prepareAntigravityTools(normalized);
        assert.equal(adapter.normalized.system, normalized.system);
        const call = { id: 'synthetic-call', name: toolName, arguments: { label: 'orchard' }, thoughtSignature: 'synthetic-signature' };
        const mapped = adapter.toProvider(call);
        assert.deepEqual(adapter.toClient(mapped), call);
        const result = { id: call.id, name: toolName, output: 'orchard' };
        assert.deepEqual(adapter.toClientResult(adapter.toProviderResult(result, mapped)), result);
      });
    }
  }
}
