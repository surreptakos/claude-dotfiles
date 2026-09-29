#!/usr/bin/env node
/**
 * orchestrator-tree-guard.js — isolation guard for the ticket-fleet orchestrator's OWN checkout.
 *
 * Ported from aac-routines (its issue 192, where the tool was born) by claude-dotfiles issue 1020:
 * `aac-skills/ticket-fleet/ticket-fleet.js` names `tools/orchestrator-tree-guard.js` as its guard
 * tool (`treeGuardScript`), and with the file absent here every wave in this repo ran with the dirt
 * half of the guard OFF - run 6abbcc6e left an untracked `discoveries-bullets.json` at the repo root
 * that no checkpoint caught. Same move as tools/fleet-run-record.js (issue 1010).
 *
 * A fleet sub-session must never write into the tree the orchestrator itself is sitting in.
 * Three subcommands, run against the orchestrator's own checkout:
 *
 *   baseline --cwd <dir> (--state <file> | --state-dir <dir>) [--force]
 *       Snapshot `git status --porcelain` once, at run start. Dirt that pre-dates the wave belongs
 *       to the operator and is never blamed on a ticket. `--state-dir` mints a fresh per-run
 *       filename and prints it as `statePath`, so two runs cannot land on the same file.
 *
 *   check --cwd <dir> --state <file> --label <l> --ticket <n> [--candidate <ticket>=<branch>]...
 *       Re-read the tree and report every entry that is NOT in the baseline. Writes nothing.
 *
 *   restore --cwd <dir> --state <file> --path <p> [--path <p>]...
 *       (claude-dotfiles issue 1020; aac-routines' copy has no such subcommand.) Put each named
 *       post-baseline entry back the way the baseline found it, so the fleet can restore and
 *       continue (issue 1006) instead of ending the wave. Nothing is deleted: the tree's copy of
 *       every entry is MOVED into `<state file without .json>.quarantine/<path>`, inside .git
 *       where `git status` never shows it; a path tracked at HEAD is then checked back out from
 *       HEAD, any other path is dropped from the index. A path that IS in the baseline is refused
 *       - that dirt is the operator's. The tree is re-read afterwards and a path still dirty is a
 *       failure, never a pass.
 *
 * Exit codes, same vocabulary as tools/tracker-audit.js:
 *   0  clean / restored   — nothing beyond the baseline, or every named entry put back
 *   1  leak / not restored — an entry appeared after the baseline, or one could not be put back
 *   2  could-not-audit    — never a pass (missing baseline, not a git tree, git failed)
 *
 * Concurrency: the fleet's `pipeline()` runs checks against this one tree at once. The state file
 * is written exactly once (`wx`) and only read afterwards; `check` writes nothing and its git reads
 * use `--no-optional-locks`, so concurrent checks cannot collide on `.git/index.lock`. `restore`
 * writes, and the fleet runs it only for entries its own single-threaded bookkeeping has just
 * claimed, so two restores never name the same path.
 *
 * Attribution is by content, not timing: for every leaked path `check` hashes the tree's copy
 * (staged blob if staged, otherwise the working file) and compares it with `<branch>:<path>` for
 * each `--candidate`, so the ticket that CAUSED a leak is named even when another ticket's
 * checkpoint observed it first.
 *
 * Every path this prints uses forward slashes: the fleet hands `statePath` back to a bash command
 * unquoted, and on Windows Git Bash a `C:\Users\...` spelling loses its backslashes there.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STATE_VERSION = 1;

const EXIT_CLEAN = 0;
const EXIT_LEAK = 1;
const EXIT_CANNOT_AUDIT = 2;

const slash = (p) => String(p).split(path.sep).join('/');

// --- git plumbing -----------------------------------------------------------

function git(cwd, args, { locks = false } = {}) {
  const r = spawnSync('git', locks ? args : ['--no-optional-locks', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    code: r.status === null ? 2 : r.status,
    out: (r.stdout || '').replace(/\n$/, ''),
    err: (r.stderr || '').trim(),
    failedToSpawn: !!r.error,
  };
}

/**
 * Parse one `git status --porcelain` line into {status, path}. Renames (`R  old -> new`) are
 * attributed to the destination path; git's quoting of unusual paths is stripped so the value can
 * be handed back to git as a pathspec.
 */
function parsePorcelainLine(line) {
  const status = line.slice(0, 2);
  let rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  if (arrow !== -1) rest = rest.slice(arrow + 4);
  if (rest.startsWith('"') && rest.endsWith('"')) {
    try {
      rest = JSON.parse(rest);
    } catch {
      rest = rest.slice(1, -1);
    }
  }
  return { status, path: rest, raw: line };
}

function statusEntries(cwd) {
  const r = git(cwd, ['status', '--porcelain']);
  if (r.failedToSpawn) return { error: 'git is not runnable from this container' };
  if (r.code !== 0) return { error: `git status failed (exit ${r.code}): ${r.err || '(no stderr)'}` };
  const lines = r.out.split('\n').filter((l) => l.trim().length > 0);
  return { entries: lines.map(parsePorcelainLine) };
}

function isGitWorkTree(cwd) {
  const r = git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return !r.failedToSpawn && r.code === 0 && r.out.trim() === 'true';
}

// --- attribution ------------------------------------------------------------

function treeBlob(cwd, entry) {
  const staged = entry.status[0] !== ' ' && entry.status[0] !== '?';
  if (staged) {
    const r = git(cwd, ['rev-parse', `:${entry.path}`]);
    if (r.code === 0 && /^[0-9a-f]{40}$/.test(r.out.trim())) return r.out.trim();
  }
  const r = git(cwd, ['hash-object', '--', entry.path]);
  if (r.code === 0 && /^[0-9a-f]{40}$/.test(r.out.trim())) return r.out.trim();
  return null;
}

/** Name the ticket whose branch carries this exact content. `candidates` is [{ticket, branch}]. */
function attribute(cwd, entry, candidates) {
  const blob = treeBlob(cwd, entry);
  if (!blob) return { blob: null, matches: [] };
  const matches = [];
  for (const c of candidates) {
    const r = git(cwd, ['rev-parse', `${c.branch}:${entry.path}`]);
    if (r.code === 0 && r.out.trim() === blob) matches.push(c);
  }
  return { blob, matches };
}

// --- restore ----------------------------------------------------------------

/** Move a file or directory, falling back to copy-then-remove across devices. */
function moveAside(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

/**
 * Put one post-baseline entry back. The tree's copy goes to `quarantineDir` first, so nothing the
 * wave wrote is lost; then a path HEAD knows is checked out from HEAD (index and working file), and
 * any other path is dropped from the index.
 */
function restoreEntry(cwd, rel, quarantineDir) {
  const clean = rel.replace(/\/$/, '');
  const abs = path.join(cwd, clean);
  let quarantined = null;
  if (fs.existsSync(abs)) {
    quarantined = path.join(quarantineDir, clean);
    if (fs.existsSync(quarantined)) quarantined = `${quarantined}.${process.pid}-${process.hrtime.bigint().toString(36)}`;
    moveAside(abs, quarantined);
  }
  const inHead = git(cwd, ['cat-file', '-e', `HEAD:${clean}`]).code === 0;
  const r = inHead
    ? git(cwd, ['checkout', 'HEAD', '--', clean], { locks: true })
    : git(cwd, ['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', clean], { locks: true });
  if (r.code !== 0) {
    return { path: rel, action: inHead ? 'checkout-head' : 'unstage', quarantined: quarantined && slash(quarantined), error: r.err || `git exit ${r.code}` };
  }
  return { path: rel, action: inHead ? 'checkout-head' : (quarantined ? 'moved-aside' : 'unstage'), quarantined: quarantined && slash(quarantined) };
}

// --- state ------------------------------------------------------------------

function readState(statePath) {
  let text;
  try {
    text = fs.readFileSync(statePath, 'utf8');
  } catch (e) {
    return { error: `no run baseline at ${statePath} (${e.code || e.message}) — the fleet must run the baseline step in Setup before any check` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `run baseline at ${statePath} is not valid JSON: ${e.message}` };
  }
  if (parsed.version !== STATE_VERSION) {
    return { error: `run baseline at ${statePath} has version ${parsed.version}, expected ${STATE_VERSION}` };
  }
  return { state: parsed };
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [], candidates: [], paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') { out.force = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[++i];
      if (key === 'candidate') {
        const eq = String(val).indexOf('=');
        if (eq > 0) out.candidates.push({ ticket: Number(val.slice(0, eq)), branch: val.slice(eq + 1) });
        continue;
      }
      if (key === 'path') { if (val !== undefined) out.paths.push(val); continue; }
      out[key] = val;
      continue;
    }
    out._.push(a);
  }
  return out;
}

function fail(stderr, message) {
  stderr.write(message.endsWith('\n') ? message : message + '\n');
  return EXIT_CANNOT_AUDIT;
}

function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const opts = parseArgs(argv);
  const cmd = opts._[0];
  const cwd = path.resolve(opts.cwd || process.cwd());

  if (cmd !== 'baseline' && cmd !== 'check' && cmd !== 'restore') {
    return fail(stderr, 'usage: orchestrator-tree-guard.js baseline --cwd <dir> (--state <file> | --state-dir <dir>) | check --cwd <dir> --state <file> --label L --ticket N [--candidate N=branch]... | restore --cwd <dir> --state <file> --path P [--path P]...');
  }
  let statePath = opts.state ? path.resolve(opts.state) : null;
  if (!statePath && cmd === 'baseline' && opts['state-dir']) {
    statePath = path.resolve(opts['state-dir'], `run-${process.pid}-${process.hrtime.bigint().toString(36)}.json`);
  }
  if (!statePath) {
    return fail(stderr, cmd === 'baseline'
      ? '--state <file> or --state-dir <dir> is required (the run baseline lives there)'
      : '--state <file> is required — pass the statePath the baseline step printed');
  }
  if (!fs.existsSync(cwd)) return fail(stderr, `--cwd ${cwd} does not exist`);
  if (!isGitWorkTree(cwd)) return fail(stderr, `--cwd ${cwd} is not inside a git work tree — cannot audit`);

  const snapshot = statusEntries(cwd);
  if (snapshot.error) return fail(stderr, snapshot.error);

  if (cmd === 'baseline') {
    const payload = { version: STATE_VERSION, cwd, entries: snapshot.entries.map((e) => e.raw) };
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), { flag: opts.force ? 'w' : 'wx' });
    } catch (e) {
      if (e.code === 'EEXIST') {
        return fail(stderr,
          `a run baseline already exists at ${statePath}. Refusing to overwrite it mid-run: `
          + 'resetting the reference point would absorb a live leak and hide it. '
          + 'Use a per-run --state path, or pass --force when starting a genuinely new run.');
      }
      return fail(stderr, `could not write the run baseline to ${statePath}: ${e.message}`);
    }
    stdout.write(JSON.stringify({ ok: true, command: 'baseline', cwd: slash(cwd), statePath: slash(statePath), baselineCount: payload.entries.length, entries: payload.entries }) + '\n');
    return EXIT_CLEAN;
  }

  const loaded = readState(statePath);
  if (loaded.error) return fail(stderr, loaded.error);
  if (path.resolve(loaded.state.cwd) !== cwd) {
    return fail(stderr, `run baseline was taken in ${loaded.state.cwd} but this ${cmd} targets ${cwd} — refusing to compare two different trees`);
  }
  const basePaths = new Set(loaded.state.entries.map((l) => parsePorcelainLine(l).path));

  if (cmd === 'restore') {
    if (!opts.paths.length) return fail(stderr, 'restore needs at least one --path <p> (the entries a check reported)');
    const refused = opts.paths.filter((p) => basePaths.has(p));
    if (refused.length) {
      return fail(stderr, `refusing to restore ${refused.join(', ')}: dirty before the run started (in the baseline), so it is the operator's, not the wave's`);
    }
    const quarantineDir = statePath.replace(/\.json$/, '') + '.quarantine';
    const results = opts.paths.map((p) => restoreEntry(cwd, p, quarantineDir));
    const after = statusEntries(cwd);
    if (after.error) return fail(stderr, `restored, but could not re-read the tree: ${after.error}`);
    const stillDirty = new Set(after.entries.filter((e) => !basePaths.has(e.path)).map((e) => e.path));
    const failed = results.filter((r) => r.error || stillDirty.has(r.path));
    const report = {
      ok: failed.length === 0,
      command: 'restore',
      cwd: slash(cwd),
      quarantineDir: slash(quarantineDir),
      restored: results.filter((r) => !failed.includes(r)),
      failed: failed.map((r) => ({ ...r, error: r.error || 'still dirty after the restore' })),
    };
    stdout.write(JSON.stringify(report) + '\n');
    if (failed.length) {
      stderr.write(`could not restore ${failed.map((r) => r.path).join('; ')} in ${cwd}\n`);
      return EXIT_LEAK;
    }
    return EXIT_CLEAN;
  }

  const fresh = snapshot.entries.filter((e) => !basePaths.has(e.path));
  const label = opts.label || '(unlabelled)';
  const ticket = opts.ticket ? Number(opts.ticket) : null;

  const newEntries = fresh.map((e) => {
    const { blob, matches } = attribute(cwd, e, opts.candidates);
    return { status: e.status, path: e.path, raw: e.raw, blob, matchedTickets: matches.map((m) => m.ticket), matchedBranches: matches.map((m) => m.branch) };
  });

  const blamed = [...new Set(newEntries.flatMap((e) => e.matchedTickets))].sort((a, b) => a - b);
  const report = {
    ok: newEntries.length === 0,
    command: 'check',
    cwd: slash(cwd),
    label,
    observedByTicket: ticket,
    baselineCount: loaded.state.entries.length,
    newEntries,
    // Blob-matched culprits. Empty means content matched no candidate branch, in which case the
    // observing checkpoint's ticket is the best available name and the caller must say so.
    attributedTickets: blamed,
  };
  stdout.write(JSON.stringify(report) + '\n');

  if (newEntries.length) {
    const who = blamed.length
      ? `ticket ${blamed.map((n) => '#' + n).join(', #')} (blob-matched to ${[...new Set(newEntries.flatMap((e) => e.matchedBranches))].join(', ')})`
      : `unattributed — content matched no candidate branch; observed at the checkpoint for ticket ${ticket === null ? '(unknown)' : '#' + ticket}`;
    stderr.write(
      `orchestrator tree polluted during ${label} by ${who}: `
      + `${newEntries.length} entr${newEntries.length === 1 ? 'y' : 'ies'} — `
      + newEntries.map((e) => `${e.status} ${e.path}`).join('; ') + '\n');
    return EXIT_LEAK;
  }
  return EXIT_CLEAN;
}

if (require.main === module) process.exit(run(process.argv.slice(2)));

module.exports = { STATE_VERSION, parsePorcelainLine, attribute, parseArgs, run };
