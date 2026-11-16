'use strict';
require('./helpers/gateway-environment');process.env.ANTIGRAVITY_TOOL_CONTRACT='legacy';
const test=require('node:test'),assert=require('node:assert/strict');
const {withAsyncSchemaBoundary,closeSchemaWorkers}=require('../src/schema-contract');
const {DirectAntigravityProvider}=require('../src/direct-provider'),{AgySessionStore}=require('../src/agy-session-state');
const {normalizeAnthropicAsync,finalizeModelResultAsync}=require('../src/protocol');
test.after(closeSchemaWorkers);
for(const structured of [false,true])test(`legacy ${structured?'structured finish':'mapped tool'} remains worker-only at the HTTP schema boundary`,()=>withAsyncSchemaBoundary(async()=>{
 const schema={type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false};
 const n=await normalizeAnthropicAsync({messages:[{role:'user',content:'Synthetic only.'}],...(structured?{output_config:{format:{type:'json_schema',schema}}}:{tools:[{name:'Read',description:'Reads a file from the local filesystem.',input_schema:{type:'object',properties:{file_path:{type:'string'},offset:{type:'integer'},limit:{type:'integer'},pages:{type:'string'}},required:['file_path'],additionalProperties:false}}]})});
 const p=new DirectAntigravityProvider({localAuth:null,accessToken:'synthetic',projectId:'synthetic',maxRetries:0,sessionStore:new AgySessionStore({directory:''}),fetchImpl:async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{functionCall:{id:'issued',name:structured?'finish':'view_file',args:structured?{value:'ok',toolAction:'Reporting result',toolSummary:'Fixture result'}:{AbsolutePath:'/synthetic.txt',toolAction:'Reading file',toolSummary:'Fixture file'}}}]}}]}))});
 const r=await finalizeModelResultAsync(n,await p.send(n,'gemini-3.8-flash-high',{sessionId:'legacy-async-'+structured,nativeClientProfile:'claude-code-2.1.285'}));
 if(structured)assert.deepEqual(JSON.parse(r.text),{value:'ok'});else{assert.equal(r.toolCalls[0].name,'Read');assert.deepEqual(r.toolCalls[0].arguments,{file_path:'/synthetic.txt'});}
}));
