'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { envelopeClientInstructions, PRECEDENCE, OPEN, CLOSE } = require('../src/client-instruction-envelope');
const profile={client:'claude',evidence:['claude-desktop-330-system-template']};
const make=()=>({systemInstruction:{role:'user',parts:[{text:'Gateway tool contract.\n\nClient policy: require permission before file writes.\n\nTool index.'}]},contents:[{role:'user',parts:[{text:'Synthetic user request.'}]},{role:'model',parts:[{functionCall:{name:'read_fixture',id:'call_1',args:{path:'fixture.txt'}},thoughtSignature:'synthetic-signature'}]},{role:'user',parts:[{functionResponse:{name:'read_fixture',id:'call_1',response:{result:'fixture data'}}}]}],tools:[{functionDeclarations:[{name:'read_fixture'}]}],generationConfig:{maxOutputTokens:64000,thinkingConfig:{thinkingLevel:'HIGH'}}});
const policy='Client policy: require permission before file writes.';
test('verified Claude instructions retain precedence, tool contract, signature and tool order',()=>{
 const r=make(),before=structuredClone(r);assert.equal(envelopeClientInstructions(r,policy,profile,'gemini-4-hydrogen-sonar'),true);
 assert.equal(r.contents[0].parts[0].text,`${OPEN}\n${policy}\n${CLOSE}`);
 assert.ok(r.systemInstruction.parts[0].text.includes(PRECEDENCE));assert.ok(r.systemInstruction.parts[0].text.includes('Gateway tool contract.'));assert.ok(!r.systemInstruction.parts[0].text.includes(policy));
 assert.deepEqual(r.contents.slice(1),before.contents);assert.deepEqual(r.tools,before.tools);assert.deepEqual(r.generationConfig,before.generationConfig);
});
test('unknown clients, other model families, duplicate policies and delimiter collisions stay unchanged',()=>{
 for(const [p,m,s] of [[{client:'claude',evidence:[]},'gemini-4-hydrogen-sonar',policy],[profile,'claude-opus-5',policy],[profile,'gemini-4-hydrogen-sonar',OPEN],[profile,'gemini-4-hydrogen-sonar',policy+policy]]){
  const r=make(),before=structuredClone(r);assert.equal(envelopeClientInstructions(r,s,p,m),false);assert.deepEqual(r,before);
 }
});
test('real request builder preserves signed Claude tool continuation under the instruction envelope',()=>{
 const {normalizeChat}=require('../src/protocol'),{buildDirectRequest}=require('../src/direct-provider');
 const fixture=require('./fixtures/claude-desktop-2.1.330-framework.json');
 const n=normalizeChat({model:'gemini-4-hydrogen-sonar',messages:[{role:'system',content:fixture.compactSystem},{role:'user',content:'Read only fictional data.'},{role:'assistant',content:null,tool_calls:[{id:'call_1',type:'function',function:{name:'read_fixture',arguments:'{"path":"fixture.txt"}'},extra_content:{google:{thought_signature:'synthetic-signature'}}}]},{role:'tool',tool_call_id:'call_1',content:'fixture data'}],tools:[{type:'function',function:{name:'read_fixture',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}]});
 const before=structuredClone(n),native={};const wire=buildDirectRequest(n,'gemini-4-hydrogen-sonar','fixture-project','fixture-session','',null,native);
 assert.equal(native.clientInstructionEnvelope,true);assert.deepEqual(n,before);
 const parts=wire.request.contents.flatMap(c=>c.parts);const call=parts.find(p=>p.functionCall),reply=parts.find(p=>p.functionResponse);
 assert.ok(call && reply);assert.equal(call.thoughtSignature,'synthetic-signature');assert.equal(call.functionCall.id,reply.functionResponse.id);
 assert.ok(parts.findIndex(p=>p.functionCall)<parts.findIndex(p=>p.functionResponse));
});
