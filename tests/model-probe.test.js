'use strict';
require('./helpers/gateway-environment');
const assert=require('node:assert/strict');const test=require('node:test');const http=require('node:http');
process.env.AGY_ADMIN_TOKEN='synthetic-probe-admin';
process.env.AGY_MULTI_KEY='1';
process.env.AGY_KEY_PEPPER='synthetic-probe-pepper';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const fs=require('node:fs');const path=require('node:path');
const keyFile=path.join(process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR,'api-keys.json');
const {createServer}=require('../antigravity-gateway');
test('admin model probe preserves upstream output defaults for thinking models',async t=>{
 let seen;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  assert.ok(String(url).endsWith('/v1/chat/completions'));
  seen=JSON.parse(options.body);
  assert.match(options.headers.authorization,/^Bearer agy_sk_/);
  const key=JSON.parse(fs.readFileSync(keyFile,'utf8')).keys[0];
  assert.deepEqual(key.models,['claude-sonnet-4-6']);
  assert.ok(Date.parse(key.expiresAt)>Date.now());
  assert.equal(Object.hasOwn(seen,'max_tokens'),false);
  return new Response(JSON.stringify({choices:[{message:{content:'OK'}}],usage:{total_tokens:7}}),{status:200,headers:{'content-type':'application/json','x-antigravity-model':seen.model}});
 });
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const response=await new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/_admin/v1/models/claude-sonnet-4-6/test',method:'POST',headers:{'x-agy-admin-token':process.env.AGY_ADMIN_TOKEN},agent:false},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));});req.on('error',reject);req.end();
 });
 assert.equal(response.status,200);assert.equal(response.body.data.text,'OK');assert.equal(seen.model,'claude-sonnet-4-6');
 assert.equal(JSON.parse(fs.readFileSync(keyFile,'utf8')).keys.length,0);
});

test('failed admin probes remove their temporary key too',async t=>{
 const now=Date.now();t.mock.method(Date,'now',()=>now+3000);
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('synthetic upstream failure');});
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const response=await new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:server.address().port,path:'/_admin/v1/models/claude-sonnet-4-6/test',method:'POST',headers:{'x-agy-admin-token':process.env.AGY_ADMIN_TOKEN},agent:false},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});req.on('error',reject);req.end();
 });
 assert.equal(response.status,500);assert.equal(JSON.parse(fs.readFileSync(keyFile,'utf8')).keys.length,0);
});
