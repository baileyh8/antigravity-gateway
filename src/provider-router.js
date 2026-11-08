'use strict';

class ProviderRouterError extends Error {
  constructor(message, { code = 'provider_routing_error', status = 503 } = {}) {
    super(message);
    this.name = 'ProviderRouterError';
    this.code = code;
    this.status = status;
  }
}

// With the Robin and Gemini Windows channels removed, every request routes to
// the Cloud Code pool. The router remains so call sites keep a stable seam and
// a future provider could be added without touching the gateway core.
class ProviderRouter {
  constructor({ cloudcodePool } = {}) {
    if (!cloudcodePool) throw new Error('ProviderRouter requires cloudcodePool');
    this.cloudcodePool = cloudcodePool;
    this.catalog = { cloudcode: new Set() };
  }

  async refreshModels(signal, { cloudcodeDiscovery } = {}) {
    const result = await Promise.allSettled([
      cloudcodeDiscovery
        ? cloudcodeDiscovery(signal)
        : this.cloudcodePool.listModels(signal, { force: true })
    ]);
    const cloudcode = result[0];
    if (cloudcode.status === 'fulfilled') this.catalog.cloudcode = new Set(cloudcode.value);
    if (!this.catalog.cloudcode.size) throw cloudcode.reason || new ProviderRouterError('没有发现任何可用模型。');
    return this.models();
  }

  models() {
    return [...this.catalog.cloudcode].sort();
  }

  providerForModel() { return 'cloudcode'; }

  async resolveProvider() { return 'cloudcode'; }

  async send(normalized, model, options = {}) {
    const scoped = { ...options, providerType: 'cloudcode' };
    return this.cloudcodePool.send(normalized, model, scoped);
  }

  cancelTask() {
    // Cloud Code's stateless tool protocol has no retained task to cancel.
    return false;
  }
}

module.exports = { ProviderRouter, ProviderRouterError };
