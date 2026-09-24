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
 * Issue 200: session-end (the closing ticket sweep) and project-harness (the initial ticket set
 * on a new project) are also publishing routes. Both must be accepted by ALLOWED_FLOWS and
 * TICKET_FLOWS, and both must appear in each hint string so a session finds them by reading the
 * prompt. The tests below fail if either route is missing from either set.
 *
 * The tests drive `profile/codex/hooks/ask_matt_gate.py` in `claude-pre-tool` mode with a synthetic
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
const GATE = path.join(REPO, 'profile', 'codex', 'hooks', 'ask_matt_gate.py');

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
  for (const flow of [
    'wayfinder', 'to-tickets', 'to-spec', 'triage', 'diagnosing-bugs', 'implement',
    'session-end', 'project-harness',
  ]) {
    assert.match(reason, new RegExp(`\\b${flow}\\b`),
      `denial message missing ${flow} in its route list: ${reason}`);
  }
});

// Issue 200: session-end and project-harness are publishing routes in their own right. If either
// is missing from ALLOWED_FLOWS the gate would refuse the declaration itself; if either is missing
// from TICKET_FLOWS the gate would deny the `gh issue create` these routes are meant to produce.
// Two tests cover the two sets independently so a drop from either surfaces here.
for (const flow of ['session-end', 'project-harness']) {
  test(`${flow} is in ALLOWED_FLOWS: declare-claude accepts it`, () => {
    const stateDir = scratchStateDir(`${flow}-declare`);
    const sid = `sess-${flow}-declare`;
    const nonce = 'test-nonce';
    // declare-claude requires a pre-existing state with a matching nonce (written by claude-prompt).
    writeSessionState(stateDir, sid, { nonce, flow: null, yes: true, caveman: 'ultra' });
    const [bin, base] = pyCmd();
    const args = [...base, 'declare-claude', sid, nonce, flow];
    const res = spawnSync(bin, args, {
      encoding: 'utf-8',
      env: { ...process.env, ASK_MATT_GATE_STATE_DIR: stateDir },
    });
    assert.strictEqual(res.status, 0,
      `declare-claude exited non-zero for ${flow}: out=${res.stdout} err=${res.stderr}`);
    assert.doesNotMatch(res.stderr, /route rejected/i,
      `declare-claude rejected ${flow}: ${res.stderr}`);
  });

  test(`${flow} is in ALLOWED_FLOWS and TICKET_FLOWS: gh issue create passes on the first publish`, () => {
    const stateDir = scratchStateDir(`${flow}-first`);
    const sid = `sess-${flow}-1`;
    writeSessionState(stateDir, sid, { nonce: 'n', flow, yes: true, caveman: 'ultra' });
    const { stdout, stderr, status } = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
    assert.strictEqual(status, 0, `gate exited non-zero: status=${status} out=${stdout} err=${stderr}`);
    const decision = stdout.trim() ? JSON.parse(stdout) : {};
    const reason = decision?.hookSpecificOutput?.permissionDecisionReason
      || decision?.permissionDecisionReason
      || decision?.reason
      || '';
    assert.doesNotMatch(reason, /Publishing an issue under route/i,
      `${flow} route was denied at publish: ${reason}`);
    assert.doesNotMatch(reason, /is not a declarable engineering route/i,
      `${flow} route was refused at declaration: ${reason}`);
    assert.notStrictEqual(decision?.hookSpecificOutput?.permissionDecision, 'deny',
      `${flow} route produced a deny: ${stdout}`);
  });
}

// Issue 200: both prompt-mode hint strings must name session-end and project-harness so a session
// finds them by reading the prompt. A test in `tools/` fails when either route is missing.
test('prompt-mode hint (codex) names session-end and project-harness', () => {
  const event = { session_id: 'sess-hint-codex', turn_id: 'turn-hint-codex', prompt: 'hi' };
  const { stdout, stderr, status } = runGate('prompt', event, { stateDir: scratchStateDir('hint-codex') });
  assert.strictEqual(status, 0, `gate exited non-zero: status=${status} err=${stderr}`);
  const decision = JSON.parse(stdout);
  const context = decision?.hookSpecificOutput?.additionalContext || '';
  assert.match(context, /\bsession-end\b/, `codex hint missing session-end: ${context}`);
  assert.match(context, /\bproject-harness\b/, `codex hint missing project-harness: ${context}`);
});

test('prompt-mode hint (claude) names session-end and project-harness', () => {
  const event = { session_id: 'sess-hint-claude', prompt: 'hi' };
  const { stdout, stderr, status } = runGate('claude-prompt', event, { stateDir: scratchStateDir('hint-claude') });
  assert.strictEqual(status, 0, `gate exited non-zero: status=${status} err=${stderr}`);
  const decision = JSON.parse(stdout);
  const context = decision?.hookSpecificOutput?.additionalContext || '';
  assert.match(context, /\bsession-end\b/, `claude hint missing session-end: ${context}`);
  assert.match(context, /\bproject-harness\b/, `claude hint missing project-harness: ${context}`);
});

// Issue 716: /session-end files its ticket batch without an approval round (#704). The gate lets a
// second `gh issue create` through when this turn's declared flow is session-end or the prompt
// invoked /session-end, and still asks for the round under any other publishing route.
function writePublishCount(stateDir, sessionId, count) {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
  fs.writeFileSync(path.join(stateDir, `${safe}--published.json`),
    JSON.stringify({ issues_created: count }), 'utf-8');
}

function permissionOf(stdout) {
  return (stdout.trim() ? JSON.parse(stdout) : {})?.hookSpecificOutput?.permissionDecision;
}

test('session-end: the second gh issue create passes with no approval token', () => {
  const stateDir = scratchStateDir('session-end-batch');
  const sid = 'sess-session-end-batch';
  writeSessionState(stateDir, sid, { nonce: 'n', flow: 'session-end', yes: true, caveman: 'ultra' });
  writePublishCount(stateDir, sid, 2);
  const { stdout, status } = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.strictEqual(status, 0, `gate exited non-zero: ${stdout}`);
  assert.notStrictEqual(permissionOf(stdout), 'deny', `session-end batch was denied: ${stdout}`);
});

test('a prompt invoking /session-end lets the batch through before and after the declaration', () => {
  const stateDir = scratchStateDir('session-end-prompt');
  const sid = 'sess-session-end-prompt';
  // Previous turn declared to-tickets; this turn's prompt is `publish /session-end`.
  writeSessionState(stateDir, sid, { nonce: 'old', flow: 'to-tickets', yes: true, caveman: 'ultra' });
  runGate('claude-prompt', { session_id: sid, prompt: 'publish /session-end' }, { stateDir });
  writePublishCount(stateDir, sid, 1);
  let res = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.notStrictEqual(permissionOf(res.stdout), 'deny', `denied before declaring: ${res.stdout}`);
  // Declaring the route rewrites the turn state; the prompt's finding must survive it.
  const safe = sid.replace(/[^A-Za-z0-9_.-]/g, '_');
  const { nonce } = JSON.parse(fs.readFileSync(path.join(stateDir, `claude--${safe}.json`), 'utf-8'));
  const [bin, base] = pyCmd();
  const declared = spawnSync(bin, [...base, 'declare-claude', sid, nonce, 'to-tickets'], {
    encoding: 'utf-8', env: { ...process.env, ASK_MATT_GATE_STATE_DIR: stateDir },
  });
  assert.strictEqual(declared.status, 0, `declare-claude failed: ${declared.stderr}`);
  res = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.notStrictEqual(permissionOf(res.stdout), 'deny', `denied after declaring: ${res.stdout}`);
});

// Issue 734: the plugin serves the skill once pull stops writing ~/.claude/skills, so the
// namespaced spelling is the same invocation.
test('a prompt invoking /aac-skills:session-end lets the batch through', () => {
  const stateDir = scratchStateDir('session-end-namespaced');
  const sid = 'sess-session-end-namespaced';
  writeSessionState(stateDir, sid, { nonce: 'old', flow: 'to-tickets', yes: true, caveman: 'ultra' });
  runGate('claude-prompt', { session_id: sid, prompt: '/aac-skills:session-end' }, { stateDir });
  writePublishCount(stateDir, sid, 1);
  const { stdout } = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.notStrictEqual(permissionOf(stdout), 'deny', `namespaced /session-end was denied: ${stdout}`);
});

test('outside session-end the second gh issue create still asks for approval', () => {
  const stateDir = scratchStateDir('to-tickets-batch');
  const sid = 'sess-to-tickets-batch';
  // A session-end from an earlier turn (last_flow) does not carry the exemption into this one.
  writeSessionState(stateDir, sid,
    { nonce: 'n', flow: 'to-tickets', last_flow: 'session-end', yes: true, caveman: 'ultra' });
  writePublishCount(stateDir, sid, 1);
  const { stdout } = runGate('claude-pre-tool', makeEvent(sid, ISSUE_CREATE_CMD), { stateDir });
  assert.strictEqual(permissionOf(stdout), 'deny', `to-tickets batch was not gated: ${stdout}`);
  assert.match(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason, /ticket SET/);
});
