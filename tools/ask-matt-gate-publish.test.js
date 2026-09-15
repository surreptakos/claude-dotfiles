#!/usr/bin/env node
/**
 * node --test tools/ask-matt-gate-publish.test.js
 *
 * Issue 165: the ask-matt gate refused `gh issue create` under a `wayfinder` route, which by
 * design publishes a map and a ticket set. Pin the widened TICKET_FLOWS so a future edit that
 * silently drops wayfinder (or diagnosing-bugs / implement, the other publishing routes owner
 * named alongside it) is caught here. Also pin that the denial message enumerates the real set,
 * so a session declaring the wrong route sees where to move.
 *
 * The tests drive `codex/hooks/ask_matt_gate.py` in `claude-pre-tool` mode with a synthetic
 * Bash event and read the JSON decision. Pure end-to-end against the gate — no unit-level
 * imports — so the wiring the shell actually hits is what gets covered.
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
  // `py -3` on Windows, `python3` elsewhere.
  return process.platform === 'win32' ? ['py', ['-3', GATE]] : ['python3', [GATE]];
}

function runGate(mode, event, { stateDir, extraArgs = [] } = {}) {
  const [bin, base] = pyCmd();
  const args = [...base, mode, ...extraArgs];
  const res = spawnSync(bin, args, {
    input: JSON.stringify(event),
    encoding: 'utf-8',
    env: { ...process.env, ASK_MATT_GATE_STATE_DIR: stateDir },
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

function scratchStateDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ask-matt-gate-${tag}-`));
  return dir;
}

function writeSessionState(stateDir, sessionId, state) {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
  const p = path.join(stateDir, `claude--${safe}.json`);
  fs.writeFileSync(p, JSON.stringify(state), 'utf-8');
}

const ISSUE_CREATE_CMD = 'gh issue create -t "wayfinder ticket" -b "body"';

// The gate's claude-pre-tool path reads flow state keyed by (namespace, session_id). The prompt
// hook writes that record on every user turn; the tests fake it directly.
function makeEvent(sessionId, command) {
  return {
    session_id: sessionId,
    transcript_path: '',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

test('wayfinder is in TICKET_FLOWS: gh issue create passes on the first publish', () => {
  const stateDir = scratchStateDir('wayfinder-first');
  const sid = 'sess-wayfinder-1';
  writeSessionState(stateDir, sid, { nonce: 'n', flow: 'wayfinder', yes: true, caveman: 'ultra' });
  const { stdout, status } = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.strictEqual(status, 0, `gate exited non-zero: ${stdout}`);
  const decision = JSON.parse(stdout);
  const reason = decision?.hookSpecificOutput?.permissionDecisionReason
    || decision?.permissionDecisionReason
    || decision?.reason
    || '';
  assert.doesNotMatch(reason, /Publishing an issue under route/i,
    `wayfinder route was denied: ${reason}`);
  // A valid pass under wayfinder returns `{}` (no permissionDecision). If the state and yes/caveman
  // clauses pass, the gate accepts silently — deny would carry hookSpecificOutput.permissionDecision.
  assert.notStrictEqual(decision?.hookSpecificOutput?.permissionDecision, 'deny',
    `wayfinder route produced a deny: ${stdout}`);
});

test('denial message enumerates the real publishing routes when the declared flow does not publish', () => {
  const stateDir = scratchStateDir('wrong-route');
  const sid = 'sess-wrong-route';
  // `research` is an ALLOWED_FLOW that does not publish issues by design.
  writeSessionState(stateDir, sid, { nonce: 'n', flow: 'research', yes: true, caveman: 'ultra' });
  const { stdout, stderr, status } = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.strictEqual(status, 0, `gate exited non-zero: status=${status} err=${stderr}`);
  assert.ok(stdout.trim().length > 0, `empty stdout; stderr=${stderr}`);
  const decision = JSON.parse(stdout);
  const reason = decision?.hookSpecificOutput?.permissionDecisionReason
    || decision?.permissionDecisionReason
    || decision?.reason
    || '';
  assert.match(reason, /Publishing an issue under route/i,
    `expected denial, got stdout=${stdout} reason=${reason}`);
  for (const flow of ['wayfinder', 'to-tickets', 'to-spec', 'triage', 'diagnosing-bugs', 'implement']) {
    assert.match(reason, new RegExp(`\\b${flow}\\b`),
      `denial message missing ${flow} in its route list: ${reason}`);
  }
});
