'use strict';
require('./helpers/gateway-environment');
process.env.ANTIGRAVITY_GATEWAY_TRANSPORT='direct';
const test=require('node:test'),assert=require('node:assert/strict');
const {AccountPool}=require('../src/account-pool');
const {codexModelInfo,codexCatalogBody,createServer}=require('../antigravity-gateway');
const {buildDirectRequest}=require('../src/direct-provider');
const {generationProfile}=require('../src/antigravity-model-config');
const {normalizeChat,normalizeResponses,normalizeAnthropic}=require('../src/protocol');
const {closeSchemaWorkers}=require('../src/schema-contract');
test.after(closeSchemaWorkers);
const sonar='gemini-4-hydrogen-sonar';
// Synthetic catalog fixture using observed public limits/tier; no real enum,
// account identity, credentials or private request contents are captured here.
const metadata={displayName:'Synthetic Sonar',model:'SYNTHETIC_SONAR_ENUM',maxTokens:1048576,maxOutputTokens:65536,
  supportsThinking:true,thinkingLevel:1,supportsImages:false,supportsVideo:false,supportsAudio:false};

test('Sonar uses the discovered LOW tier and output limit without rewriting its model ID or client instructions',()=>{
  const n={system:'Keep the original project instructions.',messages:[{role:'user',text:'Synthetic input.'}],tools:[],
    generationConfig:{thinkingLevel:'HIGH',reasoning_effort:'high'}};
  const original=JSON.stringify(n);
  const request=buildDirectRequest(n,sonar,'synthetic-project','synthetic-session','',null,{modelInfo:metadata});
  assert.equal(request.model,sonar);
  assert.equal(request.request.labels.model_enum,metadata.model);
  assert.deepEqual(request.request.generationConfig.thinkingConfig,{includeThoughts:true,thinkingLevel:'LOW'});
  assert.equal(request.request.generationConfig.maxOutputTokens,65536);
  assert.equal(request.request.systemInstruction.parts[0].text,n.system);
  assert.equal(JSON.stringify(n),original);
});

test('Sonar catalog reports selectable low/medium/high, the LOW default and actual capabilities',t=>{
  t.mock.method(AccountPool.prototype,'modelInfo',()=>metadata);
  const info=codexModelInfo(sonar,0);
  assert.equal(info.context_window,1048576);
  assert.equal(info.max_output_tokens,65536);
  assert.equal(info.default_reasoning_level,'low');
  assert.deepEqual(info.supported_reasoning_levels.map(x=>x.effort),['low','medium','high']);
  assert.equal(info.fixed_thinking_config,undefined);
  assert.deepEqual(info.default_thinking_config,{includeThoughts:true,thinkingLevel:'LOW'});
  assert.deepEqual(info.input_modalities,['text']);
  assert.equal(info.supports_images,false);
  const response=codexCatalogBody([sonar]);
  for(const row of [response.data[0],response.models[0]]){
    assert.equal(row.context_window,1048576);assert.equal(row.max_output_tokens,65536);
    assert.equal(row.default_reasoning_level,'low');assert.equal(row.fixed_thinking_config,undefined);
    assert.deepEqual(row.supported_reasoning_levels.map(x=>x.effort),['low','medium','high']);
    assert.deepEqual(row.default_thinking_config,info.default_thinking_config);
  }
});

test('numeric Hydrogen XHigh remains supported when producing the extended catalog',t=>{
  t.mock.method(AccountPool.prototype,'modelInfo',()=>({...metadata,thinkingLevel:100}));
  const info=codexModelInfo('gemini-4-hydrogen-xhigh',0);
  assert.equal(info.default_reasoning_level,'xhigh');
  assert.equal(info.fixed_thinking_config.thinkingLevel,100);
});

test('new unknown models without a verified thinking setting do not advertise invented reasoning tiers',t=>{
  t.mock.method(AccountPool.prototype,'modelInfo',()=>({maxTokens:500000,maxOutputTokens:12000,supportsImages:false}));
  const info=codexModelInfo('new-dynamic-model',0);
  assert.equal(info.default_reasoning_level,null);assert.deepEqual(info.supported_reasoning_levels,[]);
  assert.equal(info.fixed_thinking_config,undefined);
});

test('classifier budget is increased only for identified thinking classifiers and remains within the discovered limit',()=>{
  const config={generationConfig:{maxOutputTokens:64,stopSequences:['</severity>']},autoMode:true,autoModeFormat:'severity'};
  const classifier=generationProfile(config,sonar,metadata);
  assert.equal(classifier.maxOutputTokens,4096);
  assert.equal(classifier.stopSequences,undefined);
  assert.equal(generationProfile({...config,autoMode:false},sonar,metadata).maxOutputTokens,64);
  assert.equal(generationProfile(config,sonar,{...metadata,maxOutputTokens:1024}).maxOutputTokens,1024);
});

test('public model discovery exposes dynamic Sonar metadata to an unknown HTTP client',async t=>{
  t.mock.method(AccountPool.prototype,'modelInfo',()=>metadata);
  t.mock.method(AccountPool.prototype,'listModels',async()=>[sonar]);
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/models`);
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.data.find(m=>m.id===sonar).default_reasoning_level,'low');
  for(const row of [body.models.find(m=>m.slug===sonar),body.data.find(m=>m.id===sonar)]){
    assert.equal(row.default_thinking_config.thinkingLevel,'LOW');
    assert.deepEqual(row.supported_reasoning_levels.map(x=>x.effort),['low','medium','high']);
    assert.equal(row.fixed_thinking_config,undefined);
  }
});


test('all three protocols carry named or numeric Sonar levels to the actual upstream request builder',()=>{
  for(const effort of ['low','medium','high',1,2,3]){
    const expected=({1:'LOW',2:'MEDIUM',3:'HIGH'})[effort]||effort.toUpperCase();
    for(const normalized of [
      normalizeChat({model:sonar,messages:[{role:'user',content:'Synthetic input.'}],reasoning_effort:effort}),
      normalizeResponses({model:sonar,input:'Synthetic input.',reasoning:{effort}}),
      normalizeAnthropic({model:sonar,messages:[{role:'user',content:'Synthetic input.'}],output_config:{effort}})
    ]){
      const original=JSON.stringify(normalized);
      const body=buildDirectRequest(normalized,sonar,'synthetic-project','synthetic-session','',null,{modelInfo:metadata});
      assert.equal(body.model,sonar);assert.equal(body.request.labels.model_enum,metadata.model);
      assert.deepEqual(body.request.generationConfig.thinkingConfig,{includeThoughts:true,thinkingLevel:expected});
      assert.equal(JSON.stringify(normalized),original);
    }
  }
});

test('unsupported Sonar levels fail locally and other model contracts remain fixed',()=>{
  for(const effort of ['xhigh','minimal','max','constructor','__proto__',4,100]){
    const normalized=normalizeResponses({model:sonar,input:'Synthetic input.',reasoning:{effort}});
    assert.throws(()=>buildDirectRequest(normalized,sonar,'p','s','',null,{modelInfo:metadata}),
      error=>error.status===400&&error.code==='unsupported_thinking_level');
  }
  assert.equal(generationProfile({reasoningEffort:'none'},sonar,metadata).thinkingConfig.thinkingLevel,'LOW');
  assert.equal(generationProfile({reasoningEffort:'high'},'gemini-4-hydrogen-low',metadata).thinkingConfig.thinkingLevel,'LOW');
  assert.equal(generationProfile({reasoningEffort:'low'},'gemini-4-hydrogen-xhigh',metadata).thinkingConfig.thinkingLevel,100);
});

test('unknown HTTP clients receive a local 400 for unsupported Sonar effort before account admission',async t=>{
  t.mock.method(AccountPool.prototype,'modelInfo',()=>metadata);
  t.mock.method(AccountPool.prototype,'listModels',async()=>[sonar]);
  let admissions=0;
  const {ProviderRouter}=require('../src/provider-router');
  t.mock.method(ProviderRouter.prototype,'send',async()=>{admissions++;throw Error('must not dispatch');});
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  for(const [path,payload] of [
    ['/v1/chat/completions',{messages:[{role:'user',content:'Synthetic input.'}],reasoning_effort:'xhigh'}],
    ['/v1/responses',{input:'Synthetic input.',reasoning:{effort:4}}],
    ['/v1/messages',{messages:[{role:'user',content:'Synthetic input.'}],output_config:{effort:100}}]
  ]){
    const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:sonar,stream:true,...payload})});
    assert.equal(response.status,400);const body=await response.json();
    assert.equal(body.error.code,'unsupported_thinking_level');
  }
  assert.equal(admissions,0);
});
