#!/usr/bin/env node
// node --test tools/jev.test.js
//
// The Jev client's unavailability contract (issue 724): with no key and no proxy (a GitHub Actions
// runner) it makes no request and answers null, so its callers' own code answers and the audit
// job needs no secret. No test here reaches the network.
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { askJev, askJevSync, jevReachable, proxyFor } = require('./jev.js');

test('no key and no proxy: unreachable, and both forms answer null without a request', async () => {
  assert.strictEqual(jevReachable({}), false);
  assert.strictEqual(askJevSync('x', { q: { type: 'noul', instructions: '?' } }, { env: {} }), null);
  assert.strictEqual(await askJev('x', { q: { type: 'noul', instructions: '?' } }, { env: {} }), null);
});

test('a key or a proxy makes it reachable; NO_PROXY naming the host does not count', () => {
  assert.strictEqual(jevReachable({ TYPESAFE_API_KEY: 'k' }), true);
  assert.strictEqual(jevReachable({ HTTPS_PROXY: 'http://127.0.0.1:9' }), true);
  assert.strictEqual(proxyFor({ HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: 'localhost,.typesafe.ai' }), null);
});

test('a refused connection is null, not a throw', async () => {
  // Port 9 on loopback refuses: the CONNECT fails and the caller falls back.
  const env = { HTTPS_PROXY: 'http://127.0.0.1:9' };
  assert.strictEqual(await askJev('x', { q: { type: 'noul', instructions: '?' } }, { env, timeoutMs: 2000 }), null);
});
