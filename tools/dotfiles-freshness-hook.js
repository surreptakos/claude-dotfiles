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
 *                   commit list the auto-install landed. Otherwise inject nothing
 *                   for `synced`/`unknown`, a warn block for `state2`, a warn
 *                   block for `state3` (the block itself lives at UserPromptSubmit).
 *   prompt          run classifier; on state3, EXIT 2 with the resolution commands
 *                   on stderr - Claude Code treats a UserPromptSubmit hook exit 2
 *                   as a block on the prompt, and stderr is passed back to the
 *                   model. Every other state stays silent.
 *   session-end     run classifier; on state2 or state3, inject a warn so the
 *                   end audit records the drift alongside anything unpushed.
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
const SKIP_FETCH   = process.env.DOTFILES_SKIP_FETCH === '1';
const CLASSIFY_TIMEOUT_MS = Number(process.env.DOTFILES_CLASSIFY_TIMEOUT_MS || 20000);
const INSTALL_TIMEOUT_MS  = Number(process.env.DOTFILES_INSTALL_TIMEOUT_MS || 90000);
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

function runTool(mode) {
  const isPs = /\.ps1$/i.test(TOOL);
  const args = isPs
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', TOOL,
       '-Mode', mode, '-RepoRoot', REPO, '-UserHome', USER_HOME]
    : [TOOL, '--mode', mode, '--repo', REPO, '--home', USER_HOME];
  if (SKIP_FETCH && mode === 'classify') { args.push(isPs ? '-SkipFetch' : '--skip-fetch'); }
  const cmd = isPs ? 'powershell' : process.execPath;
  const timeout = mode === 'install-state1' ? INSTALL_TIMEOUT_MS : CLASSIFY_TIMEOUT_MS;
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

/* --------------------------------------------------------------------- modes */

function modeSessionStart() {
  process.env.CLAUDE_HOOK_EVENT = 'SessionStart';
  let raw = '';
  try { raw = readStdinSync(); } catch (_) { raw = ''; }
  let event = {};
  try { event = raw ? JSON.parse(raw) : {}; } catch (_) { event = {}; }
  if (event && String(event.source || '') === 'compact') { emitSilent(); return; }

  const report = runTool('classify');
  if (!report || report.ok === false) {
    // If the classifier itself failed, do not block. Report so a human can fix it.
    emitContext('DOTFILES FRESHNESS: could not classify - ' + (report && report.error ? report.error : 'unknown error'));
    return;
  }

  if (report.state === 'synced' || report.state === 'unknown') { emitSilent(); return; }
  if (report.state === 'state2') { emitContext(formatState2(report, false)); return; }
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
  const report = runTool('classify');
  if (!report || report.ok === false) { emitSilent(); return; }

  if (report.state !== 'state3') { emitSilent(); return; }

  // The block. Exit 2 tells Claude Code to refuse the prompt; stderr is fed back to the model.
  process.stderr.write(formatState3(report, false) + '\n');
  process.exit(2);
}

function modeSessionEnd() {
  process.env.CLAUDE_HOOK_EVENT = 'SessionEnd';
  const report = runTool('classify');
  if (!report || report.ok === false) { emitSilent(); return; }
  if (report.state === 'state2') { emitContext(formatState2(report, true)); return; }
  if (report.state === 'state3') { emitContext(formatState3(report, true)); return; }
  emitSilent();
}

function main() {
  const mode = process.argv[2] || '';
  try {
    if (mode === 'session-start') return modeSessionStart();
    if (mode === 'prompt')        return modePrompt();
    if (mode === 'session-end')   return modeSessionEnd();
  } catch (e) {
    // A broken check must never stop someone working. Emit a note instead.
    emitContext('DOTFILES FRESHNESS: hook driver crashed - ' + e.message);
    return;
  }
  // Unknown mode: emit an error to stderr for a human, but exit 0 so we do not block.
  process.stderr.write('dotfiles-freshness-hook: unknown mode "' + mode + '"\n');
  emitSilent();
}

main();
