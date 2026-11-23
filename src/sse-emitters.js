'use strict';

const crypto = require('node:crypto');
const { clientError } = require('./client-error');
const { streamTextRemainder } = require('./artifacts');
const { writeStream, streamReady, endStream } = require('./sse-writer');

function sendSse(res, event, data) {
  writeStream(res, `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`);
}

function beginSse(res) {
  if (!res.headersSent) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
  }
  writeStream(res, ': antigravity-gateway keep-alive\n\n');
  const timer = setInterval(() => {
    if (!res.destroyed && !res.writableEnded) { try { writeStream(res, ': keep-alive\n\n'); } catch { res.destroy(); } }
  }, 15000);
  timer.unref?.();
  return () => clearInterval(timer);
}

function textStreamingAllowed(normalized, { direct = true } = {}) {
  return Boolean(normalized.stream)
    && (direct || normalized.protocol === 'chat' || normalized.tools.length === 0)
    && !normalized.structuredSchema
    && !normalized.autoMode;
}

function createAnthropicTextEmitter(res, model) {
  const id = `msg_${crypto.randomUUID().replaceAll('-', '')}`;
  let started = false;
  let blockCount = 0;
  let activeBlock = null;
  let emittedText = '';
  let emittedThinking = '';
  const start = () => {
    if (started) return;
    started = true;
    sendSse(res, 'message_start', { type: 'message_start', message: {
      id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    } });
  };
  const closeBlock = () => {
    if (activeBlock) sendSse(res, 'content_block_stop', { type: 'content_block_stop', index: activeBlock.index });
    activeBlock = null;
  };
  const emitBlock = (kind, text) => {
    text = String(text || '');
    if (!text) return;
    start();
    if (activeBlock?.kind !== kind) {
      closeBlock();
      activeBlock = { index: blockCount++, kind };
      sendSse(res, 'content_block_start', { type: 'content_block_start', index: activeBlock.index,
        content_block: kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' } });
    }
    if (kind === 'thinking') emittedThinking += text;
    else emittedText += text;
    sendSse(res, 'content_block_delta', { type: 'content_block_delta', index: activeBlock.index,
      delta: kind === 'thinking' ? { type: 'thinking_delta', thinking: text } : { type: 'text_delta', text } });
  };
  const emitDeferredBlock = (block) => {
    closeBlock();
    const index = blockCount++;
    if (block.type === 'thinking') {
      sendSse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } });
      if (block.thinking) sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      if (block.signature) sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else {
      sendSse(res, 'content_block_start', { type: 'content_block_start', index, content_block: { ...block, input: {} } });
      sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    sendSse(res, 'content_block_stop', { type: 'content_block_stop', index });
  };
  return {
    onDelta: (text) => { emitBlock('text', text); return streamReady(res); },
    onThinkingDelta: (text) => { emitBlock('thinking', text); return streamReady(res); },
    finish: (body) => {
      start();
      const blocks = body.content || [];
      const finalThinking = blocks.filter(block => block.type === 'thinking' && !block.signature).map(block => block.thinking || '').join('');
      emitBlock('thinking', streamTextRemainder(emittedThinking, finalThinking));
      const finalText = blocks.filter(block => block.type === 'text').map(block => block.text || '').join('');
      emitBlock('text', streamTextRemainder(emittedText, finalText));
      closeBlock();
      for (const block of blocks) {
        if (block.type === 'text' || (block.type === 'thinking' && !block.signature)) continue;
        emitDeferredBlock(block);
      }
      // message_start went out before upstream usage existed; message_delta usage is cumulative per the Messages API.
      sendSse(res, 'message_delta', {
        type: 'message_delta',
        delta: { stop_reason: body.stop_reason, stop_sequence: null },
        usage: body.usage,
        ...(body.usage_known === false ? { usage_known: false } : {}),
        ...(body.artifacts ? { artifacts: body.artifacts } : {})
      });
      sendSse(res, 'message_stop', { type: 'message_stop' });
      endStream(res);
    }
  };
}

function sendChatChunk(res, base, choices, { includeUsage = false, usage = null, usageKnown } = {}) {
  writeStream(res, `data: ${JSON.stringify({ id: base.id, object: 'chat.completion.chunk', created: base.created,
    model: base.model, choices, ...(includeUsage ? { usage } : {}),
    ...(usageKnown === false ? { usage_known: false } : {}) })}\n\n`);
}

function createChatTextEmitter(res, model, { includeUsage = false } = {}) {
  const id = `chatcmpl_${crypto.randomUUID().replaceAll('-', '')}`;
  const created = Math.floor(Date.now() / 1000);
  let started = false;
  let emittedText = '';
  let emittedThinking = '';
  const base = { id, created, model };
  const chunk = (delta, finish_reason = null, extra = {}) => sendChatChunk(res, base,
    [{ index: 0, delta, finish_reason }], { includeUsage, ...extra });
  const start = () => {
    if (started) return;
    started = true;
    chunk({ role: 'assistant' });
  };
  return {
    onThinkingDelta: (text) => {
      text = String(text || '');
      if (!text) return;
      start();
      emittedThinking += text;
      chunk({ reasoning_content: text });
      return streamReady(res);
    },
    onDelta: (text) => {
      text = String(text || '');
      if (!text) return;
      start();
      emittedText += text;
      chunk({ content: text });
      return streamReady(res);
    },
    finish: (body) => {
      start();
      const thinking = body.choices?.[0]?.message?.reasoning_content || '';
      const thinkingRemainder = streamTextRemainder(emittedThinking, thinking);
      if (thinkingRemainder) chunk({ reasoning_content: thinkingRemainder });
      const finalText = body.choices?.[0]?.message?.content || '';
      const remainder = streamTextRemainder(emittedText, finalText);
      if (remainder) {
        chunk({ content: remainder });
      }
      const finalMessage = body.choices?.[0]?.message || {};
      if (finalMessage.images || finalMessage.artifacts) {
        const delta = {};
        if (finalMessage.images) delta.images = finalMessage.images;
        if (finalMessage.artifacts) delta.artifacts = finalMessage.artifacts;
        chunk(delta);
      }
      const toolCalls = body.choices?.[0]?.message?.tool_calls;
      if (toolCalls?.length) chunk({ tool_calls: toolCalls.map((call, index) => ({ index, ...call })) });
      const finishReason = body.choices?.[0]?.finish_reason || 'stop';
      chunk({}, finishReason, { usageKnown: body.usage_known });
      if (includeUsage) sendChatChunk(res, base, [], { includeUsage: true, usage: body.usage ?? null, usageKnown: body.usage_known });
      writeStream(res, 'data: [DONE]\n\n');
      endStream(res);
    }
  };
}

function emitAnthropicStream(res, body) {
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const start = { ...body, content: [], stop_reason: null, stop_sequence: null };
  sendSse(res, 'message_start', { type: 'message_start', message: start });
  body.content.forEach((block, index) => {
    const empty = block.type === 'text'
      ? { type: 'text', text: '' }
      : block.type === 'thinking'
        ? { type: 'thinking', thinking: '' }
        : { ...block, input: {} };
    sendSse(res, 'content_block_start', { type: 'content_block_start', index, content_block: empty });
    if (block.type === 'text') {
      sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text } });
    } else if (block.type === 'thinking') {
      if (block.thinking) sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: block.thinking } });
      if (block.signature) sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: block.signature } });
    } else {
      sendSse(res, 'content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
    }
    sendSse(res, 'content_block_stop', { type: 'content_block_stop', index });
  });
  sendSse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: body.stop_reason, stop_sequence: null },
    usage: body.usage,
    ...(body.usage_known === false ? { usage_known: false } : {}),
    ...(body.artifacts ? { artifacts: body.artifacts } : {})
  });
  sendSse(res, 'message_stop', { type: 'message_stop' });
  endStream(res);
}

function emitChatStream(res, body, { includeUsage = false } = {}) {
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const choice = body.choices[0];
  const first = { role: 'assistant' };
  if (choice.message.content) first.content = choice.message.content;
  if (choice.message.reasoning_content) first.reasoning_content = choice.message.reasoning_content;
  if (choice.message.tool_calls) first.tool_calls = choice.message.tool_calls.map((call, index) => ({ index, ...call }));
  if (choice.message.images) first.images = choice.message.images;
  if (choice.message.artifacts) first.artifacts = choice.message.artifacts;
  sendChatChunk(res, body, [{ index: 0, delta: first, finish_reason: null }], { includeUsage });
  sendChatChunk(res, body, [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], { includeUsage, usageKnown: body.usage_known });
  if (includeUsage) sendChatChunk(res, body, [], { includeUsage: true, usage: body.usage ?? null, usageKnown: body.usage_known });
  writeStream(res, 'data: [DONE]\n\n');
  endStream(res);
}

function emitResponsesItem(emit, item, outputIndex) {
  emit({ type: 'response.output_item.added', output_index: outputIndex, item: { ...item, status: 'in_progress', content: item.content ? [] : undefined,
    ...(item.type === 'function_call' ? { arguments: '' } : {}),
    ...(item.type === 'custom_tool_call' ? { input: '' } : {}),
    ...(item.type === 'reasoning' ? { summary: [] } : {}) } });
  if (item.type === 'message') {
    const part = item.content[0];
    emit({ type: 'response.content_part.added', item_id: item.id, output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    emit({ type: 'response.output_text.delta', item_id: item.id, output_index: outputIndex, content_index: 0, delta: part.text });
    emit({ type: 'response.output_text.done', item_id: item.id, output_index: outputIndex, content_index: 0, text: part.text });
    emit({ type: 'response.content_part.done', item_id: item.id, output_index: outputIndex, content_index: 0, part });
  } else if (item.type === 'reasoning') {
    (item.summary || []).forEach((part, summaryIndex) => {
      const ids = { item_id: item.id, output_index: outputIndex, summary_index: summaryIndex };
      emit({ type: 'response.reasoning_summary_part.added', ...ids, part: { type: 'summary_text', text: '' } });
      emit({ type: 'response.reasoning_summary_text.delta', ...ids, delta: part.text });
      emit({ type: 'response.reasoning_summary_text.done', ...ids, text: part.text });
      emit({ type: 'response.reasoning_summary_part.done', ...ids, part });
    });
  } else if (item.type === 'function_call') {
    emit({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: outputIndex, delta: item.arguments });
    emit({ type: 'response.function_call_arguments.done', item_id: item.id, output_index: outputIndex, arguments: item.arguments });
  } else if (item.type === 'custom_tool_call') {
    emit({ type: 'response.custom_tool_call_input.delta', item_id: item.id, output_index: outputIndex, delta: item.input });
    emit({ type: 'response.custom_tool_call_input.done', item_id: item.id, output_index: outputIndex, input: item.input });
  }
  emit({ type: 'response.output_item.done', output_index: outputIndex, item });
}

function createResponsesTextEmitter(res, model, responseId) {
  const createdAt = Math.floor(Date.now() / 1000);
  let sequence = 0;
  let started = false;
  let terminated = false;
  const states = new Map();
  const emit = (event) => sendSse(res, null, { ...event, sequence_number: sequence++ });
  const start = () => {
    if (started) return;
    started = true;
    emit({ type: 'response.created', response: {
      id: responseId, object: 'response', created_at: createdAt, model,
      status: 'in_progress', output: [], error: null, incomplete_details: null, usage: null
    } });
  };
  const emitDelta = (kind, value) => {
    if (terminated) return;
    const text = String(value || '');
    if (!text) return;
    start();
    let state = states.get(kind);
    if (!state) {
      state = { id: `${kind === 'reasoning' ? 'rs' : 'msg'}_${crypto.randomUUID().replaceAll('-', '')}`, index: states.size, text: '' };
      states.set(kind, state);
      const item = kind === 'reasoning'
        ? { id: state.id, type: 'reasoning', status: 'in_progress', summary: [] }
        : { id: state.id, type: 'message', role: 'assistant', status: 'in_progress', content: [] };
      emit({ type: 'response.output_item.added', output_index: state.index, item });
      if (kind === 'reasoning') emit({ type: 'response.reasoning_summary_part.added', item_id: state.id,
        output_index: state.index, summary_index: 0, part: { type: 'summary_text', text: '' } });
      else emit({ type: 'response.content_part.added', item_id: state.id, output_index: state.index,
        content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    }
    state.text += text;
    emit({ type: kind === 'reasoning' ? 'response.reasoning_summary_text.delta' : 'response.output_text.delta',
      item_id: state.id, output_index: state.index, ...(kind === 'reasoning' ? { summary_index: 0 } : { content_index: 0 }), delta: text });
  };
  return { onDelta: value => { emitDelta('message', value); return streamReady(res); }, onThinkingDelta: value => { emitDelta('reasoning', value); return streamReady(res); }, fail(error) {
    if (terminated) return;
    terminated = true;
    start();
    const output = [...states].map(([kind, state]) => kind === 'reasoning'
      ? { id: state.id, type: 'reasoning', status: 'incomplete', summary: [{ type: 'summary_text', text: state.text }] }
      : { id: state.id, type: 'message', role: 'assistant', status: 'incomplete',
        content: [{ type: 'output_text', text: state.text, annotations: [] }] });
    emit({ type: 'response.failed', response: {
      id: responseId, object: 'response', created_at: createdAt, model, status: 'failed', output,
      error: clientError(error),
      incomplete_details: null, usage: null
    } });
    endStream(res);
  }, finish(body) {
    if (terminated) return;
    start();
    body.id = responseId;
    body.created_at = createdAt;
    const message = body.output.find((item) => item.type === 'message');
    const reasoning = body.output.find((item) => item.type === 'reasoning');
    emitDelta('reasoning', streamTextRemainder(states.get('reasoning')?.text || '',
      (reasoning?.summary || []).map(part => part.text || '').join('')));
    emitDelta('message', streamTextRemainder(states.get('message')?.text || '', message?.content?.[0]?.text || ''));
    const completed = [];
    for (const [kind, state] of states) {
      const part = kind === 'reasoning' ? { type: 'summary_text', text: state.text }
        : { type: 'output_text', text: state.text, annotations: message?.content?.[0]?.annotations || [] };
      const item = kind === 'reasoning'
        ? { id: state.id, type: 'reasoning', status: body.status === 'incomplete' ? 'incomplete' : 'completed', summary: [part] }
        : { id: state.id, type: 'message', role: 'assistant', status: body.status === 'incomplete' ? 'incomplete' : 'completed', content: [part] };
      const ids = { item_id: state.id, output_index: state.index,
        ...(kind === 'reasoning' ? { summary_index: 0 } : { content_index: 0 }) };
      emit({ type: kind === 'reasoning' ? 'response.reasoning_summary_text.done' : 'response.output_text.done', ...ids, text: state.text });
      emit({ type: kind === 'reasoning' ? 'response.reasoning_summary_part.done' : 'response.content_part.done', ...ids, part });
      emit({ type: 'response.output_item.done', output_index: state.index, item });
      completed.push(item);
    }
    const remaining = body.output.filter(item => !(item === message && states.has('message'))
      && !(item === reasoning && states.has('reasoning')));
    body.output = [...completed, ...remaining];
    remaining.forEach((item, index) => emitResponsesItem(emit, item, completed.length + index));
    terminated = true;
    emit({ type: body.status === 'incomplete' ? 'response.incomplete' : 'response.completed', response: body });
    writeStream(res, 'data: [DONE]\n\n');
    endStream(res);
  } };
}

function emitResponsesStream(res, body) {
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  let sequence = 0;
  sendSse(res, null, { type: 'response.created', sequence_number: sequence++, response: { ...body, status: 'in_progress', output: [] } });
  body.output.forEach((item, index) => emitResponsesItem((event) => sendSse(res, null, { ...event, sequence_number: sequence++ }), item, index));
  sendSse(res, null, { type: body.status === 'incomplete' ? 'response.incomplete' : 'response.completed', sequence_number: sequence++, response: body });
  writeStream(res, 'data: [DONE]\n\n');
  endStream(res);
}

module.exports = {
  beginSse,
  createAnthropicTextEmitter,
  createChatTextEmitter,
  createResponsesTextEmitter,
  emitAnthropicStream,
  emitChatStream,
  emitResponsesItem,
  emitResponsesStream,
  sendChatChunk,
  sendSse,
  textStreamingAllowed
};
