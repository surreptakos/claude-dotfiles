#!/usr/bin/env node
/**
 * node --test tools/ask-matt-gate-adhd.test.js
 *
 * Issue 177: `/i-have-adhd` is Dan's standing communication rule, but the ask-matt gate named only
 * YES and CAVEMAN in its per-turn hint and checked neither of the ADHD rules in the pre-send lint.
 * These tests pin the three halves of the fix:
 *
 *   1. Both prompt handlers (`prompt` for Codex, `claude-prompt` for Claude Code) carry an
 *      `I-HAVE-ADHD: ENFORCED` clause, so a session reads the rule every turn.
 *   2. `lint` fails the shapes the skill forbids — a context opener, three-plus unnumbered action
 *      bullets, a list past five, a missing next action, a preamble opener, a pleasantry closer —
 *      and passes a reply shaped per the skill. One failing and one passing draft per check.
 *   3. The flag file `~/.claude/.adhd-off` switches the ADHD checks off and leaves caveman alone.
 *
 * Every case drives `codex/hooks/ask_matt_gate.py` end to end and reads its real exit code, the
 * same style as ask-matt-gate-publish.test.js. GOVERNANCE_CLAUDE_HOME points at a scratch home so
 * the machine's own caveman and ADHD flags never decide a verdict.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..');
const GATE = path.join(REPO, 'codex', 'hooks', 'ask_matt_gate.py');

function pyCmd() {
  return process.platform === 'win32' ? ['py', ['-3', GATE]] : ['python3', [GATE]];
}

function scratchHome(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ask-matt-adhd-${tag}-`));
  const home = path.join(root, '.claude');
  fs.mkdirSync(home);
  return { root, home };
}

/** Run the pre-send lint over `text`. Returns the real exit code plus stdout. */
function lint(text, { home, root } = {}) {
  const scratch = home ? { home, root } : scratchHome('lint');
  const draft = path.join(scratch.root, 'draft.txt');
  fs.writeFileSync(draft, text, 'utf-8');
  const [bin, base] = pyCmd();
  const res = spawnSync(bin, [...base, 'lint', draft], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      GOVERNANCE_CLAUDE_HOME: scratch.home,
      ASK_MATT_GATE_STATE_DIR: path.join(scratch.root, 'state'),
    },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function hint(mode, event, home) {
  const [bin, base] = pyCmd();
  const res = spawnSync(bin, [...base, mode], {
    input: JSON.stringify(event),
    encoding: 'utf-8',
    env: {
      ...process.env,
      GOVERNANCE_CLAUDE_HOME: home.home,
      ASK_MATT_GATE_STATE_DIR: path.join(home.root, 'state'),
    },
  });
  assert.strictEqual(res.status, 0, `gate exited non-zero: ${res.stderr}`);
  return JSON.parse(res.stdout)?.hookSpecificOutput?.additionalContext || '';
}

// A reply shaped per the skill: action first, state restated, one next action last.
const SHAPED = [
  'Run the restore test now: it is the only end-to-end check of the pull half.',
  '',
  'Step 2 of 3 done: whitelist entry added, assertion still missing.',
  '',
  'Next: add the matching check to the restore suite (2 minutes).',
  '',
].join('\n');

test('both prompt handlers emit the I-HAVE-ADHD clause', () => {
  const home = scratchHome('hint');
  const codex = hint('prompt', { session_id: 's-codex', turn_id: 't-codex', prompt: 'hi' }, home);
  const claude = hint('claude-prompt', { session_id: 's-claude', prompt: 'hi' }, home);
  for (const [name, context] of [['codex', codex], ['claude', claude]]) {
    assert.match(context, /I-HAVE-ADHD: ENFORCED/, `${name} hint missing the ADHD clause: ${context}`);
    assert.match(context, /Lead with the next action/, `${name} hint missing rule 1: ${context}`);
    assert.match(context, /cap lists at five/i, `${name} hint missing rule 9: ${context}`);
  }
});

test('a reply shaped per the skill passes', () => {
  const { status, stdout } = lint(SHAPED);
  assert.strictEqual(status, 0, `shaped reply was rejected: ${stdout}`);
  assert.match(stdout, /ADHD shaping pass/, `clean line does not record the ADHD pass: ${stdout}`);
});

test('opener: context fails, an action opener passes', () => {
  const bad = lint([
    'The sync script reads the whitelist in lib manifest, which is where the copy list lives.',
    'Next: open that file.',
  ].join('\n'));
  assert.strictEqual(bad.status, 1, `context opener was accepted: ${bad.stdout}`);
  assert.match(bad.stdout, /ADHD opener is context/, bad.stdout);
  assert.strictEqual(lint(SHAPED).status, 0);
});

test('preamble opener fails, a bare action opener passes', () => {
  const bad = lint('Sure, I can do that.\nNext: run the restore test.\n');
  assert.strictEqual(bad.status, 1, `preamble opener was accepted: ${bad.stdout}`);
  assert.match(bad.stdout, /ADHD preamble opener/, bad.stdout);
  assert.strictEqual(lint('Run the restore test.\nNext: read its last line.\n').status, 0);
});

test('three or more action bullets must be numbered', () => {
  const bad = lint([
    'Run three things to land this.',
    '- Run the restore test.',
    '- Open the manifest.',
    '- Commit the branch.',
    'Next: run the restore test.',
  ].join('\n'));
  assert.strictEqual(bad.status, 1, `unnumbered steps were accepted: ${bad.stdout}`);
  assert.match(bad.stdout, /ADHD unnumbered steps/, bad.stdout);

  const good = lint([
    'Run three things to land this.',
    '1. Run the restore test.',
    '2. Open the manifest.',
    '3. Commit the branch.',
    'Next: run the restore test.',
  ].join('\n'));
  assert.strictEqual(good.status, 0, `numbered steps were rejected: ${good.stdout}`);
});

test('a visible list is capped at five items', () => {
  const items = (n) => Array.from({ length: n }, (_, i) => `- item ${i + 1}`).join('\n');
  const bad = lint(`Read the six findings.\n${items(6)}\nNext: read finding one.\n`);
  assert.strictEqual(bad.status, 1, `six-item list was accepted: ${bad.stdout}`);
  assert.match(bad.stdout, /ADHD list of 6 items/, bad.stdout);

  const good = lint(`Read the five findings.\n${items(5)}\nNext: read finding one.\n`);
  assert.strictEqual(good.status, 0, `five-item list was rejected: ${good.stdout}`);
});

test('closer: no next action fails, a pleasantry fails, "Next:" passes', () => {
  const none = lint('Run the restore test.\nThe two trees disagreed after the last push.\n');
  assert.strictEqual(none.status, 1, `reply with no next action was accepted: ${none.stdout}`);
  assert.match(none.stdout, /ADHD no next action/, none.stdout);

  const pleasantry = lint('Run the restore test.\nHope this helps!\n');
  assert.strictEqual(pleasantry.status, 1, `pleasantry closer was accepted: ${pleasantry.stdout}`);
  assert.match(pleasantry.stdout, /ADHD closing pleasantry/, pleasantry.stdout);

  assert.strictEqual(lint(SHAPED).status, 0);
});

// The off switch. `~/.claude/.adhd-off` is written by the skill and only ever read here, the same
// division of labour the caveman tracker has with `.caveman-active` — so the caveman rules must
// still fire with the ADHD flag set.
test('the flag file switches the ADHD checks off and leaves caveman alone', () => {
  const home = scratchHome('flag');
  fs.writeFileSync(path.join(home.home, '.caveman-active'), 'ultra', 'utf-8');
  const draft = [
    'The sync script just reads the whitelist in lib manifest.',
    'The two trees disagreed after the last push.',
  ].join('\n');

  const on = lint(draft, home);
  assert.strictEqual(on.status, 1, `ADHD-breaking draft passed with no flag: ${on.stdout}`);
  assert.match(on.stdout, /ADHD opener is context/, on.stdout);
  assert.match(on.stdout, /ADHD no next action/, on.stdout);
  assert.match(on.stdout, /banned filler/, on.stdout);

  fs.writeFileSync(path.join(home.home, '.adhd-off'), 'off', 'utf-8');
  const off = lint(draft, home);
  assert.doesNotMatch(off.stdout, /ADHD /, `ADHD checks still ran with the flag set: ${off.stdout}`);
  assert.match(off.stdout, /banned filler/, `caveman check was collateral damage: ${off.stdout}`);
  assert.strictEqual(off.status, 1, `caveman violation stopped failing the draft: ${off.stdout}`);
});
