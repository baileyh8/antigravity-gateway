'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { quotaReserveReached, quotaRank, compareQuotaRanks, weightedPickWithRanks } = require('../src/account-scheduling');
const NOW = Date.parse('2026-11-04T00:00:00Z');
const bucket = (window, remaining, reset = NOW+3600000) => ({ window, remainingFraction: remaining,
  resetTime: new Date(reset).toISOString() });
const snapshot = (weekly, five, id = 'gemini', reset) => ({ groups: [{ id, buckets: [
  ...(weekly == null ? [] : [bucket('weekly', weekly, reset)]), ...(five == null ? [] : [bucket('5h', five, reset)])
] }] });
const rank = (id, weekly, five, options = {}) => quotaRank({ account: { id, weight: options.weight || 1 } },
  snapshot(weekly, five, options.group, options.reset), NOW, false, options.model || 'gemini-test', options.provider || 'cloudcode');
const pick = ranks => weightedPickWithRanks(ranks, new Map())?.account.id;

test('five-hour reserves are inclusive at 10%, weekly reserves at 5%, including native float boundaries', () => {
  for (const remaining of [.1, '0.1', 1-Math.fround(.9), .09, 0]) {
    assert.equal(quotaReserveReached(snapshot(.8, remaining), NOW, 'gemini-test'), true);
  }
  for (const remaining of [.05, '0.05', 1-Math.fround(.95), .04, 0]) {
    assert.equal(quotaReserveReached(snapshot(remaining,.8), NOW, 'gemini-test'), true);
  }
  assert.equal(quotaReserveReached(snapshot(.05001,.10001), NOW, 'gemini-test'), false);
  assert.equal(quotaReserveReached(snapshot(.08,.8), NOW, 'gemini-test'), false, 'weekly is not mistakenly held at 10%');
  const value=snapshot(.8,.09);value.groups[0].buckets[1].resetTime=new Date(NOW-1).toISOString();
  assert.equal(quotaReserveReached(value,NOW,'gemini-test'),false);
  value.groups[0].buckets.push(bucket('weekly',.05));
  assert.equal(quotaReserveReached(value,NOW,'gemini-test'),true);
});

test('window labels and bucket identifiers use the same 10/5 reserve, while unknown windows retain 5%', () => {
  for (const key of ['id','bucketId']) {
    assert.equal(quotaReserveReached({groups:[{id:'gemini',buckets:[{[key]:'gemini-5h',remainingFraction:.09}]}]},NOW,'gemini-test'),true);
    assert.equal(quotaReserveReached({groups:[{id:'gemini',buckets:[{[key]:'gemini-weekly',remainingFraction:.08}]}]},NOW,'gemini-test'),false);
  }
  assert.equal(quotaReserveReached({groups:[{id:'gemini',buckets:[{window:'unknown',remainingFraction:.08}]}]},NOW,'gemini-test'),false);
});

test('larger balances win even when lower balances reset sooner', () => {
  const rich=rank('rich',.9,.8,{reset:NOW+86400000}),low=rank('low',.4,.3,{reset:NOW+1000});
  assert.equal(pick([low,rich]),'rich');
  assert.ok(compareQuotaRanks(rich,low)<0);
  assert.equal(pick([rank('low-week',.3,.8),rank('high-week',.7,.8)]),'high-week');
  assert.equal(pick([rank('low-5h',.8,.3),rank('high-5h',.8,.7)]),'high-5h');
});

test('one almost empty window cannot be hidden by the other full window or configured account weight', () => {
  const uneven=rank('uneven',.9,.15,{weight:100}),balanced=rank('balanced',.7,.8);
  const weights=new Map();
  for (let i=0;i<30;i++) assert.equal(weightedPickWithRanks([uneven,balanced],weights).account.id,'balanced');
  assert.equal(pick([rank('weekly-short',.08,.99),rank('balanced',.5,.5)]),'balanced');
});

test('equal quotas rotate by configured weight even with different reset deadlines', () => {
  const ranks=[rank('a',.7,.7,{weight:1,reset:NOW+1000}),rank('b',.7,.7,{weight:2,reset:NOW+86400000})];
  const weights=new Map(),counts={a:0,b:0};
  for(let i=0;i<30;i++) counts[weightedPickWithRanks(ranks,weights).account.id]++;
  assert.deepEqual(counts,{a:10,b:20});
});

test('native float noise ties stably and partial or absent telemetry never invents a full second window', () => {
  const full=rank('full',.7,.7),partial=rank('partial',1,null),unknown=rank('unknown',null,null);
  assert.equal(pick([unknown,partial,full]),'full');
  assert.equal(pick([unknown,partial]),'partial');
  assert.equal(compareQuotaRanks(rank('a',.8,.8),rank('b',1-Math.fround(.2),1-Math.fround(.2))),0);
  const ranks=[rank('a',null,null),rank('b',null,null)],weights=new Map();
  assert.deepEqual(Array.from({length:4},()=>weightedPickWithRanks(ranks,weights).account.id),['a','b','a','b']);
});

test('Gemini, Claude/GPT, Cloud Argon and Robin GXU use only their own balances and window reserve', () => {
  const value={groups:[...snapshot(.9,.09).groups,...snapshot(.6,.8,'3p').groups,
    ...snapshot(.7,null,'gemini-argon-wtu').groups,...snapshot(.8,.09,'gemini-robin').groups]};
  for(const [model,provider,held] of [['gemini-test','cloudcode',true],['claude-test','cloudcode',false],
    ['gpt-test','cloudcode',false],['gemini-4-argon','cloudcode',false],['gemini-4-argon','robin',true]]) {
    assert.equal(quotaReserveReached(value,NOW,model,provider),held);
  }
  assert.equal(pick([rank('low',.3,null,{group:'gemini-argon-wtu',model:'gemini-4-argon'}),
    rank('high',.8,null,{group:'gemini-argon-wtu',model:'gemini-4-argon'})]),'high');
});

test('5h reserve cannot return through fallback and ranking re-evaluates when balances change', () => {
  const held=rank('held',1,.09),usable=rank('usable',.2,.2);
  assert.equal(pick([held]),undefined);assert.equal(pick([held,usable]),'usable');
  const weights=new Map();
  assert.equal(weightedPickWithRanks([rank('a',.9,.9),rank('b',.6,.6)],weights).account.id,'a');
  assert.equal(weightedPickWithRanks([rank('a',.3,.3),rank('b',.6,.6)],weights).account.id,'b');
});
