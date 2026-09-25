'use strict';
// Issue 717: a pull must not lower a live plugin install back to the committed snapshot.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeInstalled, mergeMarketplaces, mergeSettings, main } = require('./plugin-records-merge.js');

const rec = (version, lastUpdated, extra = {}) => Object.assign({ scope: 'user', version, lastUpdated }, extra);

test('a newer live install survives; a newer committed one and committed-only entries land', () => {
  const committed = { version: 2, plugins: {
    'aac-skills@claude-dotfiles': [rec('2026.9.161952', '2026-09-16T19:54:24.213Z'),
      rec('2026.9.91004', '2026-09-09T19:40:30.429Z', { scope: 'project', projectPath: 'P' })],
    'yes@sstklen': [rec('1.1.0', '2026-09-03T21:22:01.060Z')],
  } };
  const live = { version: 2, plugins: {
    'aac-skills@claude-dotfiles': [rec('2026.9.231956', '2026-09-23T20:25:00.000Z'),
      rec('2026.9.1', '2026-09-01T00:00:00.000Z', { scope: 'project', projectPath: 'P' })],
    'local@only': [rec('0.1.0', '2026-09-20T00:00:00.000Z')],
  } };
  const out = mergeInstalled(committed, live);
  const aac = out.plugins['aac-skills@claude-dotfiles'];
  assert.strictEqual(aac.find((e) => e.scope === 'user').version, '2026.9.231956');
  assert.strictEqual(aac.find((e) => e.scope === 'project').version, '2026.9.91004');
  assert.strictEqual(out.plugins['yes@sstklen'][0].version, '1.1.0');
  assert.strictEqual(out.plugins['local@only'][0].version, '0.1.0');
});

test('marketplaces: newer live kept, committed-only registered', () => {
  const out = mergeMarketplaces(
    { a: { lastUpdated: '2026-09-10T00:00:00Z', v: 'c' }, b: { lastUpdated: '2026-09-10T00:00:00Z' } },
    { a: { lastUpdated: '2026-09-23T00:00:00Z', v: 'l' } });
  assert.strictEqual(out.a.v, 'l');
  assert.ok(out.b);
});

test('settings (issue 825): a live caveman route and hook entries survive a pull whose committed file carries neither', () => {
  const committed = { env: { ENABLE_TOOL_SEARCH: 'auto' }, model: 'claude-fable-5-1[1m]' };
  const live = {
    env: { ENABLE_TOOL_SEARCH: 'auto', ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787/w/claude', _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1' },
    model: 'claude-fable-5-1[1m]',
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: "& 'C:/x/caveman-proxy.exe' native-hook claude" }] }],
      Stop: [{ hooks: [{ type: 'command', command: "& 'C:/x/caveman.CMD' shrink-hook" }] }],
    },
  };
  const out = mergeSettings(committed, live);
  assert.strictEqual(out.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:8787/w/claude');
  assert.strictEqual(out.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL, '1');
  assert.strictEqual(out.hooks.SessionStart[0].hooks[0].command, "& 'C:/x/caveman-proxy.exe' native-hook claude");
  assert.strictEqual(out.hooks.Stop[0].hooks[0].command, "& 'C:/x/caveman.CMD' shrink-hook");
});

test('settings (issue 825): a real repo change in the committed file still lands, and a repeat merge never duplicates the live caveman entries', () => {
  const committed = { env: { ENABLE_TOOL_SEARCH: 'auto' }, theme: 'dark' };
  const live = {
    env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787/w/claude' },
    theme: 'light',
    hooks: { Stop: [{ hooks: [{ type: 'command', command: "& 'C:/x/caveman-proxy.exe' native-hook claude" }] }] },
  };
  const once = mergeSettings(committed, live);
  assert.strictEqual(once.theme, 'dark', 'the committed value wins - only caveman-owned bits carry over from live');
  const twice = mergeSettings(committed, once);
  assert.strictEqual(twice.hooks.Stop.length, 1, 'a second merge must not re-append the same live hook group');
});

test('settings (issue 825): a live install with no caveman entries at all merges to just the committed file', () => {
  const committed = { env: { ENABLE_TOOL_SEARCH: 'auto' } };
  const live = { env: { ENABLE_TOOL_SEARCH: 'auto' }, permissions: { defaultMode: 'bypassPermissions' } };
  const out = mergeSettings(committed, live);
  assert.deepStrictEqual(out, { env: { ENABLE_TOOL_SEARCH: 'auto' } });
});

test('CLI: no live file means the committed copy is written (fresh machine)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prm-717-'));
  const c = path.join(dir, 'c.json');
  const l = path.join(dir, 'l.json');
  fs.writeFileSync(c, JSON.stringify({ m: { lastUpdated: '2026-09-10T00:00:00Z' } }));
  assert.strictEqual(main(['marketplaces', c, l]), 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(l, 'utf8')), { m: { lastUpdated: '2026-09-10T00:00:00Z' } });
  fs.rmSync(dir, { recursive: true, force: true });
});
