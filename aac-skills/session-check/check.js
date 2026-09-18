#!/usr/bin/env node
/**
 * Session start / end checks — for ANY project, not one.
 *
 *   node "$HOME/.agents/skills/session-check/check.js"
 *   node "$HOME/.agents/skills/session-check/check.js" --end
 *
 * Nothing here is hardcoded to a repo. Everything is either universal (git), auto-detected from
 * files that are already there, or read from an optional `.claude/session.json`. A project with
 * none of that still gets the git half, which is the half that catches the most.
 *
 * WHAT IT DETECTS
 *   git                     always
 *   npm test                package.json with a `scripts.test`
 *   gas.json               Apps Script project that deploys ITSELF from GitHub (claude-dotfiles gas/):
 *                          a merge to the default branch is the release; no credential to check
 *   tools/clasp-auth.js     Apps Script credential: alive AND correctly scoped (repos still on clasp)
 *   .clasp.json            Apps Script project — warns that `clasp push` is a release
 *   .github/workflows/tracker-audit.yml
 *                           tracker drift — read off that job's latest run for the default
 *                           branch's head, never audited here (issue 473)
 *   tools/canary.js         pre-release gate, run at --end
 *   a GitHub remote         open tickets by label — via gh, or the GitHub REST API when gh is
 *                           missing (a cloud container gets gh from the bootstrap SessionStart
 *                           hook, and its egress proxy authenticates api.github.com — private
 *                           repos included — for the REST fallback when it does not)
 *   ~/.claude/accounts.json which Claude account owns this repo, versus the one the session runs
 *                           under (identity.js); in the registry's auditRepo, also which desktop
 *                           routines are enabled outside their owner. Warnings only, never STOP.
 *
 * OPTIONAL `.claude/session.json`, all keys optional:
 *   {
 *     "test":        "node --test some/*.test.js",   // when it is not `npm test`
 *     "testTimeoutMs": 300000,                       // optional per-repo test timeout
 *     "ticketLabel": "ready-for-agent",
 *     "releaseGates":[ "node tools/canary.js" ],     // run at --end
 *     "checks":      [ { "name": "...", "run": "...", "when": "end",
 *                        "host": "desktop" } ],                // only on that host; see HOST
 *     "note":        "anything to print every time",
 *     "harness":     false                            // silence the harness-version check on
 *                                                    // a deliberately unharnessed repo
 *   }
 *
 * At --end the test command is skipped on a committed, pushed head in a repo with CI: the
 * pre-commit hook ran the suite on each commit and CI runs it on the pushed head, so a third
 * run here learns nothing (and in claude-dotfiles costs a full restore-test). A dirty tree or
 * an unpushed commit still runs it — those are the cases nothing else has seen.
 *
 * READ ONLY. It fetches (which changes no files) and reports. It never commits, pushes, merges or
 * deploys — the point is to tell a human what to decide, not to decide it.
 *
 * Written 2026-08-01 after a session ran ten hours without fetching, wrote 2,300 lines, and found
 * out at push time that the remote had moved 22 commits.
 */
'use strict';

const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const END = process.argv.includes('--end');
const REPO = findRepoRoot(process.cwd());

/** A Claude Code cloud container (claude.ai/code, Cowork). Several checks mean something
 *  different there: no GraphQL through the egress proxy, no clasp credential, and the machine is a
 *  downstream copy of the skills rather than where they are authored. gh itself is present once
 *  the bootstrap SessionStart hook has run (issue 163), which is why the gh checks below probe for
 *  it rather than assuming either way. */
const IS_CLOUD = Boolean(process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  || process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE);

/** Which host this session runs on, for a configured check's optional `host` field. Some checks
 *  are desktop-only by nature — a board sweep that needs the desktop's credentials exits 2 in a
 *  container every time, and a guaranteed failure teaches people to skim past the report. A check
 *  naming a host that is not this one is skipped and SAID to be skipped, never passed. */
const HOST = IS_CLOUD ? 'cloud' : 'desktop';

const C = process.stdout.isTTY
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', b: '\x1b[1m', x: '\x1b[0m', d: '\x1b[2m' }
  : { r: '', y: '', g: '', b: '', x: '', d: '' };

let worst = 0;
const out = [];
const push = (icon, text, level) => { out.push(`  ${icon} ${text}`); if (level > worst) worst = level; };
const ok = (t) => push(`${C.g}ok${C.x}  `, t, 0);
const warn = (t) => push(`${C.y}!!${C.x}  `, t, 1);
const stop = (t) => push(`${C.r}STOP${C.x}`, t, 2);
const skipped = (t) => push(`${C.d}--${C.x}  `, t, 0);
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

/** Environment for every child this checker spawns, with NODE_TEST_CONTEXT removed.
 *  `node --test` exports that variable into the processes it spawns, and a nested `node --test`
 *  that inherits it exits 0 even when a test throws (Node 22.22.2: `node --test boom.test.js`
 *  exits 1, `NODE_TEST_CONTEXT=child-v8 node --test boom.test.js` exits 0 on the same file).
 *  check.js is itself spawned from inside node tests (check.test.js) and runs the repo's suite,
 *  so without the scrub a failing suite is reported as "tests pass" (issue 395). */
const CHILD_ENV = (() => {
  const e = Object.assign({}, process.env);
  delete e.NODE_TEST_CONTEXT;
  return e;
})();

function run(cmd, args, opts) {
  return execFileSync(cmd, args, {
    cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: CHILD_ENV,
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
    return {
      out: String(e.stdout || '') + String(e.stderr || ''),
      code: typeof e.status === 'number' ? e.status : null,
      timedOut: e.code === 'ETIMEDOUT',
    };
  }
}

function killProcessTree(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore', windowsHide: true,
      });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (e) {
    try { child.kill('SIGKILL'); } catch (ignored) { /* already exited */ }
  }
}

/** Async variant for long-running commands. Its timer kills the whole process tree before the
 * shell exits, which matters on Windows: execFileSync's timeout kills cmd.exe but can leave pytest
 * running and holding the repository open. */
function runReadingOutputAsync(cmd, args, opts) {
  return new Promise((resolve) => {
    let timedOut = false;
    let timer;
    const child = execFile(cmd, args, {
      cwd: REPO,
      encoding: 'utf8',
      env: CHILD_ENV,
      shell: !!(opts && opts.shell),
      windowsHide: true,
      detached: process.platform !== 'win32',
    }, (error, stdout, stderr) => {
      clearTimeout(timer);
      resolve({
        out: String(stdout || '') + String(stderr || ''),
        code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
        timedOut,
      });
    });
    timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, (opts && opts.timeout) || 30000);
  });
}

function configuredTimeout(key, fallback) {
  if (CFG[key] === undefined) return fallback;
  if (Number.isInteger(CFG[key]) && CFG[key] > 0) return CFG[key];
  warn(`${key} must be a positive integer — using ${fallback} ms`);
  return fallback;
}

function noteDiagnostics(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(-20)) note(line);
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

/** What gitChecks found, for workChecks' end-of-session test skip. */
const GIT = { upstream: null, dirtyCount: 0, ahead: 0 };

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
  Object.assign(GIT, { upstream, dirtyCount, ahead });

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
  // A self-deploying script (claude-dotfiles gas/: gas.json + vendored SelfDeploy.js; or the cockpit's
  // own ADR-0033 endpoint) holds its credentials itself and pulls each merge from GitHub. There is no
  // clasp token to check, and warning about one would send someone to re-mint a credential nothing uses.
  const selfDeploys = has('gas.json') || has('tools/self-deploy-call.js');
  const isClasp = has('.clasp.json') || has('gas/.clasp.json') || has('src/.clasp.json');
  if (!isClasp && !has('tools/clasp-auth.js') && !selfDeploys) return;
  head('Apps Script');

  if (selfDeploys) {
    ok('self-deploying Apps Script project — a merge to the default branch is the release; no clasp credential to check');
    if (has('gas.json')) note('`gas status owner/repo` shows the last deploy verdict; `gas run owner/repo <fn> \'[args]\'` replaces `clasp run-function` (claude-dotfiles gas/cli/gas.js)');
    if (END) note('releasing = merge to the default branch; the script picks it up within ~10 minutes and marks the commit green or red.');
    return;
  }

  if (has('tools/clasp-auth.js')) {
    // Checks the SCOPES on the grant, not merely whether it refreshes. That distinction is the
    // point: a bare `clasp login` authorizes clasp's own OAuth client with narrower defaults, and
    // ~/.clasprc.json is shared across projects — so the result pushes fine here while silently
    // dropping scopes another repo depends on.
    const auth = runReadingOutput('node', ['tools/clasp-auth.js', '--quiet'], { timeout: 25000 });
    if (auth.code === 0) ok('clasp credential is alive and correctly scoped');
    else if (auth.code === 2 || auth.code === null) {
      // A cloud container never carries ~/.clasprc.json — the credential is not provisioned
      // there, deploys stay CI or local, and warning about it every session is noise.
      if (IS_CLOUD) note('cloud container — no clasp credential is provisioned here; deploys stay CI or local');
      else warn('could not check the clasp credential — not a pass');
    } else {
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

/** In a cloud container the configured test command can name a shell that is not on PATH
 *  (Windows-only `powershell` is the case that hit us — issue 171). Splitting the command on
 *  `&&` and keeping only the halves whose first token IS on PATH is enough to run the node
 *  half; the dropped halves are named in a NOTE so the reader sees they were skipped, not
 *  passed. Returns null when nothing survives, so the caller can leave the STOP path alone.
 *
 *  This only runs in a cloud container: on a real Windows box `powershell` is present and the
 *  full command runs as configured. Pure enough to test if we ever want to. */
function cloudTestFallback(t) {
  if (!IS_CLOUD) return null;
  const halves = t.label.split(/\s*&&\s*/).map((s) => s.trim()).filter(Boolean);
  if (halves.length < 2) return null;
  const missing = [];
  const kept = [];
  for (const half of halves) {
    // A quoted path stays one bin (`"C:\Program Files\..\node.exe" -e ...`); an unquoted first
    // token is the interpreter (`powershell -File ...`, `node --test ...`). Stripping the outer
    // quotes lets tryRun spawn the binary directly rather than passing quotes into argv[0].
    const m = half.match(/^"([^"]+)"|^(\S+)/);
    const bin = m ? (m[1] || m[2]) : '';
    if (!bin) continue;
    if (tryRun(bin, ['--version'], { timeout: 5000 }) !== null) { kept.push(half); continue; }
    if (tryRun(bin, ['-Command', 'exit 0'], { timeout: 5000 }) !== null) { kept.push(half); continue; }
    missing.push({ bin, half });
  }
  if (!missing.length || !kept.length) return null;
  return { kept, missing };
}

async function workChecks() {
  head('Work');

  let t = testCommand();
  let skippedHalves = null;
  if (t) {
    // Cloud fallback for a command that names a shell the container has no binary for (issue
    // 171). `powershell` in the configured test on Windows runs `tests/restore-test.ps1`; the
    // container has no `powershell`, so the whole `&&` chain fails at "powershell: not found"
    // and STOP fires on a repo whose node tests pass. Split the command, run only the halves
    // whose interpreter IS on PATH, and note the dropped ones as covered by CI on the current
    // head — the Windows suite runs there on every push.
    const fallback = cloudTestFallback(t);
    if (fallback) {
      skippedHalves = fallback.missing;
      const label = fallback.kept.join(' && ');
      t = { label, argv: [label], shell: true };
    }
  }
  // At --end on a committed, pushed head the suite has already run on exactly this content:
  // the pre-commit hook on each commit, CI on the pushed head. A third run here learns
  // nothing. It is kept for the cases that carry information — a dirty tree (pre-commit
  // never saw it), unpushed commits (CI has not), no upstream, or no workflows to hand the
  // verdict to.
  const covered = t && END && GIT.upstream && !GIT.dirtyCount && !GIT.ahead && has('.github/workflows');
  if (covered) {
    skipped(`tests — \`${t.label}\` not re-run: HEAD is committed and pushed, so pre-commit and CI on that head own the verdict`);
  } else if (!t) note('no test command detected — set "test" in .claude/session.json if there is one');
  else {
    const timeout = configuredTimeout('testTimeoutMs', 300000);
    const r = await runReadingOutputAsync(
      t.shell ? t.argv.join(' ') : t.argv[0],
      t.shell ? [] : t.argv.slice(1),
      { timeout, shell: t.shell },
    );
    if (r.code === 0) {
      const pass = (r.out.match(/^ℹ pass (\d+)/m) || [])[1];
      const skip = (r.out.match(/^ℹ skipped (\d+)/m) || [])[1];
      ok(`tests pass${pass ? ` (${pass}${skip && skip !== '0' ? `, ${skip} skipped` : ''})` : ''}`);
      if (skippedHalves) {
        for (const s of skippedHalves) {
          note(`\`${s.half}\` — \`${s.bin}\` is not on PATH in this container; covered by CI on the current head (issue 171)`);
        }
      }
    } else if (r.timedOut) {
      stop(`tests TIMEOUT after ${timeout} ms — \`${t.label}\``);
      noteDiagnostics(r.out);
    } else {
      stop(`tests FAIL — \`${t.label}\``);
      noteDiagnostics(r.out);
    }
  }

  if (END) {
    const gates = CFG.releaseGates || (has('tools/canary.js') ? ['node tools/canary.js'] : []);
    for (const g of gates) {
      const r = await runReadingOutputAsync(g, [], { timeout: 300000, shell: true });
      if (r.code === 0) ok(`release gate passes — \`${g}\``);
      else if (r.timedOut) {
        stop(`release gate TIMEOUT after 300000 ms — \`${g}\``);
        noteDiagnostics(r.out);
      } else if (r.code === 2) {
        // The house convention: exit 1 = found a failure, exit 2 = could not check. Neither is
        // a pass, but "could not check" is not "FAILS" — in a cloud container a gate that needs
        // a local credential can never run, and calling that a failed release check every
        // session teaches people to ignore the line that matters.
        warn(`release gate could not check — that is not a pass — \`${g}\``);
        if (IS_CLOUD) {
          const reason = (r.out.match(/^CANNOT CHECK: .*$/m) || [])[0];
          if (reason) note(reason);
          note('cloud container — a gate needing local credentials cannot run here; release stays CI or local');
        } else noteDiagnostics(r.out);
      } else {
        stop(`release gate FAILS — \`${g}\``);
        noteDiagnostics(r.out);
        note('do not release');
      }
    }
  }

  trackerAuditChecks();

  for (const c of (CFG.checks || [])) {
    if (c.when === 'end' && !END) continue;
    if (c.when === 'start' && END) continue;
    if (c.host && c.host !== HOST) {
      skipped(`${c.name || c.run} — skipped (${c.host}-only)`);
      continue;
    }
    const r = await runReadingOutputAsync(c.run, [], { timeout: 120000, shell: true });
    if (r.code === 0) ok(c.name || c.run);
    else if (r.timedOut) {
      warn(`${c.name || c.run} — TIMEOUT after 120000 ms`);
      noteDiagnostics(r.out);
    } else {
      warn(`${c.name || c.run} — exit ${r.code}`);
      noteDiagnostics(r.out);
    }
  }
}

/* ---------------------------------------------------------- tracker audit -------------------- */

/** The tracker audit is a JOB now, not something this checker spawns (issue 473).
 *
 *  `tools/tracker-audit.js` needs `gh` and the network, and both halves of the setup used to pay
 *  for it: a container that had not run the bootstrap hook yet had no `gh`, so the audit exited 2
 *  and the report carried "the tracker audit could not run — that is not a pass" at both ends; on
 *  the desktop it was a full live read of the tracker twice per session. (With the bootstrap hook's
 *  gh in place the audit does run in a container — measured 2026-09-17, exit 0 with its ProjectsV2
 *  board checks degraded to a NOTE — which is why the job's value is one verdict per head for every
 *  host, not a container's missing binary.) `.github/workflows/tracker-audit.yml` runs it on every issue
 *  event and every push to the default branch, and this reads that job's latest run for the head
 *  the default branch is on — the way the session-end check reads Board sweep. A container and
 *  the desktop print the same line.
 *
 *  The workflow's filename is the contract between the two halves. Renaming one renames both. */
const TRACKER_AUDIT_WORKFLOW = 'tracker-audit.yml';

/** Local sha of the default branch, without a network call: the fetch in gitChecks has already
 *  run, so the remote-tracking ref is current. `origin/HEAD` first (it names the default branch on
 *  any clone made by `git clone`), then the two conventional names for a clone that has none. */
function defaultBranchHead() {
  const sym = tryRun('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  for (const ref of [sym, 'origin/main', 'origin/master'].filter(Boolean)) {
    const sha = tryRun('git', ['rev-parse', '--verify', '--quiet', ref]);
    if (sha) return sha.trim();
  }
  return null;
}

/** The workflow's runs, newest first. gh when it is there, curl through the container's egress
 *  proxy when it is not — the same transport pair the ticket listing uses, and the reason this
 *  check works in a container at all. `runner` is injected so a test can drive it. */
function fetchTrackerAuditRuns(slug, runner) {
  const rest = `repos/${slug.owner}/${slug.repo}/actions/workflows/${TRACKER_AUDIT_WORKFLOW}/runs?per_page=20`;
  let raw;
  if (runner) raw = runner(rest);
  else if (tryRun('gh', ['--version'], { timeout: 10000 }) !== null) {
    raw = tryRun('gh', ['api', rest], { timeout: 25000 });
  } else {
    const r = runReadingOutput('curl', ['-sS', '--fail', '--max-time', '25',
      '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: session-check',
      `https://api.github.com/${rest}`], { timeout: 30000 });
    raw = r.code === 0 ? r.out : null;
    if (raw === null) return { error: `no gh, and curl exited ${r.code === null ? 'unknown' : r.code} reading the job's runs` };
  }
  if (raw === null || raw === undefined) {
    // A 404 is the commonest cause and reads the same as an outage: the endpoint exists only once
    // the file is on the default branch, so a session on the branch that ADDS it lands here.
    return { error: `GitHub did not answer for the tracker audit job — is ${TRACKER_AUDIT_WORKFLOW} on the default branch yet?` };
  }
  let body;
  try { body = JSON.parse(raw); } catch (e) { return { error: 'GitHub returned unparseable JSON for the tracker audit job' }; }
  if (!body || !Array.isArray(body.workflow_runs)) {
    return { error: `the tracker audit job has no runs listing — is ${TRACKER_AUDIT_WORKFLOW} on the default branch?` };
  }
  return { runs: body.workflow_runs };
}

/** Pure: the line the report prints for this job, out of the runs listing (newest first), the local
 *  head of the default branch, and whatever stopped the fetch. Exported for the tests.
 *
 *  Four states, and no fifth. A run that is still queued or in progress carries no verdict to read,
 *  so it reports as "no run" with its url in a note; so does a cancelled one — the job cancels in
 *  flight when a wave of issue events arrives, and reading `cancelled` as a conclusion would print
 *  drift that nothing found. */
function trackerAuditReport(runs, head, error) {
  const unreadable = (why) => ({ state: 'unreadable', level: 'warn',
    text: 'could not read the tracker audit job — that is not a pass', notes: [why] });
  if (error) return unreadable(error);
  if (!head) return unreadable('could not resolve the default branch head locally (no origin/HEAD, origin/main or origin/master)');
  if (!Array.isArray(runs)) return unreadable('the runs listing was not an array');

  const short = head.slice(0, 7);
  const mine = runs.filter((r) => r && String(r.head_sha) === head);
  const verdict = mine.find((r) => r.status === 'completed'
    && r.conclusion !== 'cancelled' && r.conclusion !== 'skipped' && r.conclusion !== 'stale');
  if (!verdict) {
    const pending = mine.find((r) => r.status !== 'completed');
    return { state: 'no-run', level: 'warn', text: 'tracker audit: no run for this head', notes: [
      pending
        ? `run ${pending.html_url} is ${pending.status} on ${short} — re-read the report when it finishes`
        : `nothing has audited ${short} yet — \`gh workflow run ${TRACKER_AUDIT_WORKFLOW}\`, or push`,
    ] };
  }
  if (verdict.conclusion === 'success') {
    return { state: 'clean', level: 'ok', text: 'tracker audit clean', notes: [`${short} — ${verdict.html_url}`] };
  }
  return { state: 'drift', level: 'warn', text: `tracker audit: drift — ${verdict.html_url}`, notes: [
    `the run summary names every finding (exit 1 = drift, 2 = the audit went blind); head ${short}`,
    'check none are yours before you add work on top of them',
  ] };
}

function trackerAuditChecks() {
  if (!has(`.github/workflows/${TRACKER_AUDIT_WORKFLOW}`)) {
    if (!has('tools/tracker-audit.js')) return;
    warn(`the tracker audit is a job now, and this repo has no .github/workflows/${TRACKER_AUDIT_WORKFLOW}`);
    note('copy it from claude-dotfiles (issue 473) — until it exists nothing audits this tracker on its own');
    return;
  }
  const slug = parseGithubSlug(tryRun('git', ['remote', 'get-url', 'origin']));
  const fetched = slug ? fetchTrackerAuditRuns(slug) : { error: 'no github remote to read the job from' };
  const r = trackerAuditReport(fetched.runs, defaultBranchHead(), fetched.error);
  (r.level === 'ok' ? ok : warn)(r.text);
  (r.notes || []).forEach((n) => note(n));
}

/* --------------------------------------------------------- cloud skills ---------------------- */

/** Skills live on this machine; cloud containers run a SNAPSHOT uploaded to claude.ai. Editing a
 *  skill here changes nothing in the cloud until the plugin is rebuilt and re-uploaded, and the
 *  product says nothing when the copy goes stale. End of session is when that gap is cheap to close.
 *  Machine-wide, so it reports the same in every repo — and stays silent on machines with no plugin. */
function cloudSkillChecks() {
  // The sweep compares the AUTHORING machine's tree against the last upload. Inside a cloud
  // container the tree IS the downstream copy, there is no stamp, and the report would read
  // "never uploaded" every session — meaningless there, so stay quiet.
  if (IS_CLOUD) return;
  const sweep = path.join(__dirname, 'cloud-plugin-sweep.js');
  if (!fs.existsSync(sweep)) return;
  const r = runReadingOutput(process.execPath, [sweep, '--json'], { timeout: 30000 });
  let result;
  try { result = JSON.parse(r.out); } catch (e) { result = null; }
  if (!result || result.state === 'not-configured') return;

  head('Cloud skills');
  const lines = result.lines || [];
  if (result.state === 'in-sync') { ok(`cloud plugin is current — ${result.count} skills`); return; }
  if (result.state === 'unknown') {
    note(`could not check the cloud plugin: ${result.reason || 'unknown reason'}`);
    return;
  }
  warn(result.state === 'never-uploaded'
    ? 'no upload recorded — cloud sessions may be running without your skills'
    : 'cloud plugin is STALE — cloud sessions load the skills as they were at the last upload');
  lines.forEach((l) => note(l));
  note("fix: in a claude-dotfiles checkout, `python3 tools/build-cloud-plugin.py --home 'C:\\Users\\Dan'` on a branch, then merge");
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return null; }
}

/* --------------------------------------------------------- installed plugins ----------------
 *  A marketplace install reads the LOCAL clone of the marketplace, never the source. So a
 *  plugin can sit at an old version indefinitely while the repo it came from is current, and
 *  nothing says so: `claude plugin install` happily reinstalls whatever the cached clone holds.
 *  Measured 2026-09-02 — a clone frozen at 2026-08-31 kept serving that build for two days
 *  while GitHub carried the new one, and the only symptom was a skill that would not update.
 *  The comparison is a semver-shaped numeric compare, not string !== (issue 85): the CLONE can
 *  itself be stale, so installed > offered means the marketplace clone needs refreshing, not
 *  that the plugin needs updating (an update would reinstall the same version from the same
 *  stale clone). Machine-wide, silent when no marketplace is configured. */
const { classifyInstall } = require('./plugin-version');
function installedPluginChecks() {
  if (IS_CLOUD) return;
  const root = path.join(os.homedir(), '.claude', 'plugins');
  const known = readJson(path.join(root, 'known_marketplaces.json'));
  const installed = readJson(path.join(root, 'installed_plugins.json'));
  if (!known || !installed || !installed.plugins) return;

  const behindRows = [];
  const aheadRows = [];
  for (const [id, entries] of Object.entries(installed.plugins)) {
    const at = id.lastIndexOf('@');
    if (at < 1) continue;
    const name = id.slice(0, at);
    const market = id.slice(at + 1);
    const entry = (entries || [])[0];
    if (!entry || !entry.version) continue;
    const loc = known[market] && known[market].installLocation;
    if (!loc) continue;
    const manifest = readJson(path.join(loc, '.claude-plugin', 'marketplace.json'));
    if (!manifest || !Array.isArray(manifest.plugins)) continue;
    const offered = manifest.plugins.find((p) => p && p.name === name);
    if (!offered || !offered.version) continue;
    // The clone's HEAD against the commit the install was cut from: equal means the clone is
    // exactly what is installed, and any version disagreement is upstream's marketplace.json
    // lagging its own plugin.json (sstklen, 2026-09-15). classifyInstall reports that as
    // 'manifest-lag', which is nothing this machine can refresh, so it stays silent here.
    const cloneSha = tryRun('git', ['-C', loc, 'rev-parse', 'HEAD'], { timeout: 10000 });
    const cmp = classifyInstall({
      installed: entry.version, offered: offered.version,
      installedSha: entry.gitCommitSha, cloneSha,
    });
    if (cmp === 'behind') behindRows.push({ name, market, have: entry.version, offered: offered.version });
    else if (cmp === 'ahead') aheadRows.push({ name, market, have: entry.version, offered: offered.version });
  }

  // Age of each clone, because a current-looking install proves nothing when the clone
  // behind it has not been fetched in weeks.
  const stale = [];
  const now = Date.now();
  for (const [market, meta] of Object.entries(known)) {
    const when = Date.parse(meta && meta.lastUpdated);
    if (!Number.isFinite(when)) continue;
    const days = Math.floor((now - when) / 86400000);
    if (days >= 7) stale.push({ market, days });
  }

  if (!behindRows.length && !aheadRows.length && !stale.length) return;
  head('Plugins');
  behindRows.forEach((r) => {
    warn(`${r.name} is behind its marketplace — installed ${r.have}, available ${r.offered}`);
    note(`\`claude plugin update ${r.name}\`, then restart`);
  });
  aheadRows.forEach((r) => {
    warn(`the marketplace clone of ${r.market} is stale — installed ${r.name} ${r.have}, clone offers ${r.offered}`);
    note(`\`claude plugin marketplace update ${r.market}\` refreshes the clone (do NOT \`claude plugin update\` — the clone would reinstall ${r.offered})`);
  });
  stale.forEach((s) => {
    note(`marketplace ${s.market} last fetched ${s.days}d ago — `
      + '`claude plugin marketplace update` refreshes every one');
  });
}

/* -------------------------------------------------------------- tickets ---------------------- */

function parseGithubSlug(remote) {
  const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote || '');
  return m ? { owner: m[1], repo: m[2] } : null;
}

/** The REST path for machines without gh, via curl — NOT node's fetch, which ignores
 *  HTTPS_PROXY and so bypasses exactly the proxy that makes this work. Cloud containers are
 *  the case that matters: their egress proxy authenticates api.github.com, so private repos
 *  answer too. Elsewhere it still works for public repos and degrades to the same
 *  "did not answer" note for private ones. curl ships on Windows 10+, macOS and the
 *  containers, so this adds no dependency.
 *
 *  Pages through `paginateTicketPages`, the same loop the gh path uses. One `per_page=100` fetch
 *  was a silent truncation: `renderTicketList` prints the length it is handed as the count, so a
 *  label carrying more than 100 open tickets read as exactly `100 ticket(s)` with no error
 *  (issue 400). `runCurl` is injected so a test can drive the loop without curl. */
function curlTicketRows(slug, label, runCurl = runReadingOutput) {
  const url = `https://api.github.com/repos/${slug.owner}/${slug.repo}/issues`
    + `?labels=${encodeURIComponent(label)}&state=open&per_page=100`;
  let failure = null;
  const result = paginateTicketPages((page) => {
    const r = runCurl('curl', ['-sS', '--fail', '--max-time', '25',
      '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: session-check',
      `${url}&page=${page}`], { timeout: 30000 });
    if (r.code !== 0) {
      failure = `curl exit ${r.code === null ? 'unknown' : r.code} on page ${page}`;
      return null;
    }
    return r.out;
  });
  // The PR filter and the page-by-page error live in paginateTicketPages now; only the transport
  // failure is curl's to name.
  return failure ? { error: failure } : result;
}

/** Walk a label's open issues page by page into one list of `#N  title` rows. `fetchPage(n)`
 *  returns the raw JSON text of page n, or null when that request failed.
 *
 *  This replaces `gh api --paginate`, which follows the `Link: rel="next"` URL GitHub sends
 *  back. That URL is the numeric-ID form, `/repositories/{id}/issues?page=2`, and the
 *  Claude-Code cloud egress proxy refuses it with a 403 — so on any label carrying more than
 *  100 open tickets page one arrived, page two 403'd, and the whole listing came out as
 *  "could not reach GitHub": a big queue reading as a GitHub outage (issue 394; the tracker
 *  audit had the same bug, issue 171). Paging by hand keeps every request on the
 *  `repos/{owner}/{repo}` path, and a failure names the page it happened on.
 *
 *  Pure — no gh, no network — so a test can drive the loop with a stub. The 20-page cap bounds
 *  the loop, not the queue: 2,000 open tickets on one label is far past the point where this
 *  listing (8 rows and a count) is what anyone is reading. */
function paginateTicketPages(fetchPage) {
  const items = [];
  for (let page = 1; page <= 20; page++) {
    const raw = fetchPage(page);
    if (raw === null) {
      return { error: `could not reach GitHub for the ticket list (page ${page})` };
    }
    let rows;
    try { rows = JSON.parse(raw); } catch (e) {
      return { error: `GitHub returned unparseable JSON for the ticket list (page ${page})` };
    }
    if (!Array.isArray(rows)) rows = [];
    for (const r of rows) items.push(r);
    if (rows.length < 100) break;
  }
  // /issues returns PRs too, so filter them out to match the old `gh issue list` behaviour.
  return { list: items.filter((i) => i && !i.pull_request).map((i) => `#${i.number}  ${i.title}`) };
}

/** Fetch open non-PR issues carrying a single label from the repo's origin. Returns
 *  { list, error }; the caller decides how to render each shape. Extracted so a second listing
 *  (ready-for-local-agent, desktop only) can reuse the same gh/curl path. */
function fetchTicketList(slug, label) {
  if (tryRun('gh', ['--version'], { timeout: 10000 }) !== null) {
    // `gh api` REST (not `gh issue list`, which is GraphQL under the hood). Cloud containers
    // only route REST through their egress proxy — GraphQL 403s there — so the audit and this
    // check both live on `gh api ...` (issue 130).
    const path = 'repos/' + slug.owner + '/' + slug.repo
      + '/issues?labels=' + encodeURIComponent(label) + '&state=open&per_page=100';
    return paginateTicketPages((page) =>
      tryRun('gh', ['api', path + '&page=' + page], { timeout: 25000 }));
  }
  const r = curlTicketRows(slug, label);
  if (r.error) return { error: `no gh, and the GitHub API did not answer — ${r.error}` };
  return { list: r.list };
}

function renderTicketList(label, result) {
  if (result.error) { note(`(${result.error} for ${label})`); return; }
  const list = result.list || [];
  if (!list.length) { ok(`no open tickets labelled ${label}`); return; }
  ok(`${list.length} ticket(s) labelled ${label}`);
  list.slice(0, 8).forEach((r) => note(r));
  if (list.length > 8) note(`...and ${list.length - 8} more`);
}

function ticketChecks() {
  const remote = tryRun('git', ['remote', 'get-url', 'origin']);
  const slug = parseGithubSlug(remote);
  if (!slug) return;

  const label = CFG.ticketLabel || 'ready-for-agent';
  renderTicketList(label, fetchTicketList(slug, label));

  // A desktop session sees its ready-for-local-agent queue on prompt 1 too — those are tickets a
  // cloud container cannot take (a live-tree edit, a proxy-blocked capability). In a cloud
  // container the queue is by definition not for this session; skip the listing with a note so
  // the reader knows why it is missing.
  if (label !== 'ready-for-local-agent') {
    if (IS_CLOUD) {
      note('(ready-for-local-agent queue is for the desktop — not listed in a cloud container)');
    } else {
      renderTicketList('ready-for-local-agent', fetchTicketList(slug, 'ready-for-local-agent'));
    }
  }
}

/* -------------------------------------------------------------- harness --------------------- */

/** Whether the repo's project harness is current, against the project-harness skill's own
 *  version marker. The skill writes `docs/agents/harness-version.md` on every install or
 *  upgrade; this reads it against the same number the skill would write today
 *  (`templates/harness-version.md` next to the skill's SKILL.md), so an out-of-date harness
 *  becomes a STOP at session start instead of something someone has to remember (issue 139).
 *  Read-only — the upgrade is `/project-harness`, not this. */
const harnessLib = require('./harness-version');
function harnessChecks() {
  if (CFG.harness === false) return;
  const skillDir = harnessLib.findSkillDir(__dirname, process.env);
  const s = harnessLib.harnessState(REPO, skillDir, process.env);
  head('Harness');
  if (s.state === 'stamp-mismatch') {
    warn(`the project-harness skill is inconsistent — template v${s.template}, SKILL.md v${s.skill}`);
    note('rebuild the plugin: `python3 tools/build-cloud-plugin.py` in a claude-dotfiles checkout');
    return;
  }
  if (s.state === 'skill-missing') {
    note(`project-harness skill not available here — cannot check the version${s.reason ? ` (${s.reason})` : ''}`);
    return;
  }
  if (s.state === 'not-harnessed') {
    warn('repo is not harnessed — run `/project-harness`');
    note('set `"harness": false` in .claude/session.json to silence this on a deliberately unharnessed repo');
    return;
  }
  if (s.state === 'current') {
    ok(`harness v${s.repo}, current`);
    return;
  }
  if (s.state === 'stale-skill-copy') {
    // Issue 412: the marker is not the suspect. The project-harness copy this session loaded is
    // older than the published one, so every correctly stamped repo reads as edited here.
    warn(`harness stamp says v${s.repo} but the project-harness copy here is v${s.current}, behind the published v${s.canonical} — the plugin payload is stale, not the marker`);
    note('republish the plugin with `update-cloud-plugin`, then start a fresh session to pick it up');
    return;
  }
  if (s.state === 'ahead') {
    warn(`harness stamp says v${s.repo} but the skill is at v${s.current} — someone edited the marker without bumping the template`);
    return;
  }
  // behind
  const shown = s.v1Implicit ? 'v1 (no docs/agents/harness-version.md; pre-marker)' : `v${s.repo}`;
  stop(`harness ${shown} is behind v${s.current} — run \`/project-harness\` (upgrade path, step 7)`);
  note('the upgrade table lives in project-harness/SKILL.md ("Upgrading an existing install")');
}

/* -------------------------------------------------------------- bootstrap ------------------ */

/** Cloud-container bootstrap check (issue 163, spec #207 user story 7).
 *
 *  The bootstrap SessionStart hook is the ONE per-repo artefact that installs the aac-skills
 *  plugin payload, gh, and the plugin's hooks into a claude.ai/code container. When it did not
 *  run — or ran but left a stripped skills tree — a cloud session is silently ungoverned; no
 *  other check catches it. So: read the marker the hook writes at
 *  ~/.claude/hook-state/aac-bootstrap/state.json, and STOP with a named reason when the marker
 *  is missing, its JSON is unreadable, or the skills it recorded are not on disk.
 *
 *  The comparison to master's payload version is informational (`on vX, master offers vY`);
 *  master will overtake a session's cached copy and re-cloning is the next session's job. That
 *  line replaces the dotfiles-freshness loop's "N commits behind" reading on the cloud path.
 *  Local runs skip the whole block: the desktop machine IS where the payload is authored, and
 *  the check would false-STOP on every clean local session. */
const bootstrap = require('./bootstrap-check');
function bootstrapChecks() {
  if (!IS_CLOUD) return;
  head('Cloud bootstrap');
  const r = bootstrap.readMarker(process.env);
  if (r.state === 'missing') {
    stop(`aac-bootstrap marker absent at ${r.path} — the SessionStart bootstrap hook did not run`);
    note('the hook is `.claude/hooks/session-start.sh` (or `session-start-bootstrap.sh` beside a repo\'s own hook, issue 542) in every AAC repo; a container reaches it via CLAUDE_CODE_REMOTE=true');
    return;
  }
  if (r.state === 'unreadable') {
    stop(`aac-bootstrap marker at ${r.path} is unreadable — ${r.reason}`);
    return;
  }
  if (r.state === 'failed') {
    // Issue 483: the hook ran and a stage failed; the marker names which and why. No payload,
    // skills or governance hooks landed. The clone case is the credential one (2026-09-17: a
    // caveman ANTHROPIC_BASE_URL in the environment stripped github.com injection, issue 519).
    stop(`aac-bootstrap ${r.stage} failed — ${r.reason}`);
    note(`marker ${r.path}${r.marker.failed_at ? ` written ${r.marker.failed_at}` : ''}; no aac payload, skills or governance hooks in this container`);
    if (r.stage === 'clone') {
      note('if git could not read a username for github.com: the dotfiles repo is not a source of this session (add it as a second source of the environment or Routine, aac-routines issue 489), or `env | grep ANTHROPIC_BASE_URL` shows a caveman proxy URL at environment level, which strips credential injection (issue 519); git push falls back to GitHub MCP push_files');
    }
    return;
  }
  const marker = r.marker;
  const v = bootstrap.verifySkills(marker, process.env);
  if (v.state === 'skills-missing') {
    stop(`${v.missing.length} aac-skills skill(s) named in the marker are absent from ${bootstrap.skillsDir(process.env)}`);
    v.missing.slice(0, 8).forEach((n) => note(`- ${n}`));
    if (v.missing.length > 8) note(`...and ${v.missing.length - 8} more`);
    return;
  }
  ok(`aac-bootstrap payload v${marker.payload_version} — ${marker.skills.length} skills, gh ${marker.gh_path && marker.gh_path !== 'missing' ? 'installed' : 'MISSING'}`);
  const cmp = bootstrap.compareToMaster(marker, process.env);
  if (cmp.state === 'drift') note(`payload v${cmp.marker} loaded; master offers v${cmp.master} — next container will pick it up`);
  else if (cmp.state === 'same') note(`payload matches dotfiles master (v${cmp.master})`);
  else note(`payload v${cmp.marker} loaded; master version could not be read here`);
}

/* -------------------------------------------------------------- account ---------------------- */

/** Which Claude account this session runs under, against ~/.claude/accounts.json (identity.js).
 *  Two accounts share this machine and the product never says which one a session is using; the
 *  owner kept losing track (claude-dotfiles issue 103). A mismatch is a WARNING, never a STOP —
 *  the owner's ruling (2026-09-09): switching accounts is their call, the report just has to say. */
function accountChecks() {
  let identity;
  try { identity = require('./identity.js'); } catch (e) { return; }
  const reg = identity.loadRegistry(process.env);
  if (!reg) return;
  head('Account');
  if (reg.error) { warn(reg.error); return; }

  const slug = parseGithubSlug(tryRun('git', ['remote', 'get-url', 'origin']));
  const entry = identity.repoEntry(reg, slug);
  const me = identity.resolveIdentity(process.env);
  const meText = identity.describe(reg, me);

  if (!slug) note(`no GitHub remote — cannot look this repo up; session runs as ${meText}`);
  else if (!entry) {
    warn(`${slug.owner}/${slug.repo} is not in the accounts registry — session runs as ${meText}`);
    note(`add it under "repos" in ${reg._path}`);
  } else {
    const ownerUuid = (reg.accounts[entry.owner] || {}).uuid;
    if (entry.status === 'dead') {
      warn(`${entry.key} is marked ${entry.status} in the accounts registry (owner ${entry.owner})`);
    }
    if (!me) note(`${entry.key} belongs to ${entry.owner}; this surface leaves no account identity on disk (cloud?), so that is unchecked`);
    else if (!ownerUuid) note(`${entry.key} belongs to ${entry.owner}, which has no uuid in the registry; session runs as ${meText}`);
    else if (ownerUuid.toLowerCase() === me.accountUuid.toLowerCase()) ok(`${entry.owner} owns ${entry.key}; session runs as ${meText}`);
    else {
      warn(`${entry.key} belongs to ${entry.owner}; this session runs as ${meText}`);
      note(`switch account for this repo, or move it under "repos" in ${reg._path}`);
    }
  }

  // Desktop routines fire under whichever account+org the desktop app is signed into, and the
  // registry it keeps per account+org silently retains enabled copies after a switch (three
  // registries held the same six routines on 2026-09-09, two of them stale). Walk them all, but
  // only from the one repo that owns this concern — a finding in every repo would get muted.
  if (!IS_CLOUD && slug && reg.auditRepo
      && reg.auditRepo.toLowerCase() === `${slug.owner}/${slug.repo}`.toLowerCase()) {
    const root = identity.desktopSessionsRoot(process.env);
    if (!root || !fs.existsSync(root)) note('no desktop routine registry on this machine — routine audit skipped');
    else {
      const r = identity.auditRoutines(reg, root);
      if (!r.stray.length && !r.unregistered.length) ok(`desktop routines enabled only under their owner (${r.scanned} registries scanned)`);
      if (r.stray.length) {
        warn(`${r.stray.length} desktop routine(s) enabled outside their owner account/org — duplicates fire after an account or org switch`);
        r.stray.forEach((s) => note(`${s.taskId} [${s.cron}] enabled under ${s.where}; owner ${s.owner}`));
        note('disable them in the desktop app while signed into that account/org, or set "enabled": false in that scheduled-tasks.json');
      }
      if (r.unregistered.length) {
        warn(`${r.unregistered.length} enabled desktop routine(s) missing from the accounts registry`);
        r.unregistered.forEach((u) => note(`${u.taskId} [${u.cron}] enabled under ${u.where}`));
        note(`add them under "routines" in ${reg._path}`);
      }
    }
  }
}

/* ---------------------------------------------------------------------------------------------- */

async function main() {
  console.log('');
  console.log(`${C.b}${END ? 'Finishing' : 'Starting'} a session — ${path.basename(REPO)}${C.x}`);
  gitChecks();
  harnessChecks();
  bootstrapChecks();
  accountChecks();
  claspChecks();
  await workChecks();
  ticketChecks();
  installedPluginChecks();
  if (END) cloudSkillChecks();
  if (CFG.note) { head('Note'); note(CFG.note); }
  console.log(out.join('\n'));
  console.log('');
  if (worst === 0) console.log(`${C.g}All clear.${C.x} ${END ? 'Nothing left hanging.' : 'Pick something and go.'}`);
  else if (worst === 1) console.log(`${C.y}Some things need a look${C.x} — the !! lines above.`);
  else console.log(`${C.r}Deal with the STOP lines before ${END ? 'you finish' : 'writing code'}.${C.x}`);
  console.log('');
  process.exitCode = worst === 2 ? 1 : 0;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  // Required by a test: hand out the pure helpers and run nothing.
  module.exports = { curlTicketRows, paginateTicketPages, parseGithubSlug, trackerAuditReport };
}
