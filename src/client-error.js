'use strict';

const { isModelCapacityFailure } = require('./agy-upstream-error');

function cooldownSeconds(error) {
  return error.status === 429 && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
    ? Math.ceil(error.retryAfterMs / 1000) : 0;
}

// Preserve Google's structured status at both JSON and SSE boundaries. A bare
// "check quota" message does not establish exhausted credit or a billing wall.
// Internal error codes remain unchanged for account routing and diagnostics.
function clientError(error) {
  const code = error.code || 'gateway_error';
  const message = error.message || 'Gateway error';
  const seconds = cooldownSeconds(error);
  const timing = seconds ? { status: 429, resets_in_seconds: seconds } : {};
  if (code === 'direct_upstream_error' && isModelCapacityFailure(error.status, error.details)) {
    return { type: 'overloaded_error', code: 'model_capacity_exhausted', message,
      gateway_code: code, upstream_status: 'UNAVAILABLE', upstream_reason: 'MODEL_CAPACITY_EXHAUSTED' };
  }
  if (error.status === 429 && code === 'direct_upstream_error') {
    let upstream;
    try { upstream = JSON.parse(error.details); } catch { /* no structured evidence */ }
    if (upstream?.error?.status === 'RESOURCE_EXHAUSTED') {
      return { type: 'rate_limit_error', code: 'resource_exhausted', message,
        gateway_code: code, upstream_status: 'RESOURCE_EXHAUSTED', ...timing };
    }
  }
  return { type: seconds ? 'rate_limit_error' : code, code, message, ...timing };
}

module.exports = { clientError, cooldownSeconds };
