#!/usr/bin/env node
/**
 * dotfiles-freshness-hook - wired from .claude/settings.json (project-level) to the
 * SessionStart, UserPromptSubmit and SessionEnd events for THIS repo.
 *
 * Not a mirrored ~/.claude/hooks file: lives in tools/, ships in the repo, and
 * runs with cwd = the dotfiles project root - which is where Claude Code sets it
 * for project-level hook commands. That is the fix for the earlier attempt at
 * this issue, whose files were committed straight into the generated mirror and
 * would have been wiped by the next `sync.ps1 -Mode push`.
 *
 * MODES
 *   session-start   run classifier; if state1, run install-state1 and inject the
 *                   commit list the auto-install landed; if state2 with live drift
 *                   AND no incoming commits, run push-state2 (issue 19: sync push +
 *                   git push, fixed commit "chore: session-start capture") and inject
 *                   the outcome, or fall back to the state2 advisory with the failure
 *                   reason appended when the push failed. Otherwise inject nothing for
 *                   `synced`/`unknown`, a warn block for the origin-ahead-ineligible
 *                   variant of `state2`, a warn block for `state3` (the block itself
 *                   lives at UserPromptSubmit).
 *   prompt          run classifier; on state3, first try `resolve-state3` when the
 *                   local checkout is eligible (liveDrift=true, behind>0, ahead=0,
 *                   NOT a worktree) - the .ps1 runs sync push + git pull --rebase
 *                   + git push + sync pull. Clean rebase: inject a note the state
 *                   is now synced and let the prompt through. Rebase conflict or
 *                   any other failure, and any ineligible shape (worktree, ahead>0):
 *                   EXIT 2 with the resolution commands on stderr, augmented with
 *                   the conflicted-path list when the rebase produced one - Claude
 *                   Code treats a UserPromptSubmit hook exit 2 as a block on the
 *                   prompt, and stderr is passed back to the model. Every other
 *                   state stays silent. Set DOTFILES_AUTO_RESOLVE_STATE3=0 to fall
 *                   back to the pre-issue-18 behaviour (always block on state3).
 *   session-end     run classifier; on state2 or state3, print a warn to STDERR
 *                   and emit `{}` on stdout. SessionEnd has no additionalContext
 *                   channel - Claude Code 2.1.270 rejects hookSpecificOutput with
 *                   hookEventName "SessionEnd" ("Hook JSON output validation
 *                   failed", seen in a cloud container 2026-09-14) - so this mode
 *                   never injects. The session-start auto-push clears most state2s
 *                   before this fires, but a live edit made DURING the session
 *                   lands here.
 *
 * WHY UserPromptSubmit for the block, not SessionStart
 *   SessionStart hooks in Claude Code can only INJECT context; they cannot refuse
 *   the session. The current documented mechanism for refusing user input is a
 *   UserPromptSubmit hook that exits 2 with stderr - Claude Code blocks the
 *   prompt and feeds the stderr back for the model to read. Verified against the
 *   Claude Code hooks reference (SessionStart: "return additionalContext"; exit
 *   codes: "exit 2 blocks the operation"; UserPromptSubmit is listed among the
 *   events that support the exit-2 block).
 *
 * WHY THE TOOL IS PowerShell
 *   Everything else in this repo that touches ~/.claude uses lib/manifest.ps1 -
 *   the whitelist, the templating, the fingerprint. Reimplementing the manifest
 *   walk in Node would duplicate the source of truth for what "the live tree"
 *   is. This driver just JSON-parses whatever the .ps1 prints, so a stub tool is
 *   trivial to point at for tests (DOTFILES_FRESHNESS_TOOL env var).
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = process.env.DOTFILES_REPO_ROOT || repoRoot(process.cwd());
const TOOL = process.env.DOTFILES_FRESHNESS_TOOL || path.join(REPO, 'tools', 'dotfiles-freshness.ps1');
const AUTO_INSTALL = process.env.DOTFILES_AUTO_INSTALL !== '0';
const AUTO_PUSH    = process.env.DOTFILES_AUTO_PUSH    !== '0';
const AUTO_RESOLVE = process.env.DOTFILES_AUTO_RESOLVE_STATE3 !== '0';
const SKIP_FETCH   = process.env.DOTFILES_SKIP_FETCH === '1';
const CLASSIFY_TIMEOUT_MS = Number(process.env.DOTFILES_CLASSIFY_TIMEOUT_MS || 20000);
const INSTALL_TIMEOUT_MS  = Number(process.env.DOTFILES_INSTALL_TIMEOUT_MS  || 90000);
const PUSH_TIMEOUT_MS     = Number(process.env.DOTFILES_PUSH_TIMEOUT_MS     || 120000);
const RESOLVE_TIMEOUT_MS  = Number(process.env.DOTFILES_RESOLVE_TIMEOUT_MS  || 180000);
const USER_HOME = process.env.DOTFILES_USER_HOME || os.homedir();

function repoRoot(from) {
  let d = from;
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return from;
}

// Issue 107: the classifier is a PowerShell script; a cloud Linux container has no
// PowerShell, so spawning it produces `spawnSync powershell ENOENT` on every hook
// entry - which reads like something broke. Detect the situation on the PATH (the
// honest signal: is the executable actually reachable?) and skip cleanly. The
// container env var CLAUDE_CODE_REMOTE_SESSION_ID is accepted as an override for
// the paranoid case where a broken PATH on Windows would otherwise misclassify -
// either signal is enough. Skip only applies when the configured tool is a .ps1;
// a Node stub (used by tests, and available for a future non-PS reimplementation)
// bypasses the check.
function powershellAvailable() {
  if (process.env.DOTFILES_ASSUME_NO_POWERSHELL === '1') return false;
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const rawExts = process.platform === 'win32'
    ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
    : [''];
  const exts = rawExts.length ? rawExts : [''];
  const paths = String(process.env.PATH || '').split(pathSep).filter(Boolean);
  const names = ['powershell', 'pwsh'];
  for (const dir of paths) {
    for (const name of names) {
      for (const ext of exts) {
        try {
          if (fs.existsSync(path.join(dir, name + ext))) return true;
        } catch (_) { /* keep looking */ }
      }
    }
  }
  return false;
}

function detectSkipReason() {
  const isPs = /\.ps1$/i.test(TOOL);
  if (!isPs) return null;
  if (powershellAvailable()) return null;
  if (process.env.CLAUDE_CODE_REMOTE_SESSION_ID) {
    return 'no PowerShell on PATH (cloud container: CLAUDE_CODE_REMOTE_SESSION_ID set)';
  }
  return 'no PowerShell on PATH (classifier is a .ps1 script)';
}

function runTool(mode) {
  const isPs = /\.ps1$/i.test(TOOL);
  const args = isPs
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOOL,
       '-Mode', mode, '-RepoRoot', REPO, '-UserHome', USER_HOME]
    : [TOOL, '--mode', mode, '--repo', REPO, '--home', USER_HOME];
  if (SKIP_FETCH && mode === 'classify') { args.push(isPs ? '-SkipFetch' : '--skip-fetch'); }
  const cmd = isPs ? 'powershell' : process.execPath;
  let timeout = CLASSIFY_TIMEOUT_MS;
  if (mode === 'install-state1') timeout = INSTALL_TIMEOUT_MS;
  else if (mode === 'push-state2') timeout = PUSH_TIMEOUT_MS;
  else if (mode === 'resolve-state3') timeout = RESOLVE_TIMEOUT_MS;
  let stdout = '', code = 0;
  try {
    stdout = execFileSync(cmd, args, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout, windowsHide: true,
    });
  } catch (e) {
    stdout = String(e.stdout || '');
    code = typeof e.status === 'number' ? e.status : null;
    if (code === null) {
      return { ok: false, error: `tool did not complete (${e.message})`, raw: stdout };
    }
  }
  const parsed = tryParseJson(stdout);
  if (!parsed) return { ok: false, error: 'tool output was not JSON', raw: stdout.slice(0, 800), exitCode: code };
  parsed.__exitCode = code;
  return parsed;
}

function tryParseJson(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch (_) { /* fall through */ }
  // Grab the last {...} block: PowerShell sometimes prefixes noise.
  const match = trimmed.match(/\{[\s\S]*\}\s*$/);
  if (match) { try { return JSON.parse(match[0]); } catch (_) { /* fall */ } }
  return null;
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) { return ''; }
}

function emitContext(text) {
  const payload = {
    hookSpecificOutput: {
      hookEventName: process.env.CLAUDE_HOOK_EVENT || 'UserPromptSubmit',
      additionalContext: text,
    },
    suppressOutput: true,
  };
  process.stdout.write(JSON.stringify(payload));
}

function emitSilent() { process.stdout.write('{}'); }

// SessionEnd has no additionalContext channel. Claude Code 2.1.270 validates
// hookSpecificOutput.hookEventName against the events that DO carry one
// (PreToolUse, UserPromptSubmit, SessionStart, ...) and rejects "SessionEnd":
//   SessionEnd hook [...] failed: Hook JSON output validation failed -
//   hookSpecificOutput.hookEventName: expected one of "PreToolUse" | ...
// So the end-of-session mode never emits hookSpecificOutput: any note goes to
// stderr (visible in --debug / verbose hook output) and stdout stays `{}`.
function emitEndNote(text) {
  process.stderr.write(String(text) + '\n');
  emitSilent();
}

/* -------------------------------------------------------------------- wording */

function formatState1(report, install) {
  const commits = install && install.installed && install.installed.length
    ? install.installed
    : (report.incomingCommits || []);
  const lines = [
    'DOTFILES FRESHNESS: origin was ahead and live was clean - auto-installed.',
    '',
    'Commits installed:',
    ...(commits.length ? commits.map((c) => '  ' + c) : ['  (none reported)']),
    '',
    'This ran automatically at session start. No action needed.',
  ];
  return lines.join('\n');
}

function formatState1Refused(report, install) {
  return [
    'DOTFILES FRESHNESS: auto-install FAILED - continuing in the stale state.',
    '',
    'Reason: ' + (install.reason || 'unknown'),
    '',
    'Run these to recover:',
    ...(report.resolution || []).map((c) => '  ' + c),
  ].join('\n');
}

function formatState2Pushed(report, push) {
  // Issue 19: state2 with live drift auto-captured and pushed at session start. Pairs with
  // the state1 auto-resolver to make state3 impossible outside a real merge conflict - a
  // subsequent classify (after the stamp sync.ps1 writes) reports 'synced'.
  const parts = [
    'DOTFILES FRESHNESS: live-side drift auto-captured and pushed at session start.',
    '',
    'Ran: sync.ps1 -Mode push -Commit "chore: session-start capture"',
    'Then: git push',
  ];
  if (push && push.pushed) {
    parts.push('', 'New HEAD on origin: ' + push.pushed);
  }
  parts.push(
    '',
    'A fresh classify would now report `synced`. No action needed.',
  );
  return parts.join('\n');
}

function formatState2AutoPushFailed(report, push) {
  // On failure the base state2 advisory is preserved so the resolution commands are visible;
  // the failure reason is appended so the operator can see what went wrong without hunting
  // logs. Never blocks - state2 is a report-only classification by design.
  const base = formatState2(report, false);
  const reason = (push && push.reason) || 'auto-push failed (no reason returned)';
  return base + '\n\n' + [
    'AUTO-PUSH FAILED: ' + reason,
    'Session continues; run the commands above manually when convenient.',
  ].join('\n');
}

function formatState2(report, atEnd) {
  const prefix = atEnd
    ? 'DOTFILES FRESHNESS (END): live-side drift is unpushed alongside any commits above.'
    : 'DOTFILES FRESHNESS: live copies edited since last sync (report only, never a block).';
  const parts = [prefix];
  if (report.liveDrift) {
    parts.push('', 'Live config on this machine has changed since the last sync stamp.');
  }
  if (report.repo && report.repo.behind > 0) {
    parts.push('', 'Origin also has ' + report.repo.behind + ' commit(s) waiting (but manual pull required: ahead='
      + report.repo.ahead + ', worktree=' + Boolean(report.repo.isWorktree) + ').');
  }
  if (report.resolution && report.resolution.length) {
    parts.push('', 'Run these when convenient:');
    parts.push(...report.resolution.map((c) => '  ' + c));
  }
  parts.push('', 'The check STAYS a report by design - the owner edits live config routinely,',
                 'and a blocker here would fire constantly and get disabled.');
  return parts.join('\n');
}

function formatState3(report, atEnd) {
  const which = atEnd ? '(END) ' : '';
  const commits = report.incomingCommits || [];
  const parts = [
    'DOTFILES FRESHNESS ' + which + 'STOP - BOTH DIVERGED (origin ahead AND live drifted).',
    '',
    'Auto-pull would overwrite live edits; auto-push would ignore what came in on origin.',
    'Resolve in this exact order (capture live first, then merge, then re-sync):',
    '',
    ...(report.resolution || []).map((c) => '  ' + c),
  ];
  if (commits.length) {
    parts.push('', 'Commits waiting on origin:', ...commits.map((c) => '  ' + c));
  }
  return parts.join('\n');
}

function formatState3Resolved(report, resolve) {
  // Issue 18: prompt-time auto-resolve landed. Injected as UserPromptSubmit additionalContext
  // so the model knows what happened between "session opened in state3" (session-start's warn)
  // and "state is now synced" (this note); the prompt itself proceeds unchanged.
  const commits = report.incomingCommits || [];
  const parts = [
    'DOTFILES FRESHNESS: state3 auto-resolved at prompt (rebase was clean).',
    '',
    'Ran: sync.ps1 -Mode push -Commit "chore: capture live edits before pulling"',
    'Then: git pull --rebase, git push, sync.ps1 -Mode pull',
  ];
  if (resolve && resolve.resolved) {
    parts.push('', 'New HEAD on origin: ' + resolve.resolved);
  }
  if (commits.length) {
    parts.push('', 'Commits merged in:', ...commits.map((c) => '  ' + c));
  }
  parts.push('', 'A fresh classify would now report `synced`. Proceeding with your prompt.');
  return parts.join('\n');
}

function formatState3Conflict(report, resolve) {
  // Rebase produced merge conflicts. The .ps1 aborted the rebase and returned the conflicted
  // paths; surface them at the top of the block message so the operator can see immediately
  // which files need attention before re-running the manual sequence.
  const conflicted = (resolve && Array.isArray(resolve.conflictedPaths)) ? resolve.conflictedPaths : [];
  const parts = [
    'DOTFILES FRESHNESS STOP - state3 auto-resolve HIT MERGE CONFLICTS. Rebase aborted.',
    '',
  ];
  if (conflicted.length) {
    parts.push('Conflicted files (' + conflicted.length + '):');
    parts.push(...conflicted.map((p) => '  ' + p));
    parts.push('');
  } else {
    parts.push('(No conflicted-path list returned; check `git status`.)', '');
  }
  parts.push(
    'The auto-capture commit ("chore: capture live edits before pulling") IS on your branch',
    'and will be your merge base. Resolve by hand:',
    '',
    ...(report.resolution || []).map((c) => '  ' + c),
    '',
    'After resolving the conflicts and pushing, re-run `.\\sync.ps1 -Mode pull`.',
  );
  return parts.join('\n');
}

function formatState3ResolveFailed(report, resolve) {
  // Non-conflict failure (network, auth, sync-push failed, sync-pull failed). Keep the standard
  // state3 block message so the operator sees the manual path, and append the specific reason.
  const reason = (resolve && resolve.reason) || 'unknown';
  const base = formatState3(report, false);
  return base + '\n\nAUTO-RESOLVE FAILED: ' + reason;
}

/* --------------------------------------------------------------------- modes */

function modeSessionStart() {
  process.env.CLAUDE_HOOK_EVENT = 'SessionStart';
  let raw = '';
  try { raw = readStdinSync(); } catch (_) { raw = ''; }
  let event = {};
  try { event = raw ? JSON.parse(raw) : {}; } catch (_) { event = {}; }
  if (event && String(event.source || '') === 'compact') { emitSilent(); return; }

  const skip = detectSkipReason();
  if (skip) { emitContext('DOTFILES FRESHNESS: skipped (' + skip + ')'); return; }

  const report = runTool('classify');
  if (!report || report.ok === false) {
    // If the classifier itself failed, do not block. Report so a human can fix it.
    emitContext('DOTFILES FRESHNESS: could not classify - ' + (report && report.error ? report.error : 'unknown error'));
    return;
  }

  if (report.state === 'synced' || report.state === 'unknown') { emitSilent(); return; }
  if (report.state === 'state2') {
    // Issue 19: auto-capture live drift when it is the only thing wrong AND we are safely
    // on the tracking branch. The classifier returns state2 in two shapes: (a) liveDrift=true
    // and behind=0, safe to auto-push; (b) origin ahead but ineligible for state1 (worktree,
    // or local commits ahead), where pushing would not help. Only shape (a) triggers the
    // auto-push - shape (b) stays a manual-pull advisory. AUTO_PUSH=0 disables the mechanism
    // entirely for debugging.
    //
    // Worktree/ahead-guard rationale (matches install-state1's `-not $repo.isWorktree`
    // clause): this repo runs many concurrent agent worktrees, each on its own feature
    // branch. A SessionStart hook fired inside one of those worktrees must NEVER auto-commit
    // dotfiles-sync work onto that feature branch - it would pollute the ticket's diff.
    // Reject both the worktree marker AND `ahead>0` (a plain checkout with unpushed local
    // commits, e.g. mid-implementation on master) - either shape means pushing here would
    // move the wrong branch. The classifier's push-state2 mode re-checks this same shape;
    // the Node-side guard just spares the PowerShell round-trip in the common case.
    const liveDrift  = report.liveDrift === true;
    const repo       = report.repo || {};
    const behind     = Number(repo.behind || 0) > 0;
    const ahead      = Number(repo.ahead  || 0) > 0;
    const isWorktree = repo.isWorktree === true;
    if (!AUTO_PUSH || !liveDrift || behind || ahead || isWorktree) {
      emitContext(formatState2(report, false));
      return;
    }
    const push = runTool('push-state2');
    if (push && push.ok) { emitContext(formatState2Pushed(report, push)); return; }
    emitContext(formatState2AutoPushFailed(report, push || {}));
    return;
  }
  if (report.state === 'state3') { emitContext(formatState3(report, false)); return; }

  if (report.state === 'state1') {
    if (!AUTO_INSTALL) {
      emitContext('DOTFILES FRESHNESS: state1 detected but DOTFILES_AUTO_INSTALL=0. Run `.\\sync.ps1 -Mode pull` yourself.');
      return;
    }
    const install = runTool('install-state1');
    if (install && install.ok) { emitContext(formatState1(report, install)); return; }
    emitContext(formatState1Refused(report, install || {}));
    return;
  }

  emitSilent();
}

function modePrompt() {
  process.env.CLAUDE_HOOK_EVENT = 'UserPromptSubmit';
  const skip = detectSkipReason();
  if (skip) { emitContext('DOTFILES FRESHNESS: skipped (' + skip + ')'); return; }
  const report = runTool('classify');
  if (!report || report.ok === false) { emitSilent(); return; }

  if (report.state !== 'state3') { emitSilent(); return; }

  // Issue 18: try to auto-resolve on state3 before blocking. Eligibility mirrors the .ps1's
  // guard (which is the correctness contract - see resolve-state3 in dotfiles-freshness.ps1).
  // The Node-side check is a fast pre-filter that spares the PowerShell round-trip and, more
  // importantly, keeps a driver bug from routing an ineligible state3 (worktree/ahead>0) into
  // an auto-resolve at all: the worktree guard IS the specific safeguard that failed the
  // previous verification of this issue.
  //
  // Why the worktree/ahead guard belongs here even though the .ps1 also has it: this hook
  // fires with cwd = agent's own worktree in this repo's normal parallel-agent workflow.
  // Every ticket runs in its own worktree on its own feature branch. An auto-resolve there
  // would `sync.ps1 -Mode push -Commit` (a commit on the ticket branch), then `git push` it
  // to the branch's origin - polluting the ticket's diff and its PR. Match install-state1's
  // `-not $repo.isWorktree` and push-state2's `-or $ahead -gt 0` clauses exactly.
  const repo       = report.repo || {};
  const liveDrift  = report.liveDrift === true;
  const behind     = Number(repo.behind || 0) > 0;
  const ahead      = Number(repo.ahead  || 0) > 0;
  const isWorktree = repo.isWorktree === true;
  const eligible   = AUTO_RESOLVE && liveDrift && behind && !ahead && !isWorktree;

  if (eligible) {
    const resolve = runTool('resolve-state3');
    if (resolve && resolve.ok) {
      // Success: inject a note and let the prompt through. Exit 0, no stderr.
      emitContext(formatState3Resolved(report, resolve));
      return;
    }
    // Failure: block, and use the conflict-aware wording when the .ps1 returned a path list.
    const conflicted = resolve && Array.isArray(resolve.conflictedPaths) && resolve.conflictedPaths.length > 0;
    const message = conflicted
      ? formatState3Conflict(report, resolve)
      : formatState3ResolveFailed(report, resolve || {});
    process.stderr.write(message + '\n');
    process.exit(2);
    return;
  }

  // Ineligible (worktree, ahead>0, auto-resolve disabled): block with the standard message.
  process.stderr.write(formatState3(report, false) + '\n');
  process.exit(2);
}

function modeSessionEnd() {
  // Never emitContext here: SessionEnd rejects hookSpecificOutput (see emitEndNote).
  const skip = detectSkipReason();
  if (skip) { emitEndNote('DOTFILES FRESHNESS: skipped (' + skip + ')'); return; }
  const report = runTool('classify');
  if (!report || report.ok === false) { emitSilent(); return; }
  if (report.state === 'state2') { emitEndNote(formatState2(report, true)); return; }
  if (report.state === 'state3') { emitEndNote(formatState3(report, true)); return; }
  emitSilent();
}

function main() {
  const mode = process.argv[2] || '';
  try {
    if (mode === 'session-start') return modeSessionStart();
    if (mode === 'prompt')        return modePrompt();
    if (mode === 'session-end')   return modeSessionEnd();
  } catch (e) {
    // A broken check must never stop someone working. Emit a note instead -
    // on stderr for SessionEnd, which has no context channel to inject into.
    const emit = mode === 'session-end' ? emitEndNote : emitContext;
    emit('DOTFILES FRESHNESS: hook driver crashed - ' + e.message);
    return;
  }
  // Unknown mode: emit an error to stderr for a human, but exit 0 so we do not block.
  process.stderr.write('dotfiles-freshness-hook: unknown mode "' + mode + '"\n');
  emitSilent();
}

main();
