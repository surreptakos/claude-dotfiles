#!/usr/bin/env node
/**
 * node --test tools/session-start-hook.test.js
 *
 * The cloud-container bootstrap hook (.claude/hooks/session-start.sh) emits ONE
 * SessionStart `additionalContext` line on prompt 1 (spec #207 step 6). Issue 242
 * discovered that a model reading that line has a coin-flip between the plugin's
 * `/aac-skills:<skill>` namespaced slash form and the bare `/<skill>` form, and
 * only the bare form resolves in a bootstrapped container because the bootstrap
 * copies each skill dir to `~/.claude/skills/<bare-name>/` and never registers
 * the plugin. The evidence recap is at docs/tickets/242-decision.md.
 *
 * This test pins the fix: run the hook against a fixture and assert that the
 * additionalContext sentence explicitly names the working spelling AND flags the
 * non-resolving one. Deleting or paraphrasing that clause fails here before it
 * reaches a container.
 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, '.claude', 'hooks', 'session-start.sh');

function runHook() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-bootstrap-hook-'));
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  const envFile = path.join(home, 'env-file');
  fs.writeFileSync(envFile, '');
  const result = spawnSync('bash', [HOOK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      // Without it the Windows Python install manager behind python3 roots itself in the cwd and
      // downloads a whole Python into ./Python, printing "Downloading" into the hook output.
      ...(process.env.LOCALAPPDATA && { LOCALAPPDATA: process.env.LOCALAPPDATA }),
      HOME: home,
      CLAUDE_CODE_REMOTE: 'true',
      BOOTSTRAP_HOME: home,
      BOOTSTRAP_SOURCE: REPO_ROOT,
      BOOTSTRAP_SKIP_GH: '1',
      CLAUDE_ENV_FILE: envFile,
    },
  });
  return { result, home };
}

test('SessionStart additionalContext names the bare /<skill> spelling and flags /aac-skills:<skill> as non-resolving (issue 242)', () => {
  const { result } = runHook();
  assert.equal(result.status, 0, `hook exited ${result.status}\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  const payload = JSON.parse(result.stdout);
  const ctx = payload.hookSpecificOutput.additionalContext;
  // The working spelling is spelled out with the bare-name marker.
  assert.match(ctx, /invoke skills as \/<skill> \(bare name\)/,
    `additionalContext missing the working-spelling clause:\n${ctx}`);
  // The non-resolving spelling is named contrastively so a reader does not try it.
  assert.match(ctx, /\/aac-skills:<skill> form does not resolve/,
    `additionalContext missing the non-resolving-spelling flag:\n${ctx}`);
  // The clause references issue 242 so the coupling to the decision doc is visible.
  assert.match(ctx, /issue 242/, `additionalContext missing the issue-242 back-reference:\n${ctx}`);
});

test('SessionStart additionalContext states that custom agent types do not resolve here (issue 339)', () => {
  const { result } = runHook();
  assert.equal(result.status, 0, `hook exited ${result.status}\nstderr:\n${result.stderr}`);
  const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  // The bootstrap cannot register a dotfiles agent for the session that runs it: the agent
  // registry is read before SessionStart hooks (experiment in docs/tickets/339-decision.md).
  // A script that pins one fails with "Agent type '<name>' not found", an error that names the
  // type and not the cause - so the line has to name the cause.
  assert.match(ctx, /no custom agent types here/,
    `additionalContext missing the agent-type clause:\n${ctx}`);
  assert.match(ctx, /agent registry is read before this hook runs/,
    `additionalContext missing the cause of the agent-type limitation:\n${ctx}`);
  assert.match(ctx, /issue 339/, `additionalContext missing the issue-339 back-reference:\n${ctx}`);
});

test('SessionStart additionalContext stays under the 2 KB platform cap (probe #175)', () => {
  const { result } = runHook();
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  const ctx = payload.hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= 2000,
    `additionalContext is ${ctx.length} bytes; the platform cap is 2000. The invoke-as clause added for issue 242 must not push the sentence past it. Full sentence:\n${ctx}`);
});

/*
 * Marker keys must have a reader (issue 279).
 *
 * The hook writes a marker at ~/.claude/hook-state/aac-bootstrap/state.json — one dict on the
 * success path, one on the named-failure path (issue 483). Attempt 1 on issue 242 added a
 * `slash_form` key to that dict with a comment claiming session-check read it; nothing under
 * aac-skills/ did. That field never shipped, but nothing stopped the next key arriving the
 * same way. So: enumerate the keys out of the hook source and require each to be read somewhere
 * under aac-skills/ or tools/ — or by the hook itself, which reads its own `skills_hash` back
 * to decide whether to recopy the payload — or to be declared diagnostic-only below.
 *
 * The reader scan is deliberately generous: any read spelling of the name anywhere in those trees
 * counts. The smoke it looks for is a key *nothing* reads, and a generous scan keeps the check
 * from arguing about which module ought to own a field.
 */

// Keys written for a human opening the marker file, with no programmatic reader. A key belongs
// here only when that is the deliberate choice; the reason is the point of the entry.
const DIAGNOSTIC_ONLY_MARKER_KEYS = {
  skills_count: 'redundant with skills[]; kept so a glance at the file gives the count',
  hooks_events: 'which settings.json hook events the merge touched — for a human debugging governance hooks',
  dotfiles_source: 'provenance: which clone the payload came from',
  installed_at: 'provenance: when the payload landed',
  copied_this_run: 'how many skill dirs step 3 copied; the same-named assertion in tools/caveman-bootstrap-hook.test.js is over the caveman marker, not this one',
  dotfiles_repo: 'failure-path provenance: which repo the failed clone aimed at',
  dotfiles_ref: 'failure-path provenance: which ref the failed clone aimed at',
};

/** Every key the hook writes into the marker, read out of the hook source. */
function markerKeysFromHookSource(source) {
  const keys = new Set();
  // Both marker writes are `json.dump({ ... }, f, indent=2)` over a dict literal. The user-settings
  // write is `json.dump(settings, f, ...)` — no literal, so it contributes no keys.
  for (const block of source.matchAll(/json\.dump\(\{([\s\S]*?)\n\s*\}, f/g)) {
    for (const key of block[1].matchAll(/^\s*'([a-z0-9_]+)':/gm)) keys.add(key[1]);
  }
  return [...keys].sort();
}

/** Files that could read the marker: the skills payload, the repo tools, and the hook itself. */
function readerSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(js|mjs|sh|py)$/.test(entry.name) && p !== __filename) files.push(p);
    }
  };
  walk(path.join(REPO_ROOT, 'aac-skills'));
  walk(path.join(REPO_ROOT, 'tools'));
  files.push(HOOK);
  // This file is excluded above: it names every key, so counting it would make the check vacuous.
  return files.map((p) => [path.relative(REPO_ROOT, p), fs.readFileSync(p, 'utf8')]);
}

/** Keys with no read spelling (`.key`, `['key']`, `.get('key')`) in any reader source. */
function markerKeysWithoutReader(keys, sources) {
  return keys.filter((key) => {
    const read = new RegExp(`\\.${key}\\b|\\[['"]${key}['"]\\]|\\.get\\(['"]${key}['"]`);
    return !sources.some(([, text]) => read.test(text));
  });
}

test('every aac-bootstrap marker key has a reader under aac-skills/ or tools/ (issue 279)', () => {
  const keys = markerKeysFromHookSource(fs.readFileSync(HOOK, 'utf8'));
  // Guard the extractor: if a refactor moves the marker writes out of a `json.dump({...}, f)`
  // literal, this check must go red rather than quietly scan an empty key set.
  for (const known of ['payload_version', 'skills', 'failed', 'stage']) {
    assert.ok(keys.includes(known),
      `marker-key extraction missed '${known}' — the hook's marker writes no longer look like json.dump({...}, f, ...), so this check is scanning nothing. Keys found: ${keys.join(', ') || '(none)'}`);
  }
  const unread = markerKeysWithoutReader(keys, readerSources())
    .filter((key) => !(key in DIAGNOSTIC_ONLY_MARKER_KEYS));
  assert.deepEqual(unread, [],
    `marker key(s) ${unread.map((k) => `'${k}'`).join(', ')} are written by .claude/hooks/session-start.sh and read by nothing under aac-skills/ or tools/ (issue 279). Either add the reader, or add the key to DIAGNOSTIC_ONLY_MARKER_KEYS in this file with the reason it is written for a human only.`);
});

test('a marker key nothing reads fails the check (issue 279 fault injection)', () => {
  // The shape issue 242 attempt 1 put up for review: a new key, a comment claiming a reader,
  // no reader. A check nobody has seen fail is not known to work.
  const faulted = fs.readFileSync(HOOK, 'utf8').replace(
    "        'payload_version': version,",
    "        'payload_version': version,\n        'slash_form': 'bare',  # session-check reads this");
  const keys = markerKeysFromHookSource(faulted);
  assert.ok(keys.includes('slash_form'), 'fault injection did not land inside a marker dict');
  const unread = markerKeysWithoutReader(keys, readerSources())
    .filter((key) => !(key in DIAGNOSTIC_ONLY_MARKER_KEYS));
  assert.deepEqual(unread, ['slash_form'],
    `the unread-key check did not flag the injected key; it reported ${JSON.stringify(unread)}`);
});
