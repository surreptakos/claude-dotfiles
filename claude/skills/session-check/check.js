#!/usr/bin/env node
/**
 * Session start / end checks — for ANY project, not one.
 *
 *   node ~/.claude/skills/session-check/check.js
 *   node ~/.claude/skills/session-check/check.js --end
 *
 * Nothing here is hardcoded to a repo. Everything is either universal (git), auto-detected from
 * files that are already there, or read from an optional `.claude/session.json`. A project with
 * none of that still gets the git half, which is the half that catches the most.
 *
 * WHAT IT DETECTS
 *   git                     always
 *   npm test                package.json with a `scripts.test`
 *   tools/clasp-auth.js     Apps Script credential: alive AND correctly scoped
 *   .clasp.json            Apps Script project — warns that `clasp push` is a release
 *   tools/tracker-audit.js  tracker drift (exit 1 = found drift, 2 = could not audit)
 *   tools/canary.js         pre-release gate, run at --end
 *   gh + a GitHub remote    open tickets by label
 *
 * OPTIONAL `.claude/session.json`, all keys optional:
 *   {
 *     "test":        "node --test some/*.test.js",   // when it is not `npm test`
 *     "ticketLabel": "ready-for-agent",
 *     "releaseGates":[ "node tools/canary.js" ],     // run at --end
 *     "checks":      [ { "name": "...", "run": "...", "when": "end" } ],
 *     "note":        "anything to print every time"
 *   }
 *
 * READ ONLY. It fetches (which changes no files) and reports. It never commits, pushes, merges or
 * deploys — the point is to tell a human what to decide, not to decide it.
 *
 * Written 2026-08-01 after a session ran ten hours without fetching, wrote 2,300 lines, and found
 * out at push time that the remote had moved 22 commits.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const END = process.argv.includes('--end');
const REPO = findRepoRoot(process.cwd());

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', x: '\x1b[0m', d: '\x1b[2m' }
  : { r: '', y: '', g: '', b: '', x: '', d: '' };

let worst = 0;
const out = [];
const push = (icon, text, level) => { out.push(`  ${icon} ${text}`); if (level > worst) worst = level; };
const ok = (t) => push(`${C.g}ok${C.x}  `, t, 0);
const warn = (t) => push(`${C.y}!!${C.x}  `, t, 1);
const stop = (t) => push(`${C.r}STOP${C.x}`, t, 2);
const note = (t) => out.push(`      ${C.d}${t}${C.x}`);
const head = (t) => { out.push(out.length ? '' : ''); out.push(`${C.b}${t}${C.x}`); };

function findRepoRoot(from) {
  let d = from;
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return from;
}
const has = (rel) => fs.existsSync(path.join(REPO, rel));

function run(cmd, args, opts) {
  return execFileSync(cmd, args, {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    timeout: (opts && opts.timeout) || 30000, shell: !!(opts && opts.shell),
  }).trim();
}
function tryRun(cmd, args, opts) {
  try { return run(cmd, args, opts); } catch (e) { return null; }
}
/** Run a tool that signals findings with a non-zero exit, and read its output either way.
 *  Exit 1 ("found something") and exit 2 ("could not check") mean different things, and collapsing
 *  them into "failed" throws away the finding, which is the reason for running it. */
function runReadingOutput(cmd, args, opts) {
  try { return { out: run(cmd, args, opts), code: 0 }; }
  catch (e) {
    if (typeof e.status !== 'number') return { out: '', code: null };
    return { out: String(e.stdout || '') + String(e.stderr || ''), code: e.status };
  }
}

function config() {
  for (const p of ['.claude/session.json', '.session-check.json']) {
    if (!has(p)) continue;
    try { return JSON.parse(fs.readFileSync(path.join(REPO, p), 'utf8')); }
    catch (e) { warn(`${p} is not valid JSON — ignoring it (${e.message})`); }
  }
  return {};
}
const CFG = config();

/* ------------------------------------------------------------------ git ---------------------- */

function gitChecks() {
  head('Git');
  if (!has('.git')) { note('not a git repo — skipping'); return; }

  const branch = tryRun('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const gitDir = tryRun('git', ['rev-parse', '--git-dir']) || '';
  if (/[\\/]worktrees[\\/]/.test(gitDir)) {
    stop('you are in a git WORKTREE, not the main checkout');
    note('code work is fine here; releasing from it publishes THIS tree, not main');
  }

  const upstream = tryRun('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!upstream) { warn(`branch "${branch}" has no upstream — nothing to compare against`); }

  const fetched = tryRun('git', ['fetch', '--quiet'], { timeout: 20000 }) !== null;
  if (!fetched) {
    warn('could not reach the remote — ahead/behind below may be stale');
    note('fine if you are offline; re-run when connected');
  }

  const dirty = tryRun('git', ['status', '--porcelain']);
  const dirtyCount = dirty ? dirty.split('\n').length : 0;

  let behind = 0, ahead = 0;
  if (upstream) {
    const counts = tryRun('git', ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
    if (counts) { const m = counts.split(/\s+/); behind = Number(m[0]) || 0; ahead = Number(m[1]) || 0; }
  }

  if (END) {
    if (dirtyCount) { stop(`${dirtyCount} uncommitted file(s) — this work is not saved anywhere`); note('`git status --short`'); }
    else ok('working tree clean');
    if (ahead) { warn(`${ahead} commit(s) not pushed — they exist only on this machine`); note('`git push`'); }
    else if (upstream) ok('nothing unpushed');
  } else {
    if (dirtyCount) { warn(`${dirtyCount} uncommitted file(s) left from last time`); note('`git status --short` — keep, commit or discard before starting'); }
    else ok('working tree clean');
    if (behind) {
      stop(`the remote has ${behind} commit(s) you do not have — pull BEFORE writing code`);
      note(`\`git log --oneline HEAD..${upstream}\` to see what landed`);
      note('merging someone else\'s work first is easy; after you have written yours it is not');
    } else if (fetched && upstream) ok('up to date with the remote');
    if (ahead) { warn(`${ahead} commit(s) from a previous session are unpushed`); note('`git push`'); }
  }
}

/* ------------------------------------------------------------- apps script ------------------- */

function claspChecks() {
  const isClasp = has('.clasp.json') || has('gas/.clasp.json') || has('src/.clasp.json');
  if (!isClasp && !has('tools/clasp-auth.js')) return;
  head('Apps Script');

  if (has('tools/clasp-auth.js')) {
    // Checks the SCOPES on the grant, not merely whether it refreshes. That distinction is the
    // point: a bare `clasp login` authorizes clasp's own OAuth client with narrower defaults, and
    // ~/.clasprc.json is shared across projects — so the result pushes fine here while silently
    // dropping scopes another repo depends on.
    const auth = runReadingOutput('node', ['tools/clasp-auth.js', '--quiet'], { timeout: 25000 });
    if (auth.code === 0) ok('clasp credential is alive and correctly scoped');
    else if (auth.code === 2 || auth.code === null) warn('could not check the clasp credential — not a pass');
    else {
      const why = (auth.out.match(/^Reason: (.*)$/m) || [])[1] || 'dead or missing scopes';
      warn(`clasp credential needs re-authorizing — ${why}`);
      note('`node tools/clasp-auth.js` prints the exact command; do NOT shorten it to `clasp login`');
    }
  } else {
    warn('no tools/clasp-auth.js — the credential\'s SCOPES are unchecked');
    note('a token can refresh fine and still have lost scopes another project needs');
  }

  if (END) note('`clasp push` is a RELEASE — installed triggers pick it up on their next tick.');
}

/* ---------------------------------------------------------------- work ----------------------- */

function testCommand() {
  if (CFG.test) return { label: CFG.test, argv: [CFG.test], shell: true };
  if (has('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
      if (pkg.scripts && pkg.scripts.test) return { label: 'npm test', argv: ['npm', 'test', '--silent'], shell: true };
    } catch (e) { /* fall through */ }
  }
  return null;
}

function workChecks() {
  head('Work');

  const t = testCommand();
  if (!t) note('no test command detected — set "test" in .claude/session.json if there is one');
  else {
    const r = runReadingOutput(t.shell ? t.argv.join(' ') : t.argv[0], t.shell ? [] : t.argv.slice(1),
                               { timeout: 300000, shell: t.shell });
    if (r.code === 0) {
      const pass = (r.out.match(/^ℹ pass (\d+)/m) || [])[1];
      const skip = (r.out.match(/^ℹ skipped (\d+)/m) || [])[1];
      ok(`tests pass${pass ? ` (${pass}${skip && skip !== '0' ? `, ${skip} skipped` : ''})` : ''}`);
    } else { stop(`tests FAIL — \`${t.label}\``); }
  }

  if (END) {
    const gates = CFG.releaseGates || (has('tools/canary.js') ? ['node tools/canary.js'] : []);
    for (const g of gates) {
      const r = runReadingOutput(g, [], { timeout: 300000, shell: true });
      if (r.code === 0) ok(`release gate passes — \`${g}\``);
      else { stop(`release gate FAILS — \`${g}\``); note('do not release'); }
    }
  }

  if (has('tools/tracker-audit.js')) {
    const a = runReadingOutput('node', ['tools/tracker-audit.js'], { timeout: 60000 });
    if (a.code === null || a.code === 2) warn('the tracker audit could not run — that is not a pass');
    else {
      const n = Number((a.out.match(/(\d+) drift finding/) || [])[1] || 0);
      if (n > 0) { warn(`tracker audit: ${n} drift finding(s)`); note('`node tools/tracker-audit.js` — check none are yours'); }
      else ok('tracker audit clean');
    }
  }

  for (const c of (CFG.checks || [])) {
    if (c.when === 'end' && !END) continue;
    if (c.when === 'start' && END) continue;
    const r = runReadingOutput(c.run, [], { timeout: 120000, shell: true });
    if (r.code === 0) ok(c.name || c.run);
    else warn(`${c.name || c.run} — exit ${r.code}`);
  }
}

/* -------------------------------------------------------------- tickets ---------------------- */

function ticketChecks() {
  const remote = tryRun('git', ['remote', 'get-url', 'origin']);
  if (!remote || !/github\.com/i.test(remote)) return;
  if (tryRun('gh', ['--version'], { timeout: 10000 }) === null) return;

  const label = CFG.ticketLabel || 'ready-for-agent';
  const rows = tryRun('gh', ['issue', 'list', '--label', label, '--state', 'open',
                             '--json', 'number,title', '-q', '.[] | "#\\(.number)  \\(.title)"'],
                      { timeout: 25000 });
  if (rows === null) { note('(could not reach GitHub for the ticket list)'); return; }
  if (!rows) { ok(`no open tickets labelled ${label}`); return; }
  const list = rows.split('\n');
  ok(`${list.length} ticket(s) labelled ${label}`);
  list.slice(0, 8).forEach((r) => note(r));
  if (list.length > 8) note(`...and ${list.length - 8} more`);
}

/* ---------------------------------------------------------------------------------------------- */

console.log('');
console.log(`${C.b}${END ? 'Finishing' : 'Starting'} a session — ${path.basename(REPO)}${C.x}`);
gitChecks();
claspChecks();
workChecks();
ticketChecks();
if (CFG.note) { head('Note'); note(CFG.note); }
console.log(out.join('\n'));
console.log('');
if (worst === 0) console.log(`${C.g}All clear.${C.x} ${END ? 'Nothing left hanging.' : 'Pick something and go.'}`);
else if (worst === 1) console.log(`${C.y}Some things need a look${C.x} — the !! lines above.`);
else console.log(`${C.r}Deal with the STOP lines before ${END ? 'you finish' : 'writing code'}.${C.x}`);
console.log('');
process.exitCode = worst === 2 ? 1 : 0;
