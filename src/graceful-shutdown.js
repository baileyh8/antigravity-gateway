'use strict';

async function gracefulShutdown({ server, controllers, requests = new Set(), usageStore, accountPool, quotaManager, proxyManager, workers = [], timeoutMs = 30_000 }) {
  quotaManager.stop();
  usageStore.stop({ flush: false });
  const closed = new Promise((resolve) => server.close(resolve));
  const handlersDone = Promise.allSettled([...requests, ...(quotaManager.refreshing ? [quotaManager.refreshing] : [])]);
  const drained = Promise.allSettled([closed, handlersDone.then(async () => {
    server.closeIdleConnections?.();
    await Promise.allSettled([...workers].map((worker) => worker.close()));
  })]);
  let timer;
  const forced = await Promise.race([
    drained.then(() => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve(true), timeoutMs); })
  ]);
  clearTimeout(timer);
  if (forced) {
    for (const controller of controllers) controller.abort(new Error('Gateway shutting down'));
    server.closeAllConnections?.();
    for (const worker of workers) void worker.close().catch(() => {});
  }
  await proxyManager.close({ force: true });
  if (forced) {
    // Give aborted handlers time to account their final failed attempts without
    // allowing a broken transport to hang shutdown indefinitely.
    let settleTimer;
    await Promise.race([drained, new Promise((resolve) => { settleTimer = setTimeout(resolve, 1000); })]);
    clearTimeout(settleTimer);
  }
  accountPool.stop();
  if (usageStore.stop() === false) process.exitCode = 1;
}
module.exports = { gracefulShutdown };
