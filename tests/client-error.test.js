'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {clientError}=require('../src/client-error');
test('structured Google exhaustion remains retryable rate limiting',()=>{
 const result=clientError({status:429,code:'direct_upstream_error',message:'check quota',details:JSON.stringify({error:{status:'RESOURCE_EXHAUSTED'}})});
 assert.equal(result.type,'rate_limit_error');assert.equal(result.code,'resource_exhausted');assert.equal(result.gateway_code,'direct_upstream_error');
});
test('unstructured quota wording and actual billing errors retain their semantics',()=>{
 for(const e of [{status:429,code:'direct_upstream_error',message:'check quota',details:'not json'},{status:402,code:'quota_exceeded',message:'billing exhausted'},{status:403,code:'direct_upstream_error',details:JSON.stringify({error:{status:'RESOURCE_EXHAUSTED'}})}])assert.equal(clientError(e).code,e.code);
});

test('cooldown rounds up and is available in a Responses stream error', () => {
  const { cooldownSeconds } = require('../src/client-error');
  const limit = {status: 429, code: 'account_pool_unavailable', message: 'Cooling down', retryAfterMs: 5_001};
  assert.equal(cooldownSeconds(limit), 6);
  assert.deepEqual(clientError(limit), {type: 'rate_limit_error', code: 'account_pool_unavailable',
    message: 'Cooling down', status: 429, resets_in_seconds: 6});
  assert.equal(cooldownSeconds({...limit, status: 503}), 0);
});
