'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { compareVersions, classifyInstall } = require('./plugin-version');

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

test('classifyInstall: same commit on both sides turns a version disagreement into manifest-lag', () => {
  // sstklen 2026-09-15: plugin.json 1.1.0 installed, marketplace.json 1.0.0, both at 4752148.
  assert.equal(classifyInstall({
    installed: '1.1.0', offered: '1.0.0',
    installedSha: '47521489a4fc0537b633339372dcd7514032acfb',
    cloneSha: '47521489a4fc0537b633339372dcd7514032acfb\n',
  }), 'manifest-lag');
  assert.equal(classifyInstall({
    installed: '1.0.0', offered: '1.1.0', installedSha: 'abc', cloneSha: 'abc',
  }), 'manifest-lag');
});

test('classifyInstall: different commits keep the version verdict', () => {
  assert.equal(classifyInstall({ installed: '1.1.0', offered: '1.0.0', installedSha: 'aaa', cloneSha: 'bbb' }), 'ahead');
  assert.equal(classifyInstall({ installed: '1.0.0', offered: '1.1.0', installedSha: 'aaa', cloneSha: 'bbb' }), 'behind');
});

test('classifyInstall: missing shas fall back to the version verdict', () => {
  assert.equal(classifyInstall({ installed: '1.1.0', offered: '1.0.0' }), 'ahead');
  assert.equal(classifyInstall({ installed: '1.1.0', offered: '1.0.0', installedSha: 'aaa', cloneSha: null }), 'ahead');
});

test('classifyInstall: equal or unparseable versions pass through untouched', () => {
  assert.equal(classifyInstall({ installed: '1.1.0', offered: '1.1.0', installedSha: 'aaa', cloneSha: 'bbb' }), 'equal');
  assert.equal(classifyInstall({ installed: 'abc', offered: '1.0.0', installedSha: 'aaa', cloneSha: 'aaa' }), null);
});
