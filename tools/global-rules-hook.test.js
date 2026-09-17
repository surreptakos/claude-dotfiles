#!/usr/bin/env node
/**
 * node --test tools/global-rules-hook.test.js
 *
 * Issue 209 put the global rules text into a cloud session from the plugin payload. Issue 533
 * split the delivery in two, because ~12 KB on every prompt is most of a small context window:
 *
 *   - the FULL text rides once, at SessionStart, in the same chunked parts under the measured
 *     10,000-byte per-hook cap, from a group with no `matcher` so every source fires it —
 *     `compact` and `resume` included, which is what puts the rules back after a compaction
 *   - a DIGEST rides every prompt: exactly one UserPromptSubmit entry, under 1,500 bytes,
 *     derived by the packager from the `<!-- digest -->` lines of the same source file
 *
 * One test per behaviour the code can check, plus a headless `claude -p` probe (skipped where no
 * Claude binary answers) that shows the full text at start and the digest on prompts 1 and 2.
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
// The per-prompt budget the packager enforces (DIGEST_MAX_BYTES in build-cloud-plugin.py).
const DIGEST_MAX_BYTES = 1500;
const DIGEST_MARKER = '<!-- digest -->';

function runHook(argv, env) {
  const res = spawnSync(process.execPath, [SCRIPT, ...argv], {
    input: '{}',
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PAYLOAD, GLOBAL_RULES_HOOK_FORCE: '1', ...env },
  });
  assert.equal(res.status, 0, `hook ${argv.join(' ')} exited ${res.status}: ${res.stderr}`);
  return res.stdout;
}

function contextFor(argv, expectedEvent, env) {
  const out = runHook(argv, env);
  if (out === '') return null;
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, expectedEvent);
  return parsed.hookSpecificOutput.additionalContext;
}

function entries(event) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const found = [];
  for (const group of manifest.hooks[event] || []) {
    for (const hook of group.hooks || []) {
      if (hook.command.includes('hooks/scripts/global-rules.js')) found.push({ group, hook });
    }
  }
  return found;
}

const partCount = () => entries('SessionStart').length;

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

test('the SessionStart parts concatenate back to the whole rules file', () => {
  const n = partCount();
  assert.ok(n >= 1, 'hooks.json wires no global-rules parts');
  let joined = '';
  for (let i = 1; i <= n; i += 1) {
    const ctx = contextFor(['start', String(i)], 'SessionStart');
    joined += ctx.slice(ctx.indexOf('\n') + 1); // drop the "GLOBAL RULES (part i of n...)" header
  }
  assert.equal(joined, fs.readFileSync(RULES, 'utf8'),
    'the parts do not reassemble the rules file: a session would start on an incomplete rulebook');
  assert.equal(contextFor(['start', String(n + 1)], 'SessionStart'), null,
    'a part past the last one must emit nothing');
});

test('every SessionStart part stays under the measured pass-through cap', () => {
  for (let i = 1; i <= partCount(); i += 1) {
    const bytes = Buffer.byteLength(contextFor(['start', String(i)], 'SessionStart'), 'utf8');
    assert.ok(bytes < CAP_BYTES,
      `part ${i} is ${bytes} bytes; over ${CAP_BYTES} the host persists it and shows a 2KB preview`);
  }
});

test('hooks.json wires one SessionStart entry per part, on every session source', () => {
  assert.ok(fs.existsSync(SCRIPT), 'global-rules.js is not in the payload');
  const found = entries('SessionStart');
  const first = contextFor(['start', '1'], 'SessionStart');
  const total = Number(/part 1 of (\d+)/.exec(first)[1]);
  assert.equal(found.length, total,
    `the script splits the rules into ${total} parts but hooks.json wires ${found.length} entries`);
  for (const { group, hook } of found) {
    assert.equal(group.matcher, undefined,
      'a matcher would limit the rules to some SessionStart sources; compact and resume need them too');
    assert.match(hook.command, /global-rules\.js" start \d+$/);
  }
});

test('exactly one UserPromptSubmit entry, and it is the digest', () => {
  const found = entries('UserPromptSubmit');
  assert.equal(found.length, 1,
    `${found.length} per-prompt global-rules entries; issue 533 allows exactly one (the digest)`);
  assert.match(found[0].hook.command, /global-rules\.js" digest$/);
  const ctx = contextFor(['digest'], 'UserPromptSubmit');
  assert.equal(ctx, fs.readFileSync(DIGEST, 'utf8'));
  const bytes = Buffer.byteLength(ctx, 'utf8');
  assert.ok(bytes <= DIGEST_MAX_BYTES,
    `the per-prompt digest is ${bytes} bytes, over the ${DIGEST_MAX_BYTES}-byte budget`);
});

test('the digest is derived from the marked lines of the rules file, not hand-kept', () => {
  const rules = fs.readFileSync(RULES, 'utf8');
  const marked = rules.split('\n')
    .filter((l) => l.includes(DIGEST_MARKER))
    .map((l) => l.replace(DIGEST_MARKER, '').trim());
  assert.ok(marked.length >= 5, 'the rules section carries no <!-- digest --> markers');
  const digest = fs.readFileSync(DIGEST, 'utf8');
  for (const line of marked) {
    assert.ok(digest.includes(line),
      `the digest dropped a marked line of the rules file: ${line.slice(0, 60)}`);
  }
  // And nothing in it is invented: every body line is either a heading of the source or text
  // that appears in the source file.
  for (const line of digest.split('\n').slice(1, -2)) {
    if (!line.trim()) continue;
    const head = line.split(' ').slice(0, 6).join(' ');
    assert.ok(rules.includes(head), `digest line is not in the rules file: ${head}`);
  }
  // The four things issue 533 names by hand, so a future re-marking cannot quietly drop one.
  for (const required of [
    '**Never drop:**',            // caveman: the never-drop list
    '**Ultra:**',                 // caveman: the level
    '**Evidence over intuition.**', // yes: what trips the discipline
    'State which flow applies before doing the work.', // ask-matt gate
    '**Lead with the next action.**', // adhd reply shape
    'already in this context',    // the pointer at the full rules
  ]) {
    assert.ok(digest.includes(required), `the digest no longer carries ${required}`);
  }
});

test('a session whose global CLAUDE.md already carries the rules gets no second copy', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-rules-'));
  try {
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), fs.readFileSync(RULES));
    for (const argv of [['start', '1'], ['digest']]) {
      assert.equal(
        runHook(argv, { CLAUDE_CONFIG_DIR: dir, GLOBAL_RULES_HOOK_FORCE: '0' }), '',
        `mode ${argv[0]} fired although the session already has the rules (doubled text)`);
    }
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# a global memory without the rules\n');
    for (const argv of [['start', '1'], ['digest']]) {
      assert.notEqual(
        runHook(argv, { CLAUDE_CONFIG_DIR: dir, GLOBAL_RULES_HOOK_FORCE: '0' }), '',
        `mode ${argv[0]} stayed silent where nothing else carries the rules`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the packaged governance reminder does not repeat the digest pointer', () => {
  const reminder = path.join(PAYLOAD, 'hooks', 'scripts', 'governance-reminder.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-reminder-'));
  const env = {
    ...process.env, HOME: home, USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'), PLUGIN_HOOK_GUARD_DISABLE: '',
    CLAUDE_PLUGIN_ROOT: PAYLOAD,
  };
  try {
    const res = spawnSync(process.execPath, [reminder], { input: '{}', encoding: 'utf8', env });
    assert.equal(res.status, 0, res.stderr);
    const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('already in this context'),
      'the reminder should still say the rules are in context');
    assert.equal(ctx.includes(RULES), false,
      'the reminder repeats the path the digest already points at — one pointer per prompt');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- headless probe ---------------
// The only check that the model actually RECEIVES what the manifest wires. Skipped where no
// Claude binary answers (CI runners have none), because an environment gap is not a regression.
function claudeAnswers() {
  const res = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30000 });
  return res.status === 0;
}

test('headless probe: full text at session start, digest on prompts 1 and 2', { timeout: 600000 },
  (t) => {
    if (!claudeAnswers()) return t.skip('no claude binary on PATH');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-rules-probe-'));
    try {
      const cfg = path.join(dir, 'config');
      const cwd = path.join(dir, 'cwd');
      fs.mkdirSync(cfg);
      fs.mkdirSync(cwd);
      // The payload's own wiring, spelled with absolute paths: settings.json does not expand
      // ${CLAUDE_PLUGIN_ROOT}. A scratch config dir carries no CLAUDE.md, so nothing dedups.
      const cmd = (argv) => `node "${SCRIPT}" ${argv}`;
      fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: Array.from({ length: partCount() }, (_, i) => (
            { type: 'command', command: cmd(`start ${i + 1}`), timeout: 10 })) }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: cmd('digest'), timeout: 10 }] }],
        },
      }, null, 2));
      const prompt = 'Search your current context for these two exact strings and answer with one '
        + 'line, nothing else, in the form START=<n> DIGEST=<n>: START is 1 if the string '
        + '"GLOBAL RULES (part 1 of" appears, else 0. DIGEST is 1 if the string '
        + '"GLOBAL RULES DIGEST" appears, else 0.';
      const ask = (extra) => spawnSync('claude', ['-p', ...extra, prompt, '--output-format', 'text'],
        { cwd, encoding: 'utf8', timeout: 240000, env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } });
      const first = ask([]);
      if (first.status !== 0 || !first.stdout.trim()) {
        return t.skip(`claude -p did not answer (status ${first.status}): `
          + `${(first.stderr || '').slice(0, 200)}`);
      }
      assert.match(first.stdout, /START=1 DIGEST=1/,
        `prompt 1 should carry the full text and the digest, got: ${first.stdout.trim()}`);
      const second = ask(['--continue']);
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /DIGEST=1/,
        `prompt 2 should still carry the digest, got: ${second.stdout.trim()}`);
      return undefined;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
