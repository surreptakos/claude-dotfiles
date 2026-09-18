#!/usr/bin/env node
/**
 * node --test ~/.claude/hooks/session-gate.test.js
 *
 * The behaviour under test is the anti-double-post contract, so most of these assert that the gate
 * stays QUIET: one run per TTL, one injection per session, nothing on a compact resume. A stub
 * stands in for check.js and counts its own invocations — the real one runs a test suite, and a
 * test that waits on another test suite is a test nobody runs.
 */
'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const GATE = path.join(__dirname, 'session-gate.js');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-gate-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const stub = path.join(dir, 'check-stub.js');
  const counter = path.join(dir, 'runs.txt');
  fs.writeFileSync(stub, `
    const fs = require('node:fs');
    fs.appendFileSync(${JSON.stringify(counter)}, process.argv.join(' ') + '\\n');
    console.log(process.argv.includes('--end') ? 'STUB END REPORT' : 'STUB START REPORT');
  `, 'utf8');
  return {
    dir,
    repo,
    runs: () => (fs.existsSync(counter)
      ? fs.readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean)
      : []),
    env: {
      SESSION_GATE_STATE_DIR: path.join(dir, 'state'),
      SESSION_GATE_CHECK: stub,
    },
  };
}

function hook(box, mode, payload) {
  const r = spawnSync(process.execPath, [GATE, mode], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: Object.assign({}, process.env, box.env),
    timeout: 30000,
  });
  assert.strictEqual(r.status, 0, `gate exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

const context = (j) => (j.hookSpecificOutput ? j.hookSpecificOutput.additionalContext : null);

test('SessionStart runs the checks once and injects them once', (t) => {
  const box = sandbox();
  const first = hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'startup' });
  assert.match(context(first), /STUB START REPORT/);
  assert.strictEqual(first.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.strictEqual(box.runs().length, 1);

  // Same session, second SessionStart (a resume): no re-run, no second copy.
  const again = hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'resume' });
  assert.strictEqual(context(again), null);
  assert.strictEqual(box.runs().length, 1);
});

test('a compact resume neither runs nor injects', () => {
  const box = sandbox();
  const j = hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'compact' });
  assert.strictEqual(context(j), null);
  assert.strictEqual(box.runs().length, 0);
});

test('a new session reuses the cached report instead of re-running', () => {
  const box = sandbox();
  hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'startup' });
  const j = hook(box, 'prompt', { session_id: 's2', cwd: box.repo, prompt: 'add a field' });
  assert.match(context(j), /STUB START REPORT/);
  assert.strictEqual(box.runs().length, 1, 'cached report must not trigger a second run');
});

test('an ordinary prompt in a session that already saw the report says nothing', () => {
  const box = sandbox();
  hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'startup' });
  const j = hook(box, 'prompt', { session_id: 's1', cwd: box.repo, prompt: 'add a field' });
  assert.strictEqual(context(j), null);
});

test('wrap-up wording runs the end checks; repeats reuse them', () => {
  const box = sandbox();
  hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'startup' });
  const j = hook(box, 'prompt', { session_id: 's1', cwd: box.repo, prompt: 'ok, wrap up' });
  assert.match(context(j), /STUB END REPORT/);
  assert.match(context(j), /SESSION-END CHECKS/);
  assert.strictEqual(box.runs().filter((r) => r.includes('--end')).length, 1);

  hook(box, 'prompt', { session_id: 's1', cwd: box.repo, prompt: 'anything left?' });
  assert.strictEqual(
    box.runs().filter((r) => r.includes('--end')).length,
    1,
    'the cooldown must stop a second full run inside the same wrap-up',
  );
});

test('end-mode output tells the agent to fix the contradicted source, next to TICKET SWEEP', () => {
  // The whole point of the contradiction sweep is to correct the STALE NOTE, not to state the
  // right answer in chat and leave the note in place. If this ever weakens to just "note the
  // contradiction", the mistake re-arms for every future session — which is the bug the sweep
  // exists to close.
  const box = sandbox();
  hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'startup' });
  const j = hook(box, 'prompt', { session_id: 's1', cwd: box.repo, prompt: 'ok, wrap up' });
  const text = context(j) || '';
  assert.match(text, /CONTRADICTION SWEEP \(required/);
  assert.match(text, /memory file/);
  assert.match(text, /CLAUDE\.md/);
  assert.match(text, /Fix that source now/);
  assert.match(text, /re-arms\s+the\s+mistake/);
  assert.match(text, /source\s+corrected|no\s+contradictions\s+found/);
  // Adjacency to TICKET SWEEP — the issue is explicit that the new step belongs beside the
  // existing one, phrased the same way. If they drift apart later or one loses its "required"
  // framing, the pair stops reading as a single wrap-up gate.
  const ticketIdx = text.indexOf('TICKET SWEEP');
  const contraIdx = text.indexOf('CONTRADICTION SWEEP');
  assert.ok(ticketIdx > -1 && contraIdx > ticketIdx, 'CONTRADICTION SWEEP must follow TICKET SWEEP');
  const between = text.slice(ticketIdx, contraIdx);
  assert.ok(!/\n[A-Z][A-Z ]{4,}/.test(between.replace(/TICKET SWEEP/, '')),
    'no other ALL-CAPS heading may sit between TICKET SWEEP and CONTRADICTION SWEEP');
});

test('contradiction sweep is end-mode only — never leaks into the session-start report', () => {
  const box = sandbox();
  const j = hook(box, 'start', { session_id: 's1', cwd: box.repo, source: 'startup' });
  const text = context(j) || '';
  assert.match(text, /SESSION-START CHECKS/);
  assert.ok(!/CONTRADICTION SWEEP/.test(text),
    'the sweep belongs in the end report; a start-of-session copy is noise every turn');
  assert.ok(!/TICKET SWEEP/.test(text),
    'the TICKET SWEEP wording is also end-only — kept here as the invariant the new step mirrors');
});

test('end-intent matching is narrow enough not to fire on ordinary work', () => {
  const box = sandbox();
  const negatives = [
    'wrap the value in a call',
    'left join the tables',
    'end-to-end test the importer',
    'handoff.md is stale',
    'finish the parser function',
  ];
  negatives.forEach((prompt, i) => {
    const j = hook(box, 'prompt', { session_id: `n${i}`, cwd: box.repo, prompt });
    assert.strictEqual(
      (context(j) || '').includes('SESSION-END'),
      false,
      `false positive on: ${prompt}`,
    );
  });
  assert.strictEqual(box.runs().filter((r) => r.includes('--end')).length, 0);
});

test('SessionEnd persists a record and stays silent', () => {
  const box = sandbox();
  const j = hook(box, 'end', { session_id: 's1', cwd: box.repo, reason: 'clear' });
  assert.deepStrictEqual(j, {});
  const log = fs.readFileSync(path.join(box.env.SESSION_GATE_STATE_DIR, 'session-end.log'), 'utf8');
  assert.match(log, /reason=clear/);
});

test('a broken cwd falls back instead of reporting a broken check', () => {
  const box = sandbox();
  const j = hook(box, 'start', {
    session_id: 's1', cwd: path.join(box.dir, 'does-not-exist'), source: 'startup',
  });
  assert.match(context(j), /STUB START REPORT/);
});
