'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function run(context, callback) {
  return storage.run(context || null, callback);
}

function current() {
  return storage.getStore() || null;
}

module.exports = { current, run };
