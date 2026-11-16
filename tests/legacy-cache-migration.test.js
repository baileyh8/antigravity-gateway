'use strict';
require('./helpers/gateway-environment');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DirectAntigravityProvider}=require('../src/direct-provider'),{AgySessionStore}=require('../src/agy-session-state');
const {normalizeResponses}=require('../src/protocol');
const fixture=require('./fixtures/bailey-24-issued-cache.json');
for(const signed of [true,false])test(`persisted .24 cache migrates ${signed?'genuine':'unsigned'} Hydrogen call after restart without losing its receipt`,async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'agy-migrate-24-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const state=structuredClone(fixture.state),payload=structuredClone(fixture.payload);state.at=Date.now();
 if(!signed){const walk=v=>{if(v&&typeof v==='object'){delete v.thoughtSignature;delete v.thought_signature;for(const x of Object.values(v))walk(x);}};walk(state);walk(payload);}
 fs.writeFileSync(path.join(directory,state.key+'.json'),JSON.stringify(state),{mode:0o600});
 let posted;
 const provider=new DirectAntigravityProvider({accessToken:'synthetic',projectId:'synthetic',maxRetries:0,localAuth:{isConfigured:()=>false,load:()=>({sourcePath:fixture.identity})},sessionStore:new AgySessionStore({directory}),fetchImpl:async(u,o)=>{posted=JSON.parse(o.body);return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'Migrated'}]},finishReason:'STOP'}]}));}});
 assert.equal((await provider.send(normalizeResponses(payload),fixture.model,{sessionId:fixture.sessionId})).text,'Migrated');
 const parts=posted.request.contents.flatMap(c=>c.parts),call=parts.find(p=>p.functionCall),receipt=parts.find(p=>p.functionResponse);
 assert.match(call.functionCall.name,/^mcp_gateway_[a-f0-9]{16}$/);
 assert.equal(call.thoughtSignature,signed?'genuine-fixture-signature':'skip_thought_signature_validator');
 assert.equal(JSON.parse(call.functionCall.args.argumentsJson).query,'before');
 assert.equal(receipt.functionResponse.name,call.functionCall.name);assert.equal(receipt.functionResponse.id,'old-issued');
 assert.match(JSON.stringify(receipt.functionResponse.response),/synthetic-result/);
});
