'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http2 = require('node:http2'), http = require('node:http'), net = require('node:net');
const { ProxyManager } = require('../src/proxy-manager');
const { ProxyRobinTransport, accountFetch, tunnel } = require('../src/robin-proxy');
const { grpcFrame } = require('../src/robin-proto');
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'robin-proxy-'));
  const manager=new ProxyManager({configDir:dir,agentFactory:url=>({url,close(){}})});
  manager.upsert({id:'p',url:'http://user:password@127.0.0.1:9099'});
  t.after(async()=>{await manager.close();fs.rmSync(dir,{recursive:true,force:true})});return manager;
}
test('Robin HTTP never falls back to direct and provider-prefixed bindings cannot collide',async t=>{
  const manager=setup(t);manager.bind('same','p');let calls=0;
  const fetcher=accountFetch(manager,'same',async(_input,init)=>{calls++;assert.equal(init.dispatcher.url,manager.state.proxies[0].url);return new Response('ok')});
  assert.throws(()=>fetcher('https://example.test'),/必须绑定/);assert.equal(calls,0);
  manager.bind('robin:same','p');assert.equal(await (await fetcher('https://example.test')).text(),'ok');assert.equal(calls,1);
});
test('gRPC request survives asynchronous tunnel setup, uses binding and releases lease at stream completion',async t=>{
  const manager=setup(t);manager.bind('robin:a','p');
  const server=http2.createServer();const sessions=new Set();server.on('session',s=>{sessions.add(s);s.on('close',()=>sessions.delete(s))});
  let received=Buffer.alloc(0);
  server.on('stream',(stream,headers)=>{assert.equal(headers[':path'],'/rpc');stream.on('data',d=>{received=Buffer.concat([received,d])});stream.on('end',()=>{stream.respond({':status':200,'grpc-status':'0'});stream.end(grpcFrame(Buffer.from('answer')))});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const s of sessions)s.destroy();await new Promise(r=>server.close(r))});
  const transport=new ProxyRobinTransport({manager,accountId:'a',tunnelImpl:async(origin,p)=>{assert.equal(p.id,'p');await new Promise(r=>setImmediate(r));return net.connect(server.address().port,'127.0.0.1')}});
  const s=transport.request('/rpc','fixture');s.end(Buffer.from('question'));
  assert.equal(manager.active.get('p'),1);assert.throws(()=>manager.bind('robin:a',null),/在途/);
  assert.equal((await s.done)[0].toString(),'answer');assert.deepEqual(received,grpcFrame(Buffer.from('question')));assert.equal(manager.active.get('p'),0);
});
test('CONNECT authentication stays in proxy header; rejection fails closed',async t=>{
  let seen;const server=http.createServer();server.on('connect',(req,socket)=>{seen=req.headers['proxy-authorization'];assert.equal(req.url,'example.test:443');socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  await assert.rejects(tunnel('https://example.test',{url:`http://user:password@127.0.0.1:${server.address().port}`}),e=>{assert.equal(e.code,'robin_proxy_error');assert.ok(!e.message.includes('password'));return true});
  assert.equal(seen,'Basic '+Buffer.from('user:password').toString('base64'));
});
test('cancelled pending tunnel releases active accounting without direct fallback',async t=>{
  const manager=setup(t);manager.bind('robin:a','p');
  const transport=new ProxyRobinTransport({manager,accountId:'a',tunnelImpl:(_o,_p,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  const s=transport.request('/rpc','fixture');s.close();await assert.rejects(s.done);assert.equal(manager.active.get('p'),0);
});
