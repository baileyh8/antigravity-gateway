'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fixtures=require('./fixtures/client-instruction-profiles-20261121.json');
const {normalizeChat}=require('../src/protocol');
const {sanitizeClientIdentity}=require('../src/client-identity');
const {capturedInstructionProfile}=require('../src/client-instruction-profile');
const {buildDirectRequest}=require('../src/direct-provider');
const {generationProfile}=require('../src/antigravity-model-config');
for(const client of ['hermes','dsh'])test(`${client}: verified current tool schemas preserve source rules under the separate envelope`,()=>{
 const f=fixtures[client],payload={model:'gemini-4-hydrogen-sonar',messages:[{role:'system',content:f.system},{role:'user',content:'Only synthetic fixtures. Never access private files.'}],tools:f.tools};
 const n=normalizeChat(payload),before=structuredClone(n),identity=sanitizeClientIdentity(n);assert.equal(capturedInstructionProfile(n).client,client);assert.equal(identity.normalized.system,n.system);
 const native={},wire=buildDirectRequest(n,'gemini-4-hydrogen-sonar','fixture','fixture','',null,native);
 assert.equal(native.clientInstructionEnvelope,client==='hermes');assert.deepEqual(n,before);
 if(client==='hermes')assert.ok(wire.request.contents[0].parts[0].text.includes('Synthetic project policy'));
 else assert.ok(wire.request.systemInstruction.parts[0].text.includes(f.system));
 // A named tool with a changed declaration cannot authorize this capture.
 const changed=structuredClone(n);changed.tools[0].schema={type:'object',properties:{unrelated:{type:'number'}}};assert.equal(capturedInstructionProfile(changed),null);
});
test('modern output-budget aliases and the trusted model ceiling retain reasoning',()=>{
 const n=normalizeChat({max_completion_tokens:262144,messages:[{role:'user',content:'fixture'}],reasoning_effort:'high'});assert.equal(n.generationConfig.maxOutputTokens,262144);
 const g=generationProfile(n,'gemini-4-hydrogen-sonar',{maxOutputTokens:65536,supportsThinking:true,thinkingLevel:1});assert.equal(g.maxOutputTokens,65536);assert.equal(g.thinkingConfig.thinkingLevel,'HIGH');assert.equal(n.generationConfig.maxOutputTokens,262144);
 const lower=generationProfile({...n,generationConfig:{maxOutputTokens:128}},'gemini-4-hydrogen-sonar',{maxOutputTokens:65536});assert.equal(lower.maxOutputTokens,128);
 const unknown=generationProfile(n,'custom-no-limit');assert.equal(unknown.maxOutputTokens,262144);
});
test('cold completion-budget requests share one bounded catalog lookup; warm requests do not fetch',async()=>{
 const {DirectAntigravityProvider}=require('../src/direct-provider');const p=new DirectAntigravityProvider({accessToken:'fixture',projectId:'fixture',models:[]});let count=0,resolve;
 p.discoverModels=async()=>{count++;await new Promise(r=>{resolve=r;});p.discoveredModelInfo.set('gemini-4-hydrogen-sonar',{maxOutputTokens:65536});};
 const n=normalizeChat({max_completion_tokens:262144,messages:[]});const a=p.ensureCompletionBudgetCatalog(n,n.model='gemini-4-hydrogen-sonar'),b=p.ensureCompletionBudgetCatalog(n,n.model);
 assert.equal(count,1);resolve();await Promise.all([a,b]);await p.ensureCompletionBudgetCatalog(n,n.model);assert.equal(count,1);
 const noBudget=normalizeChat({messages:[]});await p.ensureCompletionBudgetCatalog(noBudget,'uncatalogued-fixture');assert.equal(count,1);
});
test('Hermes custom SOUL is preserved; duplicate framework ownership never guesses',()=>{
 const f=fixtures.hermes,system=f.system.replace(f.system.split('\n\n')[0],'User-defined persona. Never weaken project approval restrictions.');
 const n=normalizeChat({messages:[{role:'system',content:system},{role:'user',content:'Synthetic task.'}],tools:f.tools}),before=structuredClone(n),r=sanitizeClientIdentity(n);
 assert.equal(capturedInstructionProfile(n).client,'hermes');assert.equal(r.normalized.system,system);assert.deepEqual(n,before);
 const repeated=structuredClone(n);repeated.system+='\n\n'+system;assert.equal(capturedInstructionProfile(repeated),null);
});
