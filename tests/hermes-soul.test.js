'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitizeClientIdentity}=require('../src/client-identity');
const fixture=require('./fixtures/hermes-framework-0231.json').instructions;
const make=system=>({protocol:'responses',system,tools:[],messages:[{role:'user',text:'Leave my business instructions intact.',parts:[{type:'text',text:'Leave my business instructions intact.'}]}]});
test('Hermes multi-paragraph SOUL keeps every user paragraph and cleans only the default identity',()=>{
 const split=fixture.indexOf('\n\n'),soul='\n\nMy identity: custom user assistant.\n\n# SOUL.md\nAsk before changing files.';
 const system=fixture.slice(0,split)+soul+fixture.slice(split),source=make(system),before=structuredClone(source),r=sanitizeClientIdentity(source);
 assert.equal(r.metadata.profile.client,'hermes');assert.equal(r.normalized.system,system.replace('You are Hermes Agent, built by Nous Research. ',''));assert.ok(r.normalized.system.includes(soul));assert.deepEqual(source,before);assert.deepEqual(r.normalized.messages,source.messages);
});
test('unknown user identity and changed framework documentation are preserved',()=>{
 for(const system of [fixture.replace('You are Hermes Agent, built by Nous Research. ','You are my chosen assistant. '),fixture.replace('your authoritative reference','my project notes')]){
  const r=sanitizeClientIdentity(make(system));assert.equal(r.normalized.system,system);
 }
});
