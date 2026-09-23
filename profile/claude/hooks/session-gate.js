#!/usr/bin/env node
/**
 * session-gate — makes the session-start / session-end checks HOOKS, not suggestions.
 *
 * Before this existed, `/session-start` and `/session-end` were skills: the model had to decide to
 * invoke them, so the check that catches a moved remote or unpushed work ran only when someone
 * remembered. Now the harness runs them.
 *
 * MODES (each reads the hook JSON payload on stdin, except `report`):
 *   start    SessionStart   — run the start checks, inject the result as context
 *   prompt   UserPromptSubmit — inject a pending report once; run the END checks when the prompt
 *                              says the session is wrapping up
 *   end      SessionEnd     — run the end checks and persist them (SessionEnd cannot talk to the
 *                              model — the session is already over — so this is the audit trail)
 *   report   CLI            — print the cached report for the skills; `--end` / `--refresh`
 *
 * WHY NOT ENFORCE AT Stop
 * A Stop hook fires AFTER the assistant message has rendered. Blocking there cannot retract that
 * message; it only makes the model emit a second one, which is the double-posting this file exists
 * to avoid. Every gate here therefore lands at SessionStart / UserPromptSubmit — points that run
 * BEFORE the model writes — so the requirement is in context the first time, and one turn produces
 * one message.
 *
 * DOUBLE-RUN / DOUBLE-POST GUARDS
 *   - a report is reused for TTL_MS instead of re-run (startup + resume + a manual `/session-start`
 *     in the same minute produce one run, not three)
 *   - a report is injected at most once per session id (`injected` list in the meta)
 *   - the end checks will not re-run inside END_COOLDOWN_MS
 */
'use strict';

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
// Profile-aware: under CLAUDE_CONFIG_DIR (e.g. claude-personal) state and the check
// script live in that profile, not the default ~/.claude.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const STATE_DIR = process.env.SESSION_GATE_STATE_DIR
  || path.join(CONFIG_DIR, 'hook-state', 'session-gate');
// Overridable so the tests can stand a stub in front of a script that runs a whole test suite.
const CHECK = process.env.SESSION_GATE_CHECK
  || path.join(CONFIG_DIR, 'skills', 'session-check', 'check.js');
const TTL_MS = Number(process.env.SESSION_GATE_TTL_MS || 15 * 60 * 1000);
const END_COOLDOWN_MS = Number(process.env.SESSION_GATE_END_COOLDOWN_MS || 5 * 60 * 1000);
// Kept under the hook timeout in settings.json on purpose: overrunning here reports "did not
// complete", which is honest; being killed by the harness reports nothing at all.
const RUN_TIMEOUT_MS = Number(process.env.SESSION_GATE_TIMEOUT_MS || 180 * 1000);

/* ------------------------------------------------------------------ state ---------------------- */

function repoRoot(from) {
  // A cwd we cannot chdir into makes every later spawn fail with ENOENT, which reads like a broken
  // check rather than a bad path. Fall back to where we are instead.
  let start = from || process.cwd();
  try { if (!fs.statSync(start).isDirectory()) start = process.cwd(); }
  catch (e) { start = process.cwd(); }
  let d = path.resolve(start);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  // `start`, not `from`: no .git above us means "no repo", and handing back the path we already
  // rejected would spawn the checks into a directory that does not exist. Walking up to the drive
  // root would be worse — it would run a project's checks against C:\.
  return path.resolve(start);
}

// Every repo this session's directory speaks for. Usually one: the checkout we are inside.
// A cloud container with two sources opens their PARENT (/home/user holding aac-routines and
// claude-dotfiles), where the walk up finds no .git at all and every check reported "not a git
// repo" — the remote, the uncommitted work and the tickets all went unchecked. One level down
// covers that layout; a repo nested deeper is a checkout someone opened directly, and then the
// walk up wins.
function repoRoots(from) {
  const first = repoRoot(from);
  if (fs.existsSync(path.join(first, '.git'))) return [first];
  let entries = [];
  try { entries = fs.readdirSync(first, { withFileTypes: true }); } catch (e) { entries = []; }
  const children = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => path.join(first, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, '.git')))
    .sort()
    .slice(0, MAX_SIBLING_REPOS);
  return children.length ? children : [first];
}

// One report per repo, and a container with a dozen checkouts is not a session layout worth
// running a dozen test suites for.
const MAX_SIBLING_REPOS = Number(process.env.SESSION_GATE_MAX_REPOS || 3);

// With two repos in one report, each block has to say which repo it speaks for.
const titleFor = (title, repo, repos) =>
  (repos.length > 1 ? `${title} — ${path.basename(repo)}` : title);

const key = (repo, kind) =>
  `${path.basename(repo)}-${crypto.createHash('sha1').update(repo).digest('hex').slice(0, 10)}-${kind}`;
const metaPath = (repo, kind) => path.join(STATE_DIR, `${key(repo, kind)}.json`);

function readMeta(repo, kind) {
  try { return JSON.parse(fs.readFileSync(metaPath(repo, kind), 'utf8')); }
  catch (e) { return null; }
}

function writeMeta(repo, kind, meta) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const dest = metaPath(repo, kind);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmp, dest);
}

/* ------------------------------------------------------------------ running -------------------- */

/** Run check.js and keep BOTH the output and the exit code. Exit 1 means "found STOP-level
 *  problems", which is the finding, not a failure to check — collapsing the two loses the point. */
function runCheck(repo, end) {
  const args = [CHECK];
  if (end) args.push('--end');
  let out = '';
  let code = 0;
  try {
    out = execFileSync(process.execPath, args, {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: RUN_TIMEOUT_MS,
    });
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    code = typeof e.status === 'number' ? e.status : null;
    if (code === null) out += `\n(session-gate: the checks did not complete — ${e.message})`;
  }
  const meta = {
    kind: end ? 'end' : 'start',
    repo,
    ranAt: new Date().toISOString(),
    ranAtMs: Date.now(),
    exitCode: code,
    output: out.trim(),
    injected: [],
  };
  writeMeta(repo, end ? 'end' : 'start', meta);
  return meta;
}

function fresh(meta, ttl) {
  return !!meta && typeof meta.ranAtMs === 'number' && Date.now() - meta.ranAtMs < ttl;
}

/* ------------------------------------------------------------------ wording -------------------- */

const START_RULES = [
  'SESSION-START CHECKS (ran automatically — do NOT run them again, and do not paste this back):',
  '',
  'Interpret it, then act:',
  '- "STOP the remote has N commits you do not have": say so and stop. Show',
  '  `git log --oneline HEAD..<upstream>` and say whether it is bot noise or a person\'s work.',
  '- "STOP you are in a git WORKTREE": code work fine; releasing from here publishes this tree.',
  '- "!! N uncommitted files": show `git status --short`, ask keep / commit / discard.',
  '- "self-deploying Apps Script project": nothing to re-authorize; a merge to the default branch',
  '  is the release and the commit\'s `gas/deploy` status is the verdict.',
  '- "!! clasp credential needs re-authorizing" (a repo still on clasp): deploys blocked. Run the',
  '  project\'s `tools/clasp-auth.js`; never substitute a bare `clasp login` (narrower scopes, shared file).',
  '- "STOP tests FAIL": find out whether it was already broken before this session.',
  '- A line that prints a command the session can run (`claude plugin update`, `claude plugin',
  '  marketplace update`, `git push`, `git status`): run it in this turn and report the result.',
  '  Relay only what needs the owner — an app restart, a device code, a UI toggle.',
  '- Tickets: offer the actionable ones; read a chosen one WITH comments (`gh issue view N --comments`).',
  '',
  'It cannot tell you whether deployed code matches the repo.',
];

const END_RULES = [
  'SESSION-END CHECKS (ran automatically because this turn reads as wrapping up):',
  '',
  'Close the loop:',
  '- "STOP N uncommitted files": the work exists on one machine only. Show `git status --short`,',
  '  then commit it or say plainly what is being left behind and why.',
  '- "!! N commits not pushed": CI has not run, so generated files report stale numbers, and any',
  '  SHA quoted in an issue points at something nobody else can reach. Offer to push.',
  '- "STOP release gate FAILS": do not release. Name the gate and what it said.',
  '- Every "!!" line, advisories included, whichever session raised it: clear it and re-run the',
  '  check (Dan, 2026-09-23). Only a line nothing in this session can change stays, named.',
  '',
  'TICKET SWEEP (required, before the wrap-up summary): scour the WHOLE conversation for work',
  'surfaced but never captured - user deferrals ("later", "say the word"), your own offers never',
  'taken, stated known limits, undecided questions, flagged-but-unfixed findings (any system, not',
  'just this repo), follow-ups promised in comments. Each item gets exactly one outcome, stated:',
  'already tracked (name the number), not worth tracking (one line why), or NEEDS A TICKET -',
  'publish them all through /to-tickets in one batch, never ad-hoc gh issue create. /session-end',
  'is the approval: no approval round (Dan, 2026-09-23). A summary naming leftovers without ticket',
  'numbers is the failure this prevents.',
  '',
  'CONTRADICTION SWEEP (required, before the wrap-up summary): did any finding this session',
  'contradict a memory file, a CLAUDE.md line, or a doc the session read? Fix that source now -',
  'edit the memory note, the CLAUDE.md line, or the doc where the wrong claim lives. Stating the',
  'right answer only in chat leaves the stale note in place, and an uncorrected note re-arms the',
  'mistake for every future session. Each contradiction gets exactly one outcome, stated: source',
  'corrected (name the file and line), or no contradictions found.',
  '',
  'Two things the script cannot check:',
  '- Did a push close an issue that should have stayed open? `Fixes #N` closes on reaching the',
  '  default branch, including issues held open for a deploy or an owner ruling. Verify every issue',
  '  the session touched and reopen with a reason.',
  '- Are the acceptance boxes honest? A box needing a live run stays unticked.',
  '',
  'If the session ends in a release, in this order, none skippable: credential (alive AND scoped),',
  'gates, release from the main checkout only, then read back what the deployed thing reports.',
];

const block = (title, meta, rules) => [
  ...rules,
  '',
  `--- ${title} (${meta.ranAt}, exit ${meta.exitCode}) ---`,
  meta.output,
  '--- end ---',
].join('\n');

/* ------------------------------------------------------------------ end intent ----------------- */

// Deliberately narrow. A false positive costs a full test run in the middle of someone's turn.
const END_INTENT = new RegExp([
  '/session-end',
  '\\bwrap(?:ping)?\\s+(?:it\\s+)?up\\b',
  '\\bdone\\s+for\\s+(?:now|today|the\\s+day)\\b',
  '\\banything\\s+(?:else\\s+)?left\\b',
  '\\bend\\s+of\\s+(?:the\\s+)?session\\b',
  '\\bsession[-\\s]end\\b',
  '\\bfinish(?:ing)?\\s+(?:up|the\\s+session)\\b',
  '\\bhand(?:ing)?\\s+(?:this\\s+)?off\\b',
  '\\bcall\\s+it\\s+a\\s+day\\b',
  '\\bsign(?:ing)?\\s+off\\b',
].join('|'), 'i');

/* ------------------------------------------------------------------ modes ---------------------- */

function emit(context, extra) {
  if (!context) { process.stdout.write(JSON.stringify(extra || {})); return; }
  process.stdout.write(JSON.stringify(Object.assign({
    hookSpecificOutput: { hookEventName: process.env.SESSION_GATE_EVENT || 'UserPromptSubmit', additionalContext: context },
    suppressOutput: true,
  }, extra || {})));
}

function modeStart(event) {
  const source = String(event.source || '');
  // `compact` is the same session continuing — re-running the tests there would delay the resume
  // and inject a second copy of a report already in the compacted context.
  if (source === 'compact') { emit(null); return; }
  const repos = repoRoots(event.cwd);
  const sessionId = String(event.session_id || '');
  const parts = [];

  for (const repo of repos) {
    let meta = readMeta(repo, 'start');
    if (!fresh(meta, TTL_MS)) meta = runCheck(repo, false);
    if (meta.injected && meta.injected.includes(sessionId)) continue;
    meta.injected = (meta.injected || []).concat(sessionId).slice(-20);
    writeMeta(repo, 'start', meta);
    // The rules ride the first block only: they are about how to read a report, and two copies of
    // them in one context window is the padding this hook exists to avoid.
    parts.push(block(titleFor('session-check', repo, repos), meta, parts.length ? [] : START_RULES));
  }

  if (!parts.length) { emit(null); return; }
  process.env.SESSION_GATE_EVENT = 'SessionStart';
  emit(parts.join('\n\n'));
}

function modePrompt(event) {
  const repos = repoRoots(event.cwd);
  const sessionId = String(event.session_id || '');
  const prompt = String(event.prompt || '');
  const parts = [];

  // A report produced by a SessionStart that could not inject (no session id yet, or the run
  // finished after the first turn) still reaches the model — exactly once.
  for (const repo of repos) {
    const start = readMeta(repo, 'start');
    if (fresh(start, TTL_MS) && !(start.injected || []).includes(sessionId)) {
      start.injected = (start.injected || []).concat(sessionId).slice(-20);
      writeMeta(repo, 'start', start);
      parts.push(block(titleFor('session-check', repo, repos), start, parts.length ? [] : START_RULES));
    }
  }

  if (END_INTENT.test(prompt)) {
    const before = parts.length;
    for (const repo of repos) {
      let end = readMeta(repo, 'end');
      if (!fresh(end, END_COOLDOWN_MS)) end = runCheck(repo, true);
      parts.push(block(
        titleFor('session-check --end', repo, repos), end, parts.length > before ? [] : END_RULES,
      ));
    }
  }

  emit(parts.length ? parts.join('\n\n') : null);
}

function modeEnd(event) {
  // SessionEnd cannot block and cannot reach the model. Persist the result so the next session
  // opens knowing how the last one was left, and so an abrupt exit still leaves a record.
  for (const repo of repoRoots(event.cwd)) {
    const meta = runCheck(repo, true);
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.appendFileSync(
        path.join(STATE_DIR, 'session-end.log'),
        `${meta.ranAt}\t${repo}\treason=${event.reason || 'unknown'}\texit=${meta.exitCode}\t` +
          `${meta.output.split('\n').filter((l) => /STOP|!!/.test(l)).join(' | ') || 'all clear'}\n`,
        'utf8',
      );
    } catch (e) { /* an audit log must never wedge a shutdown */ }
  }
  emit(null);
}

function modeReport(argv) {
  const end = argv.includes('--end');
  const refresh = argv.includes('--refresh');
  const repos = repoRoots(process.cwd());
  const kind = end ? 'end' : 'start';
  const ttl = end ? END_COOLDOWN_MS : TTL_MS;
  let worst = 0;
  for (const repo of repos) {
    let meta = readMeta(repo, kind);
    const reused = !refresh && fresh(meta, ttl);
    if (!reused) meta = runCheck(repo, end);
    if (repos.length > 1) process.stdout.write(`\n=== ${path.basename(repo)} ===\n`);
    process.stdout.write(`${meta.output}\n`);
    process.stdout.write(reused
      ? `\n(cached from ${meta.ranAt} — the hook already ran it; \`--refresh\` re-runs)\n`
      : `\n(ran just now, ${meta.ranAt})\n`);
    if (meta.exitCode !== 0) worst = 1;
  }
  process.exitCode = worst;
}

/* ------------------------------------------------------------------ entry ---------------------- */

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(buf); } };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    setTimeout(finish, 3000).unref();
  });
}

async function main() {
  const mode = process.argv[2] || '';
  if (mode === 'report') { modeReport(process.argv.slice(3)); return; }

  let event = {};
  try { event = JSON.parse(await readStdin()) || {}; } catch (e) { event = {}; }
  if (typeof event !== 'object' || event === null) event = {};

  try {
    if (mode === 'start') return modeStart(event);
    if (mode === 'prompt') return modePrompt(event);
    if (mode === 'end') return modeEnd(event);
  } catch (e) {
    // A broken check must never stop someone working. Say so instead of failing silently.
    emit(`SESSION-GATE: the ${mode} checks could not run (${e.message}). Run \`node ${CHECK}\` by hand.`);
    return;
  }
  emit(null);
}

main();
