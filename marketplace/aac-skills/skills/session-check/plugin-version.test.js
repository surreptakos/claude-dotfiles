'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { compareVersions } = require('./plugin-version');

test('installed older than offered reports behind', () => {
  assert.equal(compareVersions('1.0.0', '1.1.0'), 'behind');
  assert.equal(compareVersions('1.9.0', '1.10.0'), 'behind');
  assert.equal(compareVersions('2026.8.311502', '2026.9.111524'), 'behind');
});

test('installed newer than offered reports ahead (marketplace clone is stale)', () => {
  assert.equal(compareVersions('1.1.0', '1.0.0'), 'ahead');
  assert.equal(compareVersions('1.10.0', '1.9.0'), 'ahead');
  assert.equal(compareVersions('2026.9.111524', '2026.8.311502'), 'ahead');
});

test('equal versions report equal (no Plugins line will fire)', () => {
  assert.equal(compareVersions('1.1.0', '1.1.0'), 'equal');
  assert.equal(compareVersions('1.1', '1.1.0'), 'equal');
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 'equal');
});

test('unparseable but unequal versions return null (cannot say which is newer)', () => {
  assert.equal(compareVersions('abc', '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', 'not-a-version'), null);
});

test('unparseable but equal strings report equal', () => {
  assert.equal(compareVersions('build-xyz', 'build-xyz'), 'equal');
});

test('null or missing versions return null', () => {
  assert.equal(compareVersions(null, '1.0.0'), null);
  assert.equal(compareVersions('1.0.0', undefined), null);
});
