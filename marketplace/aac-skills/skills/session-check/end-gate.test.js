'use strict';

/**
 * The --end mechanical gate (issue 622). One test per behaviour the ticket states, plus one that
 * drives check.js itself, because a gate that has never been seen to fail is not known to work.
 *
 * The credential fixtures below are ASSEMBLED, never written as a literal: a literal would make
 * this file itself match `Assert-NoSecrets` and the very gate under test, and the repo would be
 * unshippable for the sake of a test string.
 */

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  compileSecretPatterns,
  hookScriptTargets,
  parseSecretPatterns,
  resolveHookScript,
  secretHits,
} = require('./end-gate');
const { findHarnessedRepoRoot, localEnv } = require('./test-support');

const CHECKER = path.join(__dirname, 'check.js');
// Never `path.join(__dirname, '..', '..')` — from the installed copy that is the home directory
// (issue 300). Null when this copy lives outside any checkout, which skips the one test that
// needs the real file.
const REPO_ROOT = findHarnessedRepoRoot(__dirname);
const MANIFEST = REPO_ROOT ? path.join(REPO_ROOT, 'lib', 'manifest.ps1') : null;

/** A JSON line holding a credential VALUE, built so this file holds no such literal. */
function credentialLine(key) {
  return '  "' + key + '": "' + 'A'.repeat(24) + '",';
}

function mkTmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test('the secret patterns are read out of manifest.ps1, not restated', () => {
  const text = "# comment\n$script:SecretPatterns = @(\n    'a''b',\n    'ya29\\.[A-Za-z0-9]{10,}'\n)\n";
  assert.deepEqual(parseSecretPatterns(text).patterns, ["a'b", 'ya29\\.[A-Za-z0-9]{10,}']);
  assert.match(parseSecretPatterns('nothing here').error, /no \$script:SecretPatterns/);
});

test("this repo's lib/manifest.ps1 parses, and every pattern compiles in JavaScript",
  { skip: !(MANIFEST && fs.existsSync(MANIFEST)) }, () => {
    const parsed = parseSecretPatterns(fs.readFileSync(MANIFEST, 'utf8'));
    assert.equal(parsed.error, undefined);
    assert.ok(parsed.patterns.length >= 5, `only ${parsed.patterns.length} patterns parsed`);
    assert.deepEqual(compileSecretPatterns(parsed.patterns).uncompilable, []);
  });

test('a credential value is a hit; prose naming the same key is not', () => {
  // The guard's own first pattern, so this asserts the shape the repo ships, not a weaker one.
  const { compiled } = compileSecretPatterns(['"refresh_token"\\s*:\\s*"[^"]{10,}"']);
  const files = { 'creds.json': '{\n' + credentialLine('refresh_token') + '\n}',
    'README.md': 'refresh at oauth2.googleapis.com/token with the refresh_token from that file' };
  const hits = secretHits(Object.keys(files), compiled, (f) => files[f]);
  assert.deepEqual(hits.map((h) => h.file), ['creds.json']);
});

test('a hook path under ~/.claude/hooks resolves into the tree; anything else is external', () => {
  assert.deepEqual(resolveHookScript('__USERHOME__\\.claude\\hooks\\stopslop-write.py'),
    { kind: 'repo', rel: 'profile/claude/hooks/stopslop-write.py',
      raw: '__USERHOME__\\.claude\\hooks\\stopslop-write.py' });
  assert.equal(resolveHookScript('$HOME/.claude/plugins/cache/x/hook.js').kind, 'external');
  assert.equal(resolveHookScript('/opt/mine.claude/hooks/hook.js').kind, 'external');
});

test('hookScriptTargets finds one entry per script across events, and counts the rest', () => {
  const cmd = (p) => `node "__USERHOME_FWD__/.claude/hooks/${p}" start`;
  const settings = { hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: cmd('session-gate.js') }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: cmd('session-gate.js') }] }],
    Stop: [{ hooks: [{ type: 'command', command: "& 'C:/nvm4w/nodejs/caveman.CMD' shrink-hook" }] }],
  } };
  const { carried, external } = hookScriptTargets(settings);
  assert.deepEqual(carried.map((c) => c.rel), ['profile/claude/hooks/session-gate.js']);
  assert.deepEqual(carried[0].events, ['SessionStart', 'SessionEnd']);
  assert.equal(external.length, 1);
});

/** A fixture tree shaped like the repo's `profile/claude/`, for SESSION_END_GATE_ROOT. */
function fixtureRoot(hookFile, body) {
  const root = mkTmp('end-gate-fixture-');
  const hooks = path.join(root, 'profile', 'claude', 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  if (body !== null) fs.writeFileSync(path.join(hooks, hookFile), body);
  fs.writeFileSync(path.join(root, 'profile', 'claude', 'settings.json'), JSON.stringify({
    hooks: { PostToolUse: [{ hooks: [{ type: 'command',
      command: `python3 "__USERHOME__/.claude/hooks/${hookFile}"` }] }] },
  }));
  return root;
}

/** check.js --end against a throwaway repo, with the hook gate pointed at a fixture tree. */
function runEndGate(root) {
  const repo = mkTmp('end-gate-repo-');
  fs.mkdirSync(path.join(repo, '.git'));
  try {
    return execFileSync(process.execPath, [CHECKER, '--end'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: localEnv({ SESSION_END_GATE_ROOT: root }),
    });
  } catch (error) {
    return String(error.stdout || '') + String(error.stderr || '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('check 3: a settings file naming a Python hook whose import is broken STOPs', () => {
  const out = runEndGate(fixtureRoot('broken.py', 'import definitely_not_a_module_12345\n'));
  assert.match(out, /End gate/);
  assert.match(out, /1 hook script\(s\) named in profile\/claude\/settings\.json are dead/);
  assert.match(out, /broken\.py — import fails: .*definitely_not_a_module_12345/);
});

test('check 3: a hook that exists and imports cleanly passes; a missing one STOPs', () => {
  const good = runEndGate(fixtureRoot('good.py', 'import json, sys\n\n\ndef main():\n    return 0\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n'));
  assert.match(good, /1 hook script\(s\) named in profile\/claude\/settings\.json exist/);
  const gone = runEndGate(fixtureRoot('gone.py', null));
  assert.match(gone, /gone\.py — named by PostToolUse, not on disk/);
});
