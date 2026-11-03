'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResponses } = require('../src/protocol');
const { buildDirectRequest } = require('../src/direct-provider');

const model = 'gemini-3.8-flash-high';
const encoded = Buffer.from('synthetic-screenshot-bytes').toString('base64');
const image = { type: 'input_image', image_url: `data:image/png;base64,${encoded}` };
const text = { type: 'input_text', text: 'Screenshot from the tool.' };
const metadata = { dimensions: { width: 20, height: 10 }, ok: true };

for (const type of ['function_call_output', 'custom_tool_call_output', 'computer_call_output']) {
  test(`${type} sends attachments once as native media while retaining non-media output`, () => {
    const input = [
      { type: 'function_call', call_id: 'call_image', name: 'inspect', arguments: '{}' },
      { type, call_id: 'call_image', output: [text, image, metadata, image] }
    ];
    const before = JSON.stringify(input);
    const normalized = normalizeResponses({ input });
    assert.doesNotMatch(normalized.messages.at(-1).text, /data:image|base64/);
    const result = buildDirectRequest(normalized, model, 'synthetic-project', 'synthetic-session')
      .request.contents.at(-1).parts[0].functionResponse;
    assert.deepEqual(result.response.output, [text, metadata]);
    assert.doesNotMatch(JSON.stringify(result.response), /data:image|base64/);
    assert.deepEqual(result.parts, [image, image].map(() => ({ inlineData: { mimeType: 'image/png', data: encoded } })));
    assert.equal(JSON.stringify(input), before, 'client input remains unmodified');
  });
}

test('image-only tool output keeps the image and an empty textual receipt', () => {
  const n = normalizeResponses({ input: [
    { type: 'function_call', call_id: 'call_image', name: 'inspect', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_image', output: [image] }
  ] });
  const result = buildDirectRequest(n, model, 'synthetic-project', 'synthetic-session')
    .request.contents.at(-1).parts[0].functionResponse;
  assert.equal(result.response.output, '');
  assert.equal(result.parts.length, 1);
  assert.equal(result.parts[0].inlineData.data, encoded);
});

test('ordinary tool strings and structured values retain their original semantics', () => {
  for (const output of ['  exact text\n', `literal data:image/png;base64,${encoded}`, null, false, 0,
    { content: 'business data', items: [1, 2] }, [text, metadata]]) {
    const n = normalizeResponses({ input: [
      { type: 'function_call', call_id: 'call_data', name: 'inspect', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_data', output }
    ] });
    const result = buildDirectRequest(n, model, 'synthetic-project', 'synthetic-session')
      .request.contents.at(-1).parts[0].functionResponse;
    assert.deepEqual(result.response.output, output);
    assert.equal(result.parts, undefined);
  }
});

test('nested Responses tool-result blocks also separate native attachments from text', () => {
  const n = normalizeResponses({ input: [
    { type: 'function_call', call_id: 'call_image', name: 'inspect', arguments: '{}' },
    { role: 'user', content: [{ type: 'function_call_output', call_id: 'call_image', output: [text, image] }] }
  ] });
  const result = buildDirectRequest(n, model, 'synthetic-project', 'synthetic-session')
    .request.contents.at(-1).parts[0].functionResponse;
  assert.deepEqual(result.response.output, [text]);
  assert.equal(result.parts.length, 1);
  assert.doesNotMatch(JSON.stringify(result.response), /data:image|base64/);
});
