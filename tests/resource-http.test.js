'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'agy-budget-http-'));
process.env.ANTIGRAVITY_GATEWAY_CONFIG_DIR=directory;
process.env.ANTIGRAVITY_GATEWAY_REQUEST_MEMORY_BYTES='12288';
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT='agy';
delete process.env.ANTIGRAVITY_GATEWAY_API_KEY;
const {createServer}=require('../antigravity-gateway');
test('HTTP body budget rejects overload then releases capacity; file HEAD/GET/delete remain compatible',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(directory,{recursive:true,force:true})});
 const base='http://127.0.0.1:'+server.address().port;
 const post=body=>fetch(base+'/v1/files',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const rejected=await post({data:'x'.repeat(8000)});assert.equal(rejected.status,503);assert.equal((await rejected.json()).error.type,'memory_budget_exceeded');
 const bytes=Buffer.from('verified file content');const saved=await post({filename:'test.txt',media_type:'text/plain',data:bytes.toString('base64')});assert.equal(saved.status,200);const item=await saved.json();
 const head=await fetch(base+'/v1/files/'+item.id+'/content',{method:'HEAD'});assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),bytes.length);assert.equal(await head.text(),'');
 assert.equal(await(await fetch(base+'/v1/files/'+item.id+'/content')).text(),bytes.toString());
 assert.equal((await fetch(base+'/v1/files/'+item.id,{method:'DELETE'})).status,200);assert.equal((await fetch(base+'/v1/files/'+item.id+'/content')).status,404);
});
