'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ByteBudget } = require('../src/resource-budget');
const { SessionManager } = require('../src/session-manager');
const { UsageStore } = require('../src/usage-store');
const { ProxyManager } = require('../src/proxy-manager');
const { DirectAntigravityProvider } = require('../src/direct-provider');
const { normalizeChat } = require('../src/protocol');
const { MediaStore } = require('../src/multimedia');
const { SseWriter } = require('../src/sse-writer');
const { gracefulShutdown } = require('../src/graceful-shutdown');
function temp(t) { const d=fs.mkdtempSync(path.join(os.tmpdir(),'agy-stability-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d; }

for (const refreshFails of [false,true]) test('401 response is cancelled before refresh'+(refreshFails?' failure':' success'),async t=>{
 let cancelled=false,calls=0;
 const m=new ProxyManager({configDir:temp(t),agentFactory:()=>({close(){}}),fetchImpl:async()=>{
  if(++calls===1)return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('expired'))},cancel(){cancelled=true}}),{status:401});
  return new Response(JSON.stringify({response:{candidates:[{content:{parts:[{text:'OK'}]}}]}}));
 }});t.after(()=>m.close());m.upsert({id:'p',url:'http://localhost:9'});m.bind('a','p');
 const p=new DirectAntigravityProvider({fetchImpl:m.accountFetch('a'),refreshToken:'dummy',maxRetries:0});
 p.access=async(_signal,force)=>{if(force){assert(cancelled);if(refreshFails)throw new Error('refresh failed')}return 'dummy'};p.project=async()=> 'dummy';p.baseUrls=()=>['https://example.invalid'];
 const request=p.send(normalizeChat({messages:[{role:'user',content:'test'}]}),'gemini-test',{});
 if(refreshFails)await assert.rejects(request,/refresh failed/);else assert.equal((await request).text,'OK');
 assert(cancelled);assert.equal(m.snapshot().proxies[0].activeRequests,0);m.bind('a',null);
});

test('usage ENOSPC retains dirty state, backs off, then persists newer counters',t=>{
 const directory=temp(t);let now=Date.now(),fail=true,attempts=0;const errors=[];
 const wrapped={...fs,writeFileSync(...args){attempts++;if(fail)throw Object.assign(new Error('full'),{code:'ENOSPC'});return fs.writeFileSync(...args)}};
 const s=new UsageStore({configDir:directory,fsImpl:wrapped,now:()=>now,onSaveError:e=>errors.push(e.code)});
 s.recordClientRequest();assert.doesNotThrow(()=>s.tick());assert(s.dirty);assert.deepEqual(errors,['ENOSPC']);s.tick();assert.equal(attempts,1);
 s.recordClientRequest();fail=false;now+=5*60_000;s.tick();assert.equal(JSON.parse(fs.readFileSync(s.file)).lifetime.clientRequests,2);assert(!s.dirty);assert.equal(s.lastSaveError,null);
 assert.equal(fs.readdirSync(s.directory).filter(x=>x.endsWith('.tmp')).length,0);
});

test('shutdown drains real HTTP request accounting before final usage flush',async t=>{
 const http=require('node:http');const store=new UsageStore({configDir:temp(t)});const requests=new Set();let started;const entered=new Promise(r=>started=r);
 const server=http.createServer((_req,res)=>{const pending=new Promise(resolve=>setTimeout(()=>{store.recordClientRequest();res.end('OK');resolve()},30));requests.add(pending);started()});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const response=fetch('http://127.0.0.1:'+server.address().port);await entered;
 let closed=false;await gracefulShutdown({server,requests,controllers:new Set(),usageStore:store,accountPool:{stop(){}},quotaManager:{stop(){}},proxyManager:{async close(){closed=true}},timeoutMs:500});
 assert.equal(await (await response).text(),'OK');assert.equal(JSON.parse(fs.readFileSync(store.file)).lifetime.clientRequests,1);assert(closed);
});

test('shutdown aborts hanging requests within configured drain deadline',async()=>{
 const c=new AbortController();let forceClosed=false,flushed=false;let finish;
 const request=new Promise(r=>{finish=r;c.signal.addEventListener('abort',r,{once:true})});
 await gracefulShutdown({server:{close(cb){finish=request.then(cb)},closeAllConnections(){forceClosed=true}},controllers:new Set([c]),requests:new Set([request]),usageStore:{stop(o){if(!o)flushed=true}},accountPool:{stop(){}},quotaManager:{stop(){}},proxyManager:{async close(){}},timeoutMs:10});
 assert(c.signal.aborted);assert(forceClosed);assert(flushed);
});

test('request byte budget rejects contention and releases exactly once',()=>{
 const b=new ByteBudget(100),release=b.acquire(80);assert.throws(()=>b.acquire(30),{status:503});release();release();assert.equal(b.used,0);b.acquire(100)();assert.equal(b.used,0);
});

test('response cache evicts by retained bytes and actual access order, never retaining oversize entries',()=>{
 const cache=new SessionManager({maxBytes:5000});const req={headers:{},socket:{remoteAddress:'127.0.0.1'}};
 cache.bindResponse('a',req,{text:'x'.repeat(650)});cache.bindResponse('b',req,{text:'y'.repeat(650)});assert(cache.getResponse('a',req));
 cache.bindResponse('c',req,{text:'z'.repeat(650)});cache.bindResponse('d',req,{text:'q'.repeat(650)});
 assert(!cache.hasResponse('b'));assert(cache.bytes<=5000);assert.equal(cache.bindResponse('huge',req,{text:'x'.repeat(10000)}),false);assert(!cache.hasResponse('huge'));
 assert.equal(cache.bindResponse('private',req,{text:'a'},{store:false}),false);cache.responses.forEach((_v,k)=>cache.deleteResponse(k));assert.equal(cache.bytes,0);
});

test('async media storage enforces disk budget and metadata/delete never read binary content',async t=>{
 const d=temp(t);let binaryReads=0;
 const wrapped={...fs,promises:{...fs.promises,readFile:async(file,...args)=>{if(String(file).endsWith('.bin'))binaryReads++;return fs.promises.readFile(file,...args)}}};
 const m=new MediaStore({directory:d,fsImpl:wrapped});m.diskLimit=2500;
 const a=await m.saveAsync(Buffer.alloc(1500),{mediaType:'image/png',scope:'a'});
 assert.equal((await m.metadata(a.id,{scope:'a'})).bytes,1500);assert.equal(await m.metadata(a.id,{scope:'b'}),null);
 await assert.rejects(m.saveAsync(Buffer.alloc(1500),{scope:'a'}),{status:507});
 assert(await m.deleteAsync(a.id,{scope:'a'}));assert.equal(binaryReads,0);
 const b=await m.saveAsync(Buffer.alloc(1500),{scope:'a'});assert(b.id);assert(!fs.readdirSync(d).some(x=>x.endsWith('.tmp')));
});

class SlowResponse extends EventEmitter {
 constructor(){super();this.frames=[];this.writableLength=0;this.block=true;this.ended=false}
 write(x){this.frames.push(x);this.writableLength+=Buffer.byteLength(x);return !this.block}
 end(){this.ended=true}
 destroy(){this.emit('close')}
 drain(){this.writableLength=0;this.block=false;this.emit('drain')}
}
test('SSE waits for drain and preserves ordered terminal frame',async()=>{
 const r=new SlowResponse(),w=new SseWriter(r,{maxBytes:128});w.write('first');let ready=false;const p=w.ready().then(()=>ready=true);w.write('DONE');w.end();await Promise.resolve();assert(!ready);assert(!r.ended);assert.deepEqual(r.frames,['first']);r.drain();await p;assert.deepEqual(r.frames,['first','DONE']);assert(r.ended);
});
test('SSE bounds buffered bytes and rejects waiters on disconnect',async()=>{
 const r=new SlowResponse(),w=new SseWriter(r,{maxBytes:8});w.write('1234');const p=w.ready();assert.throws(()=>w.write('12345'),{code:'slow_client'});await assert.rejects(p,/缓冲/);assert.equal(w.bytes,0);
 const r2=new SlowResponse(),w2=new SseWriter(r2);w2.write('hello');const p2=w2.ready();r2.destroy();await assert.rejects(p2,/closed/);
});
test('direct SSE parser pauses on async downstream callback',async()=>{
 let unblock,seen=0;const barrier=new Promise(r=>unblock=r);
 const data='data: '+JSON.stringify({response:{candidates:[{content:{parts:[{text:'A'},{text:'B'}]}}]}})+'\n\n';
 const p=new DirectAntigravityProvider({fetchImpl:async()=>new Response(data,{headers:{'content-type':'text/event-stream'}})});p.access=async()=> 'dummy';p.project=async()=> 'dummy';
 const request=p.send(normalizeChat({messages:[{role:'user',content:'test'}],stream:true}),'gemini-test',{onDelta:async()=>{seen++;if(seen===1)await barrier}});
 await new Promise(r=>setImmediate(r));assert.equal(seen,1);unblock();assert.equal((await request).text,'AB');assert.equal(seen,2);
});

test('session aliases retain only digests even for oversized client identifiers',()=>{
 const cache=new SessionManager(),raw='s'.repeat(1024*1024);const a=cache.alias('conversation','scope',raw);assert.equal(cache.alias('conversation','scope',raw),a);
 assert([...cache.aliases.keys()].every(k=>k.length<=64));assert.equal(cache.aliases.size,1);
});
