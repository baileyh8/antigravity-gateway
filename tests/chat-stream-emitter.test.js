'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createChatTextEmitter } = require('../antigravity-gateway');
const { chatResponse } = require('../src/protocol');

for (const withTools of [false, true]) {
  test(`chat streaming preserves cache and reasoning usage with tools=${withTools}`, () => {
    const { res, parse } = capture();
    const emitter = createChatTextEmitter(res, 'gemini-test-high');
    emitter.onDelta('Checking');
    emitter.finish(chatResponse('gemini-test-high', {
      text: 'Checking',
      toolCalls: withTools ? [{ id: 'call_1', name: 'read', arguments: { path: '/fixture' } }] : [],
      usage: { input_tokens: 100, output_tokens: 10, thinking_tokens: 2, cache_read_tokens: 80, total_tokens: 112 }
    }));
    const chunks = parse();
    const expected = {
      prompt_tokens: 100, completion_tokens: 12, total_tokens: 112,
      prompt_tokens_details: { cached_tokens: 80 },
      completion_tokens_details: { reasoning_tokens: 2 }
    };
    assert.deepEqual(chunks.at(-2).usage, expected);
    assert.deepEqual(chunks.at(-1).usage, expected);
    assert.deepEqual(chunks.at(-1).choices, []);
    assert.equal(chunks.at(-2).choices[0].finish_reason, withTools ? 'tool_calls' : 'stop');
    assert.equal(contentOf(chunks), 'Checking');
    assert.equal(res.ended, true);
  });
}

/**
 * Capture the SSE frames one emitter writes into an in-memory response.
 * `writeHead` is a no-op so the buffered `emitChatStream` fallback the emitter
 * may delegate to can also run against this fixture.
 */
function capture() {
  const frames = [];
  const res = {
    ended: false,
    headersSent: false,
    writeHead() { res.headersSent = true; return res; },
    write(chunk) { frames.push(String(chunk)); return true; },
    end() { res.ended = true; }
  };
  const parse = () => frames
    .join('')
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => frame.slice('data: '.length))
    .filter((payload) => payload !== '[DONE]')
    .map((payload) => JSON.parse(payload));
  return { res, parse };
}

/** Every content delta the client would render, in arrival order. */
function contentOf(chunks) {
  return chunks.map((chunk) => chunk.choices?.[0]?.delta?.content ?? '').join('');
}

/** Every tool-call delta the client would render, in arrival order. */
function toolCallsOf(chunks) {
  return chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls ?? []);
}

function body(content, toolCalls) {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: 0,
    model: 'gemini-test-high',
    choices: [{
      index: 0,
      message: { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls ? 'tool_calls' : 'stop'
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
  };
}

const SHELL_CALL = [{ id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } }];

test('chat live emitter forwards each streamed delta exactly once', () => {
  const { res, parse } = capture();
  const emitter = createChatTextEmitter(res, 'gemini-test-high');
  emitter.onDelta('深海');
  emitter.onDelta('的灯塔');
  emitter.finish(body('深海的灯塔'));

  assert.equal(contentOf(parse()), '深海的灯塔');
  assert.equal(res.ended, true);
});

test('chat live emitter appends tool calls without replaying streamed text', () => {
  const { res, parse } = capture();
  const emitter = createChatTextEmitter(res, 'gemini-test-high');
  emitter.onDelta('先看');
  emitter.onDelta('一下');
  emitter.finish(body('先看一下', SHELL_CALL));

  const chunks = parse();
  // The regression this guards: replaying the finished message produced
  // '先看一下先看一下' for a client that had already received both deltas.
  assert.equal(contentOf(chunks), '先看一下');

  const calls = toolCallsOf(chunks);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].index, 0);
  assert.equal(calls[0].function.name, 'bash');

  assert.equal(chunks.at(-2).choices[0].finish_reason, 'tool_calls');
  assert.deepEqual(chunks.at(-1).usage, body('').usage);
});

test('chat live emitter still sends the whole answer when upstream streamed nothing', () => {
  const { res, parse } = capture();
  const emitter = createChatTextEmitter(res, 'gemini-test-high');
  emitter.finish(body('没有流式的一段话', SHELL_CALL));

  const chunks = parse();
  assert.equal(contentOf(chunks), '没有流式的一段话');
  assert.equal(toolCallsOf(chunks).length, 1);
});

test('chat live emitter sends only the unseen tail when the answer grew after the last delta', () => {
  const { res, parse } = capture();
  const emitter = createChatTextEmitter(res, 'gemini-test-high');
  emitter.onDelta('前半段');
  emitter.finish(body('前半段加尾'));

  const chunks = parse();
  assert.equal(contentOf(chunks), '前半段加尾');
});
