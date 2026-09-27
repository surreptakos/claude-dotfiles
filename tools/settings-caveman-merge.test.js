'use strict';
// Issue 826: the profile carries no caveman wiring, and a pull keeps the live machine's own.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mergeSettings, main } = require('./settings-caveman-merge.js');

const PROFILE = path.join(__dirname, '..', 'profile', 'claude', 'settings.json');
const proxy = "& 'C:/Users/X/.caveman/bin/caveman-proxy.exe' native-hook claude --adapter 'C:/Users/X/.local/node_modules/@caveman-ai/cli/dist/native-hook-fast.js'";
const shrink = "& 'C:/Users/X/.local/caveman.cmd' shrink-hook";
const group = (command, extra = {}) => Object.assign({ hooks: [{ type: 'command', command, timeout: 30, shell: 'powershell' }] }, extra);

test('the profile settings carry no caveman-proxy, shrink-hook or caveman route', () => {
  const text = fs.readFileSync(PROFILE, 'utf8');
  for (const needle of ['caveman-proxy', 'shrink-hook', '127.0.0.1:8787', '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL']) {
    assert.ok(!text.includes(needle), `profile/claude/settings.json still carries ${needle}`);
  }
});

test('caveman hooks and route in the live file survive unchanged; the rest is the profile', () => {
  const committed = {
    env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', ENABLE_TOOL_SEARCH: 'auto' },
    permissions: { defaultMode: 'bypassPermissions' },
    statusLine: { type: 'command', command: 'status.ps1' },
    hooks: { Stop: [group('node other.js')] },
  };
  const live = {
    env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787/w/claude', _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1', STALE: 'x' },
    permissions: { defaultMode: 'default' },
    statusLine: { type: 'command', command: 'old.ps1' },
    hooks: {
      SessionStart: [group(proxy)],
      PreToolUse: [group(proxy, { matcher: '*' }), group(shrink)],
      Stop: [group('node stale-live.js'), group(proxy)],
    },
  };
  const out = mergeSettings(committed, live);
  assert.strictEqual(out.env.ANTHROPIC_BASE_URL, live.env.ANTHROPIC_BASE_URL);
  assert.strictEqual(out.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL, '1');
  assert.ok(!('STALE' in out.env));
  assert.strictEqual(out.env.ENABLE_TOOL_SEARCH, 'auto');
  assert.deepStrictEqual(out.permissions, committed.permissions);
  assert.deepStrictEqual(out.statusLine, committed.statusLine);
  assert.strictEqual(JSON.stringify(out.hooks.SessionStart), JSON.stringify(live.hooks.SessionStart));
  assert.strictEqual(JSON.stringify(out.hooks.PreToolUse), JSON.stringify(live.hooks.PreToolUse));
  assert.strictEqual(JSON.stringify(out.hooks.Stop), JSON.stringify([group('node other.js'), group(proxy)]));
});

test('a non-caveman base URL is not carried; a live file with no caveman wiring gets the profile', () => {
  const committed = { env: { A: '1' }, hooks: {} };
  const out = mergeSettings(committed, { env: { ANTHROPIC_BASE_URL: 'https://example.test' }, hooks: { Stop: [group('node x.js')] } });
  assert.deepStrictEqual(out, committed);
});

test('CLI: merges into the live file, and running it twice changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-826-'));
  const c = path.join(dir, 'c.json');
  const l = path.join(dir, 'l.json');
  fs.writeFileSync(c, JSON.stringify({ env: { A: '1' }, hooks: {} }));
  fs.writeFileSync(l, JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:8787/w/claude' }, hooks: { Stop: [group(proxy)] } }));
  assert.strictEqual(main([c, l]), 0);
  const first = fs.readFileSync(l, 'utf8');
  assert.strictEqual(main([c, l]), 0);
  assert.strictEqual(fs.readFileSync(l, 'utf8'), first);
  assert.deepStrictEqual(JSON.parse(first).hooks.Stop, [group(proxy)]);
  fs.rmSync(dir, { recursive: true, force: true });
});
