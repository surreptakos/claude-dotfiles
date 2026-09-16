#!/usr/bin/env node
/**
 * node --test tools/global-rules-hook.test.js
 *
 * Issue 209 — the global rules text reaches a cloud session in full on every prompt, from the
 * plugin payload. Five things are pinned here, one per acceptance criterion the code can check:
 *
 *   - the payload's rules/global-rules.md is the verbatim `### Four standing disciplines` section
 *     of claude/CLAUDE.md (the mirror of the PC's ~/.claude/CLAUDE.md) — one source, no hand copy
 *   - the parts the hook emits concatenate back to that file byte for byte — nothing is dropped
 *   - each part's additionalContext stays under 10,000 bytes, the pass-through cap measured in a
 *     cloud container on 2026-09-16 (10,240 bytes came back as a 2KB preview of a persisted file)
 *   - hooks.json wires exactly one UserPromptSubmit entry per part, naming the shipped script
 *   - a session whose global CLAUDE.md already carries the text gets nothing (no doubled rules)
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
const SCRIPT = path.join(PAYLOAD, 'hooks', 'scripts', 'global-rules.js');
const MANIFEST = path.join(PAYLOAD, 'hooks', 'hooks.json');
// Measured cap (see the header): whole at 10,000 bytes, persisted with a 2KB preview at 10,240.
const CAP_BYTES = 10000;

function runHook(part, env) {
  const res = spawnSync(process.execPath, [SCRIPT, String(part)], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PAYLOAD, GLOBAL_RULES_HOOK_FORCE: '1', ...env },
  });
  assert.equal(res.status, 0, `hook part ${part} exited ${res.status}: ${res.stderr}`);
  return res.stdout;
}

function contextFor(part, env) {
  const out = runHook(part, env);
  if (out === '') return null;
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  return parsed.hookSpecificOutput.additionalContext;
}

function partCount() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let n = 0;
  for (const group of manifest.hooks.UserPromptSubmit || []) {
    for (const hook of group.hooks || []) {
      if (hook.command.includes('hooks/scripts/global-rules.js')) n += 1;
    }
  }
  return n;
}

test('the payload rules file is the CLAUDE.md section verbatim, not a hand copy', () => {
  const md = fs.readFileSync(path.join(REPO, 'claude', 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');
  const lines = md.split(/(?<=\n)/);
  const start = lines.findIndex((l) => l.startsWith('### Four standing disciplines'));
  assert.ok(start >= 0, 'claude/CLAUDE.md lost the standing-disciplines heading');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('### ') || lines[i].startsWith('## ')) { end = i; break; }
  }
  const section = `${lines.slice(start, end).join('').trimEnd()}\n`;
  // The payload carries the owner's real home where the mirror holds __USERHOME__ (the packager's
  // --home substitution); re-tokenize so the comparison does not depend on whose home built it.
  const shipped = fs.readFileSync(RULES, 'utf8').replace(/[A-Za-z]:\\Users\\[^\\"]+/g, '__USERHOME__');
  assert.equal(shipped, section,
    'marketplace/aac-skills/rules/global-rules.md drifted from claude/CLAUDE.md — rerun the packager');
});

test('the emitted parts concatenate back to the whole rules file', () => {
  const n = partCount();
  assert.ok(n >= 1, 'hooks.json wires no global-rules parts');
  let joined = '';
  for (let i = 1; i <= n; i += 1) {
    const ctx = contextFor(i);
    joined += ctx.slice(ctx.indexOf('\n') + 1); // drop the "GLOBAL RULES (part i of n...)" header
  }
  assert.equal(joined, fs.readFileSync(RULES, 'utf8'),
    'the parts do not reassemble the rules file: a prompt would get an incomplete rulebook');
  assert.equal(contextFor(n + 1), null, 'a part past the last one must emit nothing');
});

test('every part stays under the measured UserPromptSubmit pass-through cap', () => {
  for (let i = 1; i <= partCount(); i += 1) {
    const bytes = Buffer.byteLength(contextFor(i), 'utf8');
    assert.ok(bytes < CAP_BYTES,
      `part ${i} is ${bytes} bytes; over ${CAP_BYTES} the host persists it and shows a 2KB preview`);
  }
});

test('hooks.json wires one UserPromptSubmit entry per part, naming the shipped script', () => {
  assert.ok(fs.existsSync(SCRIPT), 'global-rules.js is not in the payload');
  const first = contextFor(1);
  const total = Number(/part 1 of (\d+)/.exec(first)[1]);
  assert.equal(partCount(), total,
    `the script splits the rules into ${total} parts but hooks.json wires ${partCount()} entries`);
});

test('a session whose global CLAUDE.md already carries the rules gets no second copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-rules-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), fs.readFileSync(RULES));
    assert.equal(
      runHook(1, { CLAUDE_CONFIG_DIR: dir, GLOBAL_RULES_HOOK_FORCE: '0' }), '',
      'the hook injected the rules although the session already has them (doubled rules text)');
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# a global memory without the rules\n');
    assert.notEqual(
      runHook(1, { CLAUDE_CONFIG_DIR: dir, GLOBAL_RULES_HOOK_FORCE: '0' }), '',
      'the hook stayed silent where nothing else carries the rules');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
