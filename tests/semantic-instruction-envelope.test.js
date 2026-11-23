'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {envelopeClientInstructions,PRECEDENCE}=require('../src/client-instruction-envelope');
for(const protocol of ['responses','anthropic','chat'])test(`semantic ${protocol} preserves policy, signatures, tools and budgets without client identity`,t=>{
 const old=process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE='1';t.after(()=>{if(old===undefined)delete process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;else process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=old;});
 const policy='Safety: ask before writing. Developer: read synthetic fixtures only.';
 const r={systemInstruction:{parts:[{text:policy+'\n\nTool contract.'}]},contents:[{role:'model',parts:[{functionCall:{id:'c1',name:'read',args:{}},thoughtSignature:'synthetic-signature'}]},{role:'user',parts:[{functionResponse:{id:'c1',name:'read',response:{result:'fixture'}}}]}],tools:[{functionDeclarations:[{name:'read'}]}],generationConfig:{maxOutputTokens:262144,thinkingConfig:{thinkingLevel:'HIGH'}}};
 const before=structuredClone(r);
 assert.equal(envelopeClientInstructions(r,policy,null,'gemini-4-neon-high',{protocol,system:policy}),true);
 assert.ok(r.contents[0].parts[0].text.includes(policy));assert.deepEqual(r.contents.slice(1),before.contents);
 assert.ok(r.systemInstruction.parts[0].text.includes(PRECEDENCE));assert.deepEqual(r.tools,before.tools);assert.deepEqual(r.generationConfig,before.generationConfig);
});
test('unknown protocol cannot claim normalized instruction capability',t=>{
 const old=process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE='1';t.after(()=>{if(old===undefined)delete process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;else process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=old;});
 const r={systemInstruction:{parts:[{text:'policy'}]},contents:[]},before=structuredClone(r);
 assert.equal(envelopeClientInstructions(r,'policy',null,'gemini-4-neon-high',{protocol:'unknown',system:'policy'}),false);assert.deepEqual(r,before);
});

test('Neon Responses builder envelopes arbitrary developer instructions without UA, version or template match',()=>{
 const old=process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;
 process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE='1';
 try {
  const {normalizeResponses}=require('../src/protocol');
  const {buildDirectRequest}=require('../src/direct-provider');
  const source=normalizeResponses({model:'gemini-4-neon-high',instructions:'System: ask before writes.',input:[{role:'developer',content:'Developer: keep original safety policy.'},{role:'user',content:'Synthetic fixture only.'}]});
  const before=structuredClone(source),native={};
  const wire=buildDirectRequest(source,'gemini-4-neon-high','fixture','fixture-session','',null,native);
  assert.equal(native.clientInstructionEnvelope,true);
  assert.deepEqual(source,before);
  assert.ok(wire.request.contents[0].parts[0].text.includes(source.system));
  assert.ok(wire.request.systemInstruction.parts[0].text.includes(PRECEDENCE));
 }finally{if(old===undefined)delete process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;else process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=old;}
});
test.after(async()=>{await require('../src/schema-contract').closeSchemaWorkers();});

test('semantic rollout leaves other Gemini families and disabled rollout unchanged',t=>{
 const old=process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;
 t.after(()=>{if(old===undefined)delete process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE;else process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=old;});
 for(const [setting,model] of [['1','gemini-4-hydrogen-high'],['0','gemini-4-neon-high']]){
  process.env.ANTIGRAVITY_SEMANTIC_INSTRUCTION_ENVELOPE=setting;
  const r={systemInstruction:{parts:[{text:'policy'}]},contents:[]},before=structuredClone(r);
  assert.equal(envelopeClientInstructions(r,'policy',null,model,{protocol:'responses',system:'policy'}),false);assert.deepEqual(r,before);
 }
});
