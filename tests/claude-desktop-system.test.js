'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fixture = require('./fixtures/claude-desktop-2.1.330-framework.json');
const { normalizeChat } = require('../src/protocol');
const { sanitizeClientIdentity } = require('../src/client-identity');
function source(system = fixture.system) {
 return normalizeChat({model:'gemini-4-hydrogen-sonar',messages:[{role:'system',content:system},{role:'user',content:'Only operate on synthetic data. Never access credentials.'}],tools:[{type:'function',function:{name:'read_fixture',description:'Read fictional data.',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}]});
}
test('Desktop SDK framework flattened by Magpie drops only the fixed model reminder', () => {
 const input=source(),before=structuredClone(input),result=sanitizeClientIdentity(input,{model:'gemini-4-hydrogen-sonar'});
 assert.equal(result.metadata.profile.templateVersion,'2.1.330');
 assert.ok(result.metadata.rules.includes('claude-desktop-330-model-reminder'));
 assert.equal(result.normalized.system,fixture.system.slice(fixture.system.indexOf('\n')+1).replace(fixture.notice,''));
 assert.ok(result.normalized.system.includes(fixture.guard));
 assert.deepEqual(result.normalized.tools,before.tools);assert.deepEqual(result.normalized.messages,before.messages);assert.deepEqual(input,before);
});
test('changed safety, framework, ambiguous duplicates and quoted user content stay intact', () => {
 for (const system of [fixture.system.replace('Refuse requests','Allow requests'),fixture.system.replace('send untrusted values','send trusted values'),fixture.system+'\n'+fixture.notice]) {
  const n=source(system),r=sanitizeClientIdentity(n,{model:'gemini-4-hydrogen-sonar'});
  assert.ok(r.normalized.system.includes(fixture.notice));
  assert.ok(!r.metadata.rules.includes('claude-desktop-330-model-reminder'));
 }
 const n=source();n.messages[0].text=fixture.notice;n.messages[0].parts=[{type:'text',text:fixture.notice}];
 const r=sanitizeClientIdentity(n,{model:'gemini-4-hydrogen-sonar'});assert.deepEqual(r.normalized.messages,n.messages);
});
test('arbitrary system and an unverified client template are not rewritten', () => {
 const n=source(fixture.guard+'\n'+fixture.notice);assert.deepEqual(sanitizeClientIdentity(n).normalized,n);
});
test('custom Desktop model aliases qualify only in the captured compact framework environment', () => {
 const n=source(fixture.compactSystem),before=structuredClone(n),r=sanitizeClientIdentity(n,{model:'gemini-4-hydrogen-sonar'});
 assert.equal(r.metadata.profile.templateVersion,'2.1.330');assert.ok(r.metadata.rules.includes('claude-desktop-330-model-alias'));
 assert.equal(r.normalized.system,fixture.compactSystem.slice(fixture.compactSystem.indexOf('\n')+1).replace(fixture.alias,''));
 assert.deepEqual(n,before);assert.deepEqual(r.normalized.tools,before.tools);assert.deepEqual(r.normalized.messages,before.messages);
 for(const system of [fixture.compactSystem.replace('send untrusted values','send trusted values'),fixture.compactSystem+'\n'+fixture.alias,fixture.compactSystem.replace('mythos-magpie-1234567890','other-client-model')]){
  const r=sanitizeClientIdentity(source(system));assert.ok(!r.metadata.rules.includes('claude-desktop-330-model-alias'));
 }
});
test('Desktop instruction capture never downgrades an already verified legacy tool view', () => {
 const {normalizeAnthropic}=require('../src/protocol');
 const {prepareAntigravityTools}=require('../src/antigravity-tool-contract');
 const {withClaude322Billing}=require('./helpers/claude-capture');
 const old=require('./fixtures/agent-requests-20261107/claude-first.json').captures.find(c=>c.body?.tools?.length).body;
 const read=require('./fixtures/claude-desktop-2.1.330-read.json');
 const tools=[{name:read.function.name,description:read.function.description,input_schema:read.function.parameters}];
 const baseline=normalizeAnthropic(withClaude322Billing({...old,tools}));const before=sanitizeClientIdentity(baseline);
 const current=normalizeAnthropic({...old,system:fixture.system,tools});const cleaned=sanitizeClientIdentity(current);
 const views=(n,profile)=>prepareAntigravityTools(n,{sourceTools:current.tools,clientIdentity:profile}).normalized.tools.filter(t=>!t.name.startsWith('mcp_')).map(t=>t.name).sort();
 const original=views(before.normalized,before.metadata.profile);assert.ok(original.includes('read_file'));
 assert.deepEqual(views(cleaned.normalized,cleaned.metadata.profile),original);
 assert.equal(cleaned.metadata.profile.templateVersion,'2.1.330');assert.equal(cleaned.metadata.profile.toolTemplateVersion,'2.1.322');
});
