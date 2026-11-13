'use strict';

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { GatewayError, validateSchema } = require('./protocol');
const { classifyTool } = require('./agy-tool-semantics');

const SUMMARY = 'Brief 2-5 word noun phrase describing this tool call.';
const IDENTITY = 'You are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(message) { throw new GatewayError(message, { code: 'invalid_tool_arguments', status: 502 }); }
function json(value) {
  const text = JSON.stringify(value);
  if (typeof text !== 'string' || Buffer.byteLength(text) > 4 * 1024 * 1024 || !isDeepStrictEqual(JSON.parse(text), value)) fail('工具参数不能无损表示为 JSON。');
  return text;
}
function parse(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4 * 1024 * 1024) fail('工具参数 JSON 无效或过长。');
  try { return JSON.parse(value); } catch { return fail('工具参数不是有效 JSON。'); }
}

// Native file views expose only operations that the source executor can do.
// All other arguments retain a complete MCP JSON view. In particular we never
// turn replace_all=false into native edit_file's replace-every-occurrence rule,
// or timeout/background into IsDaemon/WaitMsBeforeAsync.
function nativeView(tool, classified) {
  if (!classified || !classified.nameKnown || !['read', 'write', 'edit'].includes(classified.familyName)) return null;
  const { familyName: family, roles } = classified;
  const field = role => roles.get(role)?.name;
  const fields = Object.fromEntries([...roles].map(([role, item]) => [role, item.name]));
  const s = { type: 'string' }, properties = { Path: { type: 'string', minLength: 1 } };
  let required, description;
  if (family === 'read') {
    if (field('offset')) properties.StartLine = { type: 'integer', minimum: 1 };
    if (field('limit')) properties.EndLine = { type: 'integer', minimum: 1 };
    required = ['Path'];
    description = 'Read a file with the client executor. Path is absolute; StartLine and EndLine are inclusive, 1-indexed. Client output limits, formats and permission rules remain applicable. Byte-offset continuation is not supported by this view.';
  } else if (family === 'write') {
    Object.assign(properties, { Content: s, Overwrite: { type: 'boolean', enum: [true] } });
    required = ['Path', 'Content', 'Overwrite'];
    description = 'Create or completely replace a file through the client executor. Overwrite must be true. Append and artifact metadata are not supported. Client read-before-write and permission rules remain applicable.';
  } else {
    if (!field('replaceAll')) return null;
    Object.assign(properties, { Target: { type: 'string', minLength: 1 }, Replacement: s });
    required = ['Path', 'Target', 'Replacement'];
    description = 'Replace every exact occurrence of Target with Replacement through the client executor. Client permission and read-before-edit rules remain applicable. Use the MCP view for unique-only replacement.';
  }
  const schema = { type: 'object', properties, required, additionalProperties: false };
  function toClient(args) {
    if (!validateSchema(args, schema) || typeof args.Path !== 'string' || !args.Path.startsWith('/')) fail('原生文件视图参数无效。');
    const input = { [fields.path]: args.Path };
    if (family === 'read') {
      if (args.StartLine !== undefined) input[fields.offset] = args.StartLine;
      if (args.EndLine !== undefined) {
        const limit = args.EndLine - (args.StartLine ?? 1) + 1;
        if (!Number.isSafeInteger(limit) || limit < 1) fail('文件行范围无效。');
        input[fields.limit] = limit;
      }
    } else if (family === 'write') input[fields.content] = args.Content;
    else Object.assign(input, { [fields.old]: args.Target, [fields.new]: args.Replacement, [fields.replaceAll]: true });
    if (!validateSchema(input, tool.schema)) fail('文件视图不符合客户端契约。');
    return input;
  }
  function toProvider(args) {
    const input = { Path: args[fields.path] };
    if (family === 'read') {
      if (args[fields.offset] !== undefined) input.StartLine = args[fields.offset];
      if (args[fields.limit] !== undefined) input.EndLine = (args[fields.offset] ?? 1) + args[fields.limit] - 1;
    } else if (family === 'write') Object.assign(input, { Content: args[fields.content], Overwrite: true });
    else {
      if (args[fields.replaceAll] !== true) return null;
      Object.assign(input, { Target: args[fields.old], Replacement: args[fields.new] });
    }
    try { return isDeepStrictEqual(toClient(input), args) ? input : null; } catch { return null; }
  }
  return { name: `${family}_file`, description, schema, toClient, toProvider };
}

function prepare157ToolContract(normalized, legacy) {
  if (!normalized.tools?.length || normalized.autoMode) return legacy;
  const sources = normalized.tools, taken = new Set(sources.map(tool => tool.name));
  const candidates = sources.map(tool => !tool.internal && nativeView(tool, classifyTool(tool)));
  const counts = new Map();
  for (const view of candidates) if (view) counts.set(view.name, (counts.get(view.name) || 0) + 1);
  const provider = new Map(), client = new Map(), tools = [], guides = [];
  for (const [index, tool] of sources.entries()) {
    if (tool.internal) { tools.push(tool); continue; }
    const alias = `mcp_gateway_${crypto.createHash('sha256').update(tool.name).digest('hex').slice(0, 16)}`;
    if (taken.has(alias) || provider.has(alias)) fail('工具别名发生冲突。');
    const record = { tool, alias, native: candidates[index] };
    if (record.native && (counts.get(record.native.name) !== 1 || (taken.has(record.native.name) && record.native.name !== tool.name))) record.native = null;
    client.set(tool.name, record); provider.set(alias, record);
    tools.push({ name: alias, kind: 'function', description: `Client tool ${JSON.stringify(tool.name)}. Its executor, approvals and behavior remain unchanged.\n${tool.description || ''}`, schema: {
      type: 'object', properties: { argumentsJson: { type: 'string', description: 'Complete original client arguments as one JSON value; preserve every field. Original schema: ' + JSON.stringify(tool.schema || {}) }, toolSummary: { type: 'string', description: SUMMARY } },
      required: ['argumentsJson', 'toolSummary'], additionalProperties: false
    } });
    if (record.native) { provider.set(record.native.name, record); tools.push({ ...record.native, kind: 'function' }); }
    guides.push(`${JSON.stringify(tool.name)} -> ${alias}${record.native ? `; reversible file view: ${record.native.name}` : ''}`);
  }
  function toClient(call) {
    const record = provider.get(call.name);
    if (!record) {
      if (sources.some(tool => tool.internal && tool.name === call.name)) return call;
      return fail('上游返回了未声明的工具。');
    }
    let args = typeof call.arguments === 'string' ? parse(call.arguments) : call.arguments;
    if (call.name === record.alias) {
      if (!object(args) || Object.keys(args).some(key => !['argumentsJson', 'toolSummary'].includes(key)) || typeof args.toolSummary !== 'string') fail('MCP 工具封装参数无效。');
      args = parse(args.argumentsJson);
    } else args = record.native.toClient(args);
    json(args);
    if (!validateSchema(args, record.tool.schema)) fail('工具参数不符合原始客户端契约。');
    return { ...call, name: record.tool.name, arguments: args, ...(record.tool.kind ? { kind: record.tool.kind } : {}),
      ...(record.tool.kind === 'custom' ? { input: args.input } : {}) };
  }
  function toProvider(call) {
    const record = client.get(call.name);
    if (!record) return call;
    let args = call.arguments;
    if (typeof args === 'string' && !validateSchema(args, record.tool.schema)) args = parse(args);
    if (!validateSchema(args, record.tool.schema)) fail('历史工具参数不符合客户端契约。');
    const projected = record.native?.toProvider(args);
    return { ...call, name: projected ? record.native.name : record.alias,
      arguments: projected || { argumentsJson: json(args), toolSummary: 'Client tool request' }, kind: 'function' };
  }
  function projectContents(contents) {
    const calls = new Map();
    return contents.map(content => ({ ...content, parts: content.parts.map(part => {
      if (part.functionCall) {
        const call = part.functionCall, record = client.get(call.name);
        if (!record) { if (call.id) calls.set(call.id, call.name); return part; }
        const mapped = toProvider({ name: call.name, arguments: call.args });
        if (call.id) calls.set(call.id, mapped.name);
        return { ...part, functionCall: { ...call, name: mapped.name, args: mapped.arguments } };
      }
      if (part.functionResponse) {
        const result = part.functionResponse;
        const name = calls.get(result.id) || client.get(result.name)?.alias;
        return name ? { ...part, functionResponse: { ...result, name } } : part;
      }
      return part;
    }) }));
  }
  let toolChoice = normalized.toolChoice;
  const name = toolChoice?.name || toolChoice?.function?.name, selected = client.get(name);
  if (selected) toolChoice = { ...toolChoice, ...(toolChoice.name ? { name: selected.alias } : {}), ...(toolChoice.function ? { function: { ...toolChoice.function, name: selected.alias } } : {}) };
  // Do not transplant official workspace/artifact/runtime claims into a foreign
  // executor. Preserve the complete source system and append an explicit index.
  const system = [IDENTITY, normalized.system, 'Client tool reference index. Only use declared functions. Client instructions and approval restrictions remain in force. Use the complete MCP view whenever the native view cannot express all arguments:\n' + guides.join('\n')].filter(Boolean).join('\n\n');
  return { ...legacy, normalized: { ...normalized, system, tools, toolChoice }, toClient, toProvider, projectContents,
    adapted: client.size > 0, mappingCount: client.size, toolCount: client.size };
}
module.exports = { prepare157ToolContract };
