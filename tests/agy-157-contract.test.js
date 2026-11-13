'use strict';
delete process.env.ANTIGRAVITY_TOOL_CONTRACT;
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { normalizeAnthropic, normalizeChat, normalizeResponses } = require('../src/protocol');
const { prepareToolAdapter } = require('../src/agy-tool-adapter');
const { prepare157ToolContract } = require('../src/agy-157-tool-contract');
const { DirectAntigravityProvider, buildDirectRequest } = require('../src/direct-provider');
const { AgySessionStore } = require('../src/agy-session-state');
const { generationProfile } = require('../src/agy-request-profile');
const wire = require('./fixtures/agy-1.5.7-model-wire.json');
const catalog = require('../src/data/agy-1.5.7-models.json');
const fixtures = [
  ['Claude', 'anthropic', 'Read', { file_path: '/tmp/原文', offset: 2, limit: 3 }],
  ['DSH', 'chat', 'bash', { command: 'printf "%s" "$HOME"', timeoutMs: 123, workdir: '/tmp', run_in_background: false, sandbox_permissions: 'workspace-write', justification: 'keep this' }],
  ['Hermes', 'chat', 'terminal', { command: 'pwd', timeout: 17, background: true, workdir: '/tmp' }],
  ['OpenCodex', 'responses', 'exec_command', { cmd: 'printf "你好"', workdir: '/tmp', yield_time_ms: 900, sandbox_permissions: 'require_escalated', justification: 'ask before running' }],
  ['Unknown', 'chat', 'business', { nullable: null, values: [0, false, '原样'], nested: { code: '$()`' } }]
];
function normalized(protocol, name, args) {
  const properties = Object.fromEntries(Object.entries(args).map(([key, value]) => [key, { type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value }]));
  const tool = { name, description: 'Keep all client approval and execution rules.', schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } };
  return { protocol, system: 'SOUL.md: literal Read. AGENTS.md: ask before execution. <quote>You are Hermes.</quote>', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Do the requested work.' }] }], tools: [tool] };
}
for (const [client, protocol, name, args] of fixtures) test(`${client}: complete tool arguments, choices, system and IDs round trip`, () => {
  const n = normalized(protocol, name, args), before = structuredClone(n);
  n.toolChoice = { type: 'function', function: { name } };
  const a = prepare157ToolContract(n, prepareToolAdapter(n));
  const outgoing = a.toProvider({ id: 'call-1', name, arguments: args, thoughtSignature: 'real-signature' });
  const incoming = a.toClient(outgoing);
  assert.equal(incoming.name, name); assert.deepEqual(incoming.arguments, args);
  assert.equal(incoming.id, 'call-1'); assert.equal(incoming.thoughtSignature, 'real-signature');
  assert.match(a.normalized.toolChoice.function.name, /^mcp_gateway_/);
  assert.ok(a.normalized.tools.some(tool => tool.name === a.normalized.toolChoice.function.name));
  assert.ok(a.normalized.system.includes(before.system));
  assert.deepEqual(n.messages, before.messages); assert.deepEqual(n.tools, before.tools);
  assert.throws(() => a.toClient({ ...outgoing, name: 'undeclared_executor' }), /未声明/);
});

test('native file views preserve replacement semantics and retain complete MCP fallback', () => {
  const n = normalized('chat', 'edit', { path: '/tmp/a', old_string: 'old', new_string: '', replace_all: false });
  n.tools[0].description = 'Replace exact literal strings in an existing file.';
  const a = prepare157ToolContract(n, prepareToolAdapter(n));
  const unique = a.toProvider({ name: 'edit', arguments: { path: '/tmp/a', old_string: 'old', new_string: '', replace_all: false } });
  assert.match(unique.name, /^mcp_gateway_/);
  const all = a.toProvider({ name: 'edit', arguments: { path: '/tmp/a', old_string: 'old', new_string: '', replace_all: true } });
  assert.equal(all.name, 'edit_file'); assert.deepEqual(all.arguments, { Path: '/tmp/a', Target: 'old', Replacement: '' });
  assert.equal(a.toClient(all).arguments.replace_all, true);
});

test('every captured model sends its actual 1.5.7 reasoning fields and output cap', () => {
  for (const [model, row] of Object.entries(wire.models)) {
    assert.equal(row.sentModel, model);
    const request = buildDirectRequest({ messages: [{ role: 'user', text: 'fixture' }] }, model, 'p', '', '', null, { modelInfo: catalog[model] });
    assert.deepEqual(request.request.generationConfig, row.generationConfig, model);
    assert.equal(request.request.labels.model_enum, row.modelEnum, model);
    for (const [key,value] of Object.entries(row.historyLabels)) assert.equal(request.request.labels[key],value,model+':'+key);
    assert.equal(request.request.toolConfig, undefined);
  }
  assert.equal(generationProfile({}, 'gemini-4-hydrogen-xhigh', catalog['gemini-4-hydrogen-xhigh']).thinkingConfig.thinkingLevel, 100);
  assert.deepEqual(generationProfile({ generationConfig: { maxOutputTokens: 512, thinkingBudget: 1, cachedContents: 'do-not-forward' } }, 'unobserved-name', {}).thinkingConfig, undefined);
});

test('three public protocols complete an issued MCP tool, restart, restore signature and correlate its receipt', async t => {
  for (const protocol of ['anthropic', 'chat', 'responses']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-157-contract-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const schema = { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' } }, required: ['command'], additionalProperties: false };
    const args = { command: 'printf "$HOME"', timeout: 1500 }, seen = [];
    const common = { model: 'gemini-3.8-flash-low', system: 'Keep permissions.', messages: [{ role: 'user', content: 'Run the requested command.' }] };
    let payload = protocol === 'anthropic' ? { ...common, tools: [{ name: 'Bash', description: 'Command with client time limit.', input_schema: schema }] }
      : protocol === 'chat' ? { ...common, tools: [{ type: 'function', function: { name: 'Bash', description: 'Command with client time limit.', parameters: schema } }] }
      : { model: common.model, instructions: common.system, input: common.messages, tools: [{ type: 'function', name: 'Bash', description: 'Command with client time limit.', parameters: schema }] };
    const normalize = protocol === 'anthropic' ? normalizeAnthropic : protocol === 'chat' ? normalizeChat : normalizeResponses;
    const send = () => new DirectAntigravityProvider({ sessionStore: new AgySessionStore({ directory: root }), accessToken: 'fixture', projectId: 'p', localAuth: null, maxRetries: 0,
      fetchImpl: async (_url, options) => {
        const request = JSON.parse(options.body); seen.push(request);
        const declaration = request.request.tools.flatMap(tool => tool.functionDeclarations).find(tool => tool.name.startsWith('mcp_gateway_'));
        const parts = seen.length === 1 ? [{ functionCall: { id: 'issued-1', name: declaration.name, args: { argumentsJson: JSON.stringify(args), toolSummary: 'Fixture execution' } }, thoughtSignature: 'signed-issued-call' }] : [{ text: 'DONE' }];
        return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));
      }
    }).send(normalize(payload), common.model, { sessionId: protocol + '-fixture' });
    const first = await send(); assert.equal(first.toolCalls[0].name, 'Bash'); assert.deepEqual(first.toolCalls[0].arguments, args);
    if (protocol === 'anthropic') payload.messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'issued-1', name: 'Bash', input: args }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'issued-1', content: 'ACTUAL_RECEIPT' }] });
    else if (protocol === 'chat') payload.messages.push({ role: 'assistant', tool_calls: [{ id: 'issued-1', type: 'function', function: { name: 'Bash', arguments: JSON.stringify(args) } }] }, { role: 'tool', tool_call_id: 'issued-1', content: 'ACTUAL_RECEIPT' });
    else payload.input.push({ type: 'function_call', call_id: 'issued-1', name: 'Bash', arguments: JSON.stringify(args) }, { type: 'function_call_output', call_id: 'issued-1', output: 'ACTUAL_RECEIPT' });
    assert.equal((await send()).text, 'DONE');
    const parts = seen[1].request.contents.flatMap(content => content.parts);
    const call = parts.find(part => part.functionCall), result = parts.find(part => part.functionResponse);
    assert.equal(call.thoughtSignature, 'signed-issued-call', protocol);
    assert.equal(call.functionCall.id, result.functionResponse.id);
    assert.equal(call.functionCall.name, result.functionResponse.name);
    assert.match(JSON.stringify(result), /ACTUAL_RECEIPT/);
    assert.doesNotMatch(JSON.stringify(seen[1]), /skip_thought_signature_validator/);
  }
});


test('explicit client cache markers never create cache resources or enter generation parameters', async () => {
 const normalized = normalizeAnthropic({ model: 'gemini-3.8-flash-low', system: [{ type: 'text', text: 'Stable source instructions', cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: 'Reply CACHE_OK' }] });
 normalized.generationConfig = { cachedContents: 'injected-cache-resource', cache_control: { type: 'ephemeral' } };
 const urls = [];
 const provider = new DirectAntigravityProvider({ localAuth: null, accessToken: 'synthetic', projectId: 'p', maxRetries: 0, sessionStore: new AgySessionStore({ directory: '' }), fetchImpl: async (url, options) => {
  urls.push(url); const body=JSON.parse(options.body);
  assert.doesNotMatch(JSON.stringify(body), /cachedContents|cache_control|injected-cache-resource/);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'CACHE_OK' }] } }], usageMetadata: { promptTokenCount: 5000, cachedContentTokenCount: 4500, candidatesTokenCount: 2, totalTokenCount: 5002 } }));
 } });
 const result=await provider.send(normalized, 'gemini-3.8-flash-low');
 assert.equal(urls.length, 1); assert.match(urls[0], /streamGenerateContent/);
 assert.equal(result.usage.cache_read_tokens, 4500); assert.equal(result.usage.input_tokens, 5000);
});


test('web OAuth uses a verifier bound to its S256 challenge and current native headers', async () => {
 const { OAuthFlow } = require('../src/oauth-flow');
 const crypto=require('node:crypto'); let challenge, exchanges=0;
 const flow=new OAuthFlow({ clientCredentials:[{clientId:'fixture-client',clientSecret:'fixture-secret'}], openBrowserImpl:async()=>false, timeoutMs:3000, fetchImpl:async(url,options)=>{
  if(String(url).endsWith('/token')) { exchanges++; const f=new URLSearchParams(options.body); assert.equal(crypto.createHash('sha256').update(f.get('code_verifier')).digest('base64url'),challenge); assert.equal(options.headers['user-agent'],'Go-http-client/2.0'); return new Response(JSON.stringify({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600})); }
  if(String(url).includes('/userinfo'))return new Response(JSON.stringify({email:'fixture@example.invalid'}));
  assert.match(options.headers['user-agent'], /antigravity\/cli\/1\.5\.7/);
  return new Response(JSON.stringify({cloudaicompanionProject:'fixture-project'}));
 } });
 const account=await flow.start({onReady:({url})=>{const u=new URL(url); assert.equal(u.searchParams.get('code_challenge_method'),'S256'); challenge=u.searchParams.get('code_challenge'); const redirect=u.searchParams.get('redirect_uri'); setImmediate(()=>flow.submit(redirect+'?code=synthetic-code&state='+u.searchParams.get('state')));}});
 assert.equal(exchanges,1);assert.equal(account.projectId,'fixture-project');
});

test('captured Claude, Hermes and DSH declarations retain their complete schemas in MCP views', () => {
 const captures=require('./fixtures/agy-157-client-declarations.json');
 for(const capture of Object.values(captures)) {
  const body={model:'gemini-3.8-flash-low',tools:capture.tools,messages:[{role:'user',content:'Fixture'}],input:[{role:'user',content:'Fixture'}]};
  const n=capture.path.includes('/messages')?normalizeAnthropic(body):capture.path.includes('/chat/completions')?normalizeChat(body):normalizeResponses(body);
  const a=prepare157ToolContract(n,prepareToolAdapter(n));
  assert.equal(a.toolCount,n.tools.length);
  for(const tool of n.tools) {
   const declaration=a.normalized.tools.find(item=>item.description?.startsWith('Client tool '+JSON.stringify(tool.name)+'.'));
   assert.ok(declaration,tool.name);
   assert.ok(declaration.schema.properties.argumentsJson.description.endsWith(JSON.stringify(tool.schema||{})));
  }
 }
});

test('Responses custom tools return their original freeform kind and literal patch text', () => {
 const {responsesResponse}=require('../src/protocol');
 const patch='*** Begin Patch\n*** Add File: a.txt\n+literal $()` text\n*** End Patch';
 const n=normalizeResponses({model:'gemini-3.8-flash-low',input:'Fixture',tools:[{type:'custom',name:'apply_patch',description:'Apply the supplied literal patch.',format:{type:'text'}}]});
 const a=prepare157ToolContract(n,prepareToolAdapter(n));
 const client=a.toClient(a.toProvider({id:'custom-1',name:'apply_patch',arguments:{input:patch},kind:'custom'}));
 assert.equal(client.kind,'custom');assert.deepEqual(client.arguments,{input:patch});
 const r=responsesResponse('gemini-3.8-flash-low',{text:'',toolCalls:[client],usage:{}});
 const call=r.output.find(item=>item.type==='custom_tool_call');assert.ok(call);assert.equal(call.input,patch);
});


test('native file wire schemas avoid boolean enums and enforce destructive-operation guards locally', () => {
 const write=normalized('chat','write_file',{path:'/tmp/a',content:'new text'});
 write.tools[0].description='Create or completely overwrite a file.';
 const w=prepare157ToolContract(write,prepareToolAdapter(write));
 const declaration=w.normalized.tools.find(t=>t.name==='write_file');assert.equal(declaration.schema.properties.Overwrite.enum,undefined);
 assert.throws(()=>w.toClient({name:'write_file',arguments:{Path:'/tmp/a',Content:'new',Overwrite:false}}),/Overwrite/);
 const read=normalized('chat','read_file',{path:'/tmp/a',offset:1,limit:2});read.tools[0].schema.properties.offset.description='1-indexed line number';read.tools[0].schema.properties.limit.description='Number of lines';const r=prepare157ToolContract(read,prepareToolAdapter(read));
 for(const StartLine of [0,-1,1.5])assert.throws(()=>r.toClient({name:'read_file',arguments:{Path:'/tmp/a',StartLine,EndLine:2}}));
 const edit=normalized('chat','edit',{path:'/tmp/a',old_string:'old',new_string:'new',replace_all:true});edit.tools[0].description='Replace exact literal strings in an existing file.';const e=prepare157ToolContract(edit,prepareToolAdapter(edit));
 assert.throws(()=>e.toClient({name:'edit_file',arguments:{Path:'/tmp/a',Target:'',Replacement:'new'}}));
});


test('ambiguous append, byte-offset and regex clients retain only their complete MCP contract', () => {
 for (const [name,args,description] of [
  ['write_file',{path:'/tmp/a',content:'x'},'Append text to an existing file.'],
  ['edit',{path:'/tmp/a',old_string:'x',new_string:'y',replace_all:true},'Replace a regular expression across the file.'],
  ['read_file',{path:'/tmp/a',offset:0,limit:10},'Read bytes from a file.']
 ]) {const n=normalized('chat',name,args);n.tools[0].description=description;if(name==='read_file'){n.tools[0].schema.properties.offset.description='Byte offset';n.tools[0].schema.properties.limit.description='Byte count';}const a=prepare157ToolContract(n,prepareToolAdapter(n));assert.ok(a.normalized.tools.every(t=>t.name.startsWith('mcp_gateway_')));assert.deepEqual(a.toClient(a.toProvider({name,arguments:args})).arguments,args);}
});
