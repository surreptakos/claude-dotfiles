#!/usr/bin/env node
/**
 * caveman-shrink-gate.js - keeps caveman's shrink hook off git inside a linked worktree (issue 1363).
 *
 * `caveman enable claude` wires a PreToolUse hook (`caveman shrink-hook`) that rewrites a noisy Bash
 * command to `caveman shrink -- <command>`. In a worktree-isolated agent (a ticket-fleet worker) the
 * harness's worktree-isolation guard then refuses every rewritten git command with "runs caveman with
 * a git command among its operands": it cannot show what caveman runs, or from where. So a worker's
 * `git fetch origin` never ran, its origin/master stayed at the launch sha, and a branch was cut from
 * a stale base (aac-sales-commissions run 6ac03f6d).
 *
 * Two roles:
 *
 *   node caveman-shrink-gate.js <caveman hook argv...>
 *       The hook. A git command (first word `git`) run from inside a linked worktree (the nearest
 *       `.git` above the event's cwd is a file) exits 0 with no output: no rewrite, so the guard
 *       judges the plain command - it accepts `git fetch origin` and still refuses one that targets
 *       another tree. Anything else is handed, stdin and all, to the caveman hook named by the
 *       remaining argv, whose stdout and exit code pass through unchanged. Fails open: a spawn error
 *       is "no rewrite".
 *
 *   node caveman-shrink-gate.js --install <settings.json> <installed gate path>
 *       Put the gate in front of every caveman shrink-hook command in a POSIX settings.json. Run
 *       after each `caveman enable claude`, which re-adds its bare entry every time; the re-added
 *       entry is gated to the same command and dropped as a duplicate, so the file holds one.
 *
 * Wired by .claude/hooks/caveman-bootstrap.sh (cloud containers). Not wired on the Windows desktop,
 * whose hook runs under PowerShell (`& '<caveman.CMD>' shrink-hook`).
 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const GATE_NAME = 'caveman-shrink-gate.js';

function inLinkedWorktree(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    try {
      return fs.statSync(path.join(dir, '.git')).isFile();
    } catch { /* no .git here; keep climbing */ }
    const up = path.dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

// True when caveman must not see this event: a git command from inside a linked worktree.
function keepPlain(evt) {
  const command = evt && evt.tool_input && evt.tool_input.command;
  if (typeof command !== 'string' || !/^git(\s|$)/.test(command.trim())) return false;
  return inLinkedWorktree(typeof evt.cwd === 'string' && evt.cwd ? evt.cwd : process.cwd());
}

function runHook(argv) {
  let raw = '';
  try { raw = fs.readFileSync(0); } catch { return 0; }
  let evt = null;
  try { evt = JSON.parse(raw.toString('utf8') || '{}'); } catch { /* caveman judges it */ }
  if (keepPlain(evt) || argv.length === 0) return 0;
  const r = spawnSync(argv[0], argv.slice(1), { input: raw, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return 0;
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return r.status == null ? 0 : r.status;
}

// Gate every caveman shrink-hook command in a settings object; returns true when it changed.
function gateSettings(root, gatePath) {
  const groups = root && root.hooks && Array.isArray(root.hooks.PreToolUse) ? root.hooks.PreToolUse : null;
  if (!groups) return false;
  const prefix = `node "${gatePath}" `;
  const seen = new Set();
  let changed = false;
  const kept = [];
  for (const group of groups) {
    const hooks = group && Array.isArray(group.hooks) ? group.hooks : [];
    for (const h of hooks) {
      if (h && typeof h.command === 'string' && h.command.includes('shrink-hook') && !h.command.includes(GATE_NAME)) {
        h.command = prefix + h.command;
        changed = true;
      }
    }
    const gated = hooks.find((h) => h && typeof h.command === 'string' && h.command.includes(GATE_NAME));
    const key = gated ? `${group.matcher || ''}\n${gated.command}` : null;
    if (key && seen.has(key) && hooks.length === 1) { changed = true; continue; }
    if (key) seen.add(key);
    kept.push(group);
  }
  root.hooks.PreToolUse = kept;
  return changed;
}

function install(settingsPath, gatePath) {
  const root = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (gateSettings(root, gatePath)) fs.writeFileSync(settingsPath, JSON.stringify(root, null, 2) + '\n');
  return 0;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--install') {
    try { process.exitCode = install(argv[1], argv[2]); } catch (e) {
      process.stderr.write(`caveman-shrink-gate: ${e.message}\n`);
      process.exitCode = 1;
    }
  } else {
    process.exitCode = runHook(argv);
  }
}

module.exports = { keepPlain, inLinkedWorktree, gateSettings };
