'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { quotaRank, quotaGroup, modelGroup, weightedPickWithRanks } = require('../src/account-scheduling');
const { ExecutionSlots } = require('../src/admission-control');
const { AccountPool } = require('../src/account-pool');
const { AccountStore } = require('../src/account-store');
const now = Date.parse('2026-11-02T00:00:00Z');
const group = (id, remaining, window = 'weekly') => ({ id, buckets: [{ window, remainingFraction: remaining, available: remaining > 0, resetTime: new Date(now + 3600000).toISOString() }] });
const record = id => ({ account: { id, weight: 1 } });

test('Gemini, Claude/GPT and Argon choose their own quota group, including separate weekly-only Argon', () => {
  const entries = [record('gemini'), record('claude'), record('argon')];
  const snapshots = entries.map((entry, i) => ({ groups: [group('gemini', i === 0 ? .9 : 0), group('3p', i === 1 ? .9 : 0), group('gemini-argon-wtu', i === 2 ? .9 : 0)] }));
  for (const [model, expected] of [['gemini-3.8-flash-high','gemini'],['claude-opus-5-5-high','claude'],['gpt-oss-120b-medium','claude'],['gemini-4-argon-low','argon']]) {
    const ranks = entries.map((entry, i) => quotaRank(entry, snapshots[i], now, false, model, 'cloudcode'));
    assert.equal(weightedPickWithRanks(ranks, new Map()).account.id, expected);
  }
  assert.equal(quotaGroup(snapshots[0], 'custom-model'), null);
  assert.equal(modelGroup('models/gemini-4-argon-high'), 'argon');
});

test('exhausted five-hour quota affects only its model group; passed reset windows are stale', () => {
  const snapshot = { groups: [group('gemini', .9), { id:'3p', buckets:[...group('3p',.9).buckets, ...group('3p',0,'5h').buckets] }] };
  assert.equal(quotaRank(record('a'),snapshot,now,false,'gemini-test','cloudcode').depleted,0);
  assert.equal(quotaRank(record('a'),snapshot,now,false,'claude-test','cloudcode').depleted,1);
  snapshot.groups[1].buckets[1].resetTime = new Date(now - 1).toISOString();
  assert.equal(quotaRank(record('a'),snapshot,now,false,'claude-test','cloudcode').depleted,0);
});

test('Argon never borrows Cloud Code Gemini quota; Robin/Windows explicitly use their GXU pool', () => {
  const snapshot = { groups: [group('gemini', .8)] };
  assert.equal(quotaGroup(snapshot, 'gemini-4-argon'),null);
  snapshot.groups.push(group('gemini-robin', .6));
  assert.equal(quotaGroup(snapshot, 'gemini-4-argon','robin').id,'gemini-robin');
});

test('weighted round-robin state is independent between model groups', () => {
  const entries = [record('a'),record('b')], weights = new Map();
  const snapshot = { groups:[group('gemini',.7),group('3p',.7)] };
  const pick = model => weightedPickWithRanks(entries.map(entry => quotaRank(entry,snapshot,now,false,model,'cloudcode')),weights).account.id;
  assert.equal(pick('gemini-test'),'a'); assert.equal(pick('claude-test'),'a');
  assert.equal(pick('gemini-test'),'b'); assert.equal(pick('gpt-test'),'b');
});

test('a busy bound account uses another account before queueing, across different model families', async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'group-admission-'));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new AccountStore({configDir:directory});
  const accounts=['a','b'].map(id=>store.save({id,email:`${id}@example.com`,accessToken:'test-only',projectId:'test'}));
  const pending=[];
  const pool=new AccountPool({store,providerFactory:account=>({listModels:async()=>['gemini-test','claude-test'],send:async()=>new Promise(resolve=>pending.push({id:account.id,resolve}))})});
  pool.admission=new ExecutionSlots({limit:60,accountLimit:5});
  for(let i=0;i<6;i++)pool.bindSession(`session-${i}`,accounts[0].id);
  const turns=Array.from({length:5},(_,i)=>pool.send({},i%2?'claude-test':'gemini-test',{routingKey:`session-${i}`}));
  for(let i=0;i<100&&pending.length<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending.length,5);assert.ok(pending.every(item=>item.id===accounts[0].id));
  const overflow=pool.send({},'claude-test',{routingKey:'session-5'});
  for(let i=0;i<100&&pending.length<6;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pending[5].id,accounts[1].id);assert.equal(pool.admission.waiters.length,0);
  pending.forEach(item=>item.resolve({text:'OK',usage:{},toolCalls:[]}));await Promise.all([...turns,overflow]);
  assert.equal(pool.sessions.get('session-5').accountId,accounts[1].id);
  assert.equal(pool.admission.active,0);
});
