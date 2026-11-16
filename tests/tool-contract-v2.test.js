'use strict';
require('./helpers/gateway-environment');
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {normalizeResponses,responsesResponse,finalizeModelResult}=require('../src/protocol');
const {prepareAntigravityTools}=require('../src/antigravity-tool-contract');
const simple={type:'object',properties:{query:{type:'string'},limit:{type:'integer',minimum:1}},required:['query'],additionalProperties:false};
function contract(schema=simple,extra={}){const n=normalizeResponses({input:'synthetic',tools:[{type:'function',name:'lookup',parameters:schema}],...extra});return {n,a:prepareAntigravityTools(n)};}
test('unknown-client simple tool uses direct fields with a lossless original call',()=>{
 const {a}=contract(),t=a.normalized.tools[0];assert.ok(t.schema.properties.query);assert.equal(t.schema.properties.argumentsJson,undefined);
 const original={id:'c1',name:'lookup',arguments:{query:'hello',limit:2},thoughtSignature:'opaque'};const out=a.toProvider(original),back=a.toClient(out);
 assert.equal(back.name,'lookup');assert.deepEqual(back.arguments,original.arguments);assert.equal(back.thoughtSignature,'opaque');assert.equal(back.id,'c1');
});
test('complex schemas and business toolSummary retain complete JSON values',()=>{
 const schema={oneOf:[{type:'object',properties:{toolSummary:{type:'string'},nested:{type:'array',items:{type:'integer'}}},required:['toolSummary','nested'],additionalProperties:false},{type:'string'}]};
 const {a}=contract(schema);
 for(const value of [{toolSummary:'business',nested:[1,0]},'{"literal":"string"}']){
  const original={id:'x',name:'lookup',arguments:value};assert.deepEqual(a.toClient(a.toProvider(original)).arguments,value);
 }
 assert.throws(()=>a.toProvider({name:'lookup',arguments:{toolSummary:'business',nested:['wrong']}}),/契约/);
});
test('namespaced tools with identical names and a named choice remain distinct',()=>{
 const n=normalizeResponses({input:'synthetic',tools:['files','network'].map(name=>({type:'namespace',name,tools:[{type:'function',name:'read',parameters:simple}]})),tool_choice:{type:'function',name:'read',namespace:'files'}});
 const a=prepareAntigravityTools(n);assert.equal(new Set(a.normalized.tools.map(t=>t.name)).size,2);
 for(const tool of n.tools){const call=a.toClient(a.toProvider({id:'c',name:tool.name,arguments:{query:'x'}}));const output=responsesResponse('fixture',finalizeModelResult({...n,toolChoice:null},{text:'',toolCalls:[call],usage:{}}),'r').output[0];assert.equal(output.name,'read');assert.ok(['files','network'].includes(output.namespace));}
 assert.ok(a.toProviderNames(n.tools[0].name).includes(a.normalized.toolChoice.name));
});
test('tool receipts reject a foreign id or tool and preserve the issued view',()=>{
 const {a}=contract(),issued=a.toProvider({id:'correct',name:'lookup',arguments:{query:'x'}});
 assert.equal(a.toProviderResult({id:'correct',name:'lookup',content:'ok'},issued).name,issued.name);
 for(const receipt of [{id:'wrong',name:'lookup'},{id:'correct',name:'foreign'}])assert.throws(()=>a.toProviderResult(receipt,issued),e=>e.code==='tool_result_mismatch');
});
test('custom text tools and parallel_tool_calls false preserve client execution constraints',()=>{
 const n=normalizeResponses({input:'synthetic',parallel_tool_calls:false,tools:[{type:'custom',name:'apply_note',format:{type:'text'}}]});const a=prepareAntigravityTools(n);
 const call=a.toClient(a.toProvider({id:'c',name:'apply_note',kind:'custom',input:'literal\ntext'}));assert.equal(call.input,'literal\ntext');assert.equal(call.kind,'custom');
 assert.throws(()=>finalizeModelResult({...n,toolChoice:null},{text:'',toolCalls:[call,{...call,id:'other'}],usage:{}}),/parallel|并行|一个|one/i);
});
test('only actually issued .24 cache aliases gain a compatibility view',()=>{
 const {n}=contract(),alias='mcp_gateway_'+crypto.createHash('sha256').update('lookup').digest('hex').slice(0,16);
 const state={responses:{fixture:{content:{role:'model',parts:[{functionCall:{id:'old',name:alias,args:{argumentsJson:'{"query":"past"}',toolSummary:'Old'}},thoughtSignature:'original-signature'}]}}}};
 const a=prepareAntigravityTools(n,{state});assert.ok(a.normalized.tools.some(t=>t.name===alias));
 const restored=a.toClient({id:'old',name:alias,arguments:{argumentsJson:'{"query":"past"}',toolSummary:'Old'},thoughtSignature:'original-signature'});
 assert.equal(restored.name,'lookup');assert.deepEqual(restored.arguments,{query:'past'});assert.equal(restored.thoughtSignature,'original-signature');
 assert.equal(prepareAntigravityTools(n).normalized.tools.some(t=>t.name===alias),false);
});
