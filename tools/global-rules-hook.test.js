#!/usr/bin/env node
/**
 * node --test tools/global-rules-hook.test.js
 *
 * Issue 209 — the global rules text reaches a cloud session from the plugin payload.
 * Issue 533 — it arrives in FULL at SessionStart (and again after every compaction, because a
 * compact is a SessionStart source), and every PROMPT carries a short generated digest instead of
 * the whole ~12 KB rulebook. What is pinned here, one per stated behaviour:
 *
 *   - the payload's rules/global-rules.md is the verbatim `### Four standing disciplines` section
 *     of profile/claude/CLAUDE.md (the mirror of the PC's ~/.claude/CLAUDE.md) — one source, no hand copy
 *   - `start k` emits a SessionStart part; the parts concatenate back to that file byte for byte
 *   - each part's additionalContext stays under 10,000 bytes, the pass-through cap measured in a
 *     cloud container on 2026-09-16 (10,240 bytes came back as a 2KB preview of a persisted file)
 *   - hooks.json wires one SessionStart entry per part, with NO matcher, so every source (startup,
 *     resume, clear, compact) gets the text — and exactly ONE UserPromptSubmit entry, the digest
 *   - the digest stays under 1,500 bytes and carries the five things issue 533 names
 *   - a session whose global CLAUDE.md already carries the text gets nothing, in either mode
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const REPO = path.resolve(__dirname, '..');
const PAYLOAD = path.join(REPO, 'marketplace', 'aac-skills');
const RULES = path.join(PAYLOAD, 'rules', 'global-rules.md');
const DIGEST = path.join(PAYLOAD, 'rules', 'global-rules-digest.md');
const SCRIPT = path.join(PAYLOAD, 'hooks', 'scripts', 'global-rules.js');
const MANIFEST = path.join(PAYLOAD, 'hooks', 'hooks.json');
// Measured cap (see the header): whole at 10,000 bytes, persisted with a 2KB preview at 10,240.
const CAP_BYTES = 10000;
// Issue 533: what a prompt may cost. The rulebook rides SessionStart, not every turn.
const DIGEST_CAP_BYTES = 1500;

function runHook(args, env) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args.map(String)], {
    input: '{"source":"startup"}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PAYLOAD, GLOBAL_RULES_HOOK_FORCE: '1', ...env },
  });
  assert.equal(res.status, 0, `hook ${args.join(' ')} exited ${res.status}: ${res.stderr}`);
  return res.stdout;
}

function contextFor(args, expectedEvent, env) {
  const out = runHook(args, env);
  if (out === '') return null;
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, expectedEvent);
  return parsed.hookSpecificOutput.additionalContext;
}

const startContext = (k, env) => contextFor(['start', k], 'SessionStart', env);
const digestContext = (env) => contextFor(['digest'], 'UserPromptSubmit', env);

function entries(event) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const found = [];
  for (const group of manifest.hooks[event] || []) {
    for (const hook of group.hooks || []) {
      if (hook.command.includes('hooks/scripts/global-rules.js')) {
        found.push({ command: hook.command, matcher: group.matcher });
      }
    }
  }
  return found;
}

test('the payload rules file is the whole CLAUDE.md verbatim, not a hand copy', () => {
  // The payload used to carry the standing-disciplines section alone, so a container never saw
  // the response-prefix directive, the environment-claims rules, memory governance or the Google
  // access pointer — a cloud session ran a different rulebook from a desktop one.
  const md = fs.readFileSync(path.join(REPO, 'profile', 'claude', 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');
  const whole = `${md.trimEnd()}\n`;
  // The payload carries the owner's real home where the mirror holds __USERHOME__ (the packager's
  // --home substitution); re-tokenize so the comparison does not depend on whose home built it.
  const shipped = fs.readFileSync(RULES, 'utf8').replace(/[A-Za-z]:\\Users\\[^\\"]+/g, '__USERHOME__');
  assert.equal(shipped, whole,
    'marketplace/aac-skills/rules/global-rules.md drifted from profile/claude/CLAUDE.md — rerun the packager');
  assert.ok(shipped.includes('### Four standing disciplines'),
    'the disciplines heading is the contract the packager and the digest marks depend on');
});

test('the SessionStart parts concatenate back to the whole rules file', () => {
  const n = entries('SessionStart').length;
  assert.ok(n >= 1, 'hooks.json wires no SessionStart global-rules parts');
  let joined = '';
  for (let i = 1; i <= n; i += 1) {
    const ctx = startContext(i);
    joined += ctx.slice(ctx.indexOf('\n') + 1); // drop the "GLOBAL RULES (part i of n...)" header
  }
  assert.equal(joined, fs.readFileSync(RULES, 'utf8'),
    'the parts do not reassemble the rules file: a session would start on an incomplete rulebook');
  assert.equal(startContext(n + 1), null, 'a part past the last one must emit nothing');
});

test('every SessionStart part stays under the measured pass-through cap', () => {
  for (let i = 1; i <= entries('SessionStart').length; i += 1) {
    const bytes = Buffer.byteLength(startContext(i), 'utf8');
    assert.ok(bytes < CAP_BYTES,
      `part ${i} is ${bytes} bytes; over ${CAP_BYTES} the host persists it and shows a 2KB preview`);
  }
});

test('hooks.json wires the full text at SessionStart, unmatched, and one digest per prompt', () => {
  assert.ok(fs.existsSync(SCRIPT), 'global-rules.js is not in the payload');
  const start = entries('SessionStart');
  const total = Number(/part 1 of (\d+)/.exec(startContext(1))[1]);
  assert.equal(start.length, total,
    `the script splits the rules into ${total} parts but hooks.json wires ${start.length} entries`);
  start.forEach((e, i) => {
    assert.match(e.command, new RegExp(`global-rules\\.js" start ${i + 1}$`));
    // No matcher: SessionStart fires on startup, resume, clear AND compact, and a matcher here
    // would silently drop one of them — a compacted session back on a summary of the rules.
    assert.equal(e.matcher, undefined, 'the SessionStart rules group must match every source');
  });
  const prompt = entries('UserPromptSubmit');
  assert.equal(prompt.length, 1,
    `UserPromptSubmit carries ${prompt.length} global-rules entries; issue 533 allows exactly one`);
  assert.match(prompt[0].command, /global-rules\.js" digest$/);
});

test('the per-prompt digest is small and carries what issue 533 names', () => {
  assert.ok(fs.existsSync(DIGEST), 'the packager did not write rules/global-rules-digest.md');
  const ctx = digestContext();
  const bytes = Buffer.byteLength(ctx, 'utf8');
  assert.ok(bytes < DIGEST_CAP_BYTES,
    `the digest is ${bytes} bytes; a prompt may carry at most ${DIGEST_CAP_BYTES}`);
  for (const required of [
    '**Ultra:** minimum words',                      // caveman level
    '**Never drop:**',                               // the never-drop list
    '**Lead with the next action.**',                // ADHD reply shape (open)
    'No preamble, no recap, no closing pleasantries.', // ADHD reply shape (close)
    '`/ask-matt` is user-invocable only',            // the ask-matt gate sentence
    'Deliver correct, safe, *verified* results',     // the yes-skill trigger sentence
    'already in this context',                       // the pointer at the full rules
  ]) {
    assert.ok(ctx.includes(required), `the digest dropped: ${required}`);
  }
  // The pointer resolves to a file the model can open, not to a token or a ${...} it cannot expand.
  const pointed = /from (\S+global-rules\.md)/.exec(ctx);
  assert.ok(pointed && fs.existsSync(pointed[1]), `the digest points at no real file: ${ctx.slice(0, 220)}`);
});

test('a session whose global CLAUDE.md already carries the rules gets no second copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-rules-'));
  try {
    const carried = { CLAUDE_CONFIG_DIR: dir, GLOBAL_RULES_HOOK_FORCE: '0' };
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), fs.readFileSync(RULES));
    assert.equal(runHook(['start', 1], carried), '',
      'the hook injected the rules although the session already has them (doubled rules text)');
    assert.equal(runHook(['digest'], carried), '',
      'the digest repeated rules the session already carries in full');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# a global memory without the rules\n');
    assert.notEqual(runHook(['start', 1], carried), '',
      'the hook stayed silent where nothing else carries the rules');
    assert.notEqual(runHook(['digest'], carried), '',
      'the digest stayed silent where nothing else carries the rules');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
