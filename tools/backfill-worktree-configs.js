#!/usr/bin/env node
/**
 * Backfill config.worktree in every entry under .git/worktrees/ so a worktree
 * of a bare parent survives `git status` under git 2.53 (issue 30).
 *
 * The parent bare repo carries `core.bare = true` +
 * `extensions.worktreeConfig = true`. Under git 2.53 that combination makes a
 * worktree without its own per-worktree override fail inside with
 *   fatal: this operation must be run in a work tree
 * on any command that inspects the working tree. The override is a text file at
 * `.git/worktrees/<name>/config.worktree` containing
 *
 *   [core]
 *           bare = false
 *
 * and is read only because `extensions.worktreeConfig = true` is set. Writing
 * that file is the whole fix.
 *
 * This script walks every entry under `.git/worktrees/`, writes the override
 * where none exists, and — with --cleanup — offers to remove leftover
 * worktrees whose branch has been merged into a base branch AND (when the gh
 * CLI is available) whose PR is closed. Never removes without both signals,
 * never removes without --cleanup, and skips any entry whose gitdir file
 * carries `locked` so an in-flight fleet worker is safe.
 *
 * Modes:
 *   node tools/backfill-worktree-configs.js               # backfill missing files
 *   node tools/backfill-worktree-configs.js --dry-run     # report only
 *   node tools/backfill-worktree-configs.js --cleanup     # also remove leftovers
 *   node tools/backfill-worktree-configs.js --repo <path> # explicit repo path
 *   node tools/backfill-worktree-configs.js --base master # merge target for cleanup
 *   node tools/backfill-worktree-configs.js --json        # machine-readable output
 *
 * Exits 0 on success, 1 on hard failure (bad path, unreadable gitdir).
 *
 * Ticket: issue 30 (Backfill config.worktree files for existing worktrees).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BODY = '[core]\n\tbare = false\n';

function parseArgs(argv) {
  const out = {
    repo: process.cwd(),
    dryRun: false,
    cleanup: false,
    base: 'master',
    json: false,
    // Test seams: force which base command shape works, and inject a fake gh
    // exit for the "PR closed?" probe so unit tests do not need network.
    _forceGhAvailable: null,
    _forceGhResult: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') { out.dryRun = true; continue; }
    if (a === '--cleanup') { out.cleanup = true; continue; }
    if (a === '--json') { out.json = true; continue; }
    if (a === '--repo') { out.repo = argv[++i]; continue; }
    if (a === '--base') { out.base = argv[++i]; continue; }
    if (a === '-h' || a === '--help') { out.help = true; continue; }
  }
  return out;
}

// Resolve the shared common gitdir for a given path. Handles:
//   - a normal working tree      (root/.git is a directory)
//   - a bare repo                (root itself, or root/.git as a bare tree)
//   - a linked worktree checkout (root/.git is a file "gitdir: ..."; commondir
//     sits alongside the gitdir)
function resolveCommonDir(root) {
  const dotGit = path.join(root, '.git');
  const statDot = tryStat(dotGit);
  if (statDot && statDot.isDirectory()) {
    return path.resolve(dotGit);
  }
  if (statDot && statDot.isFile()) {
    const pointer = fs.readFileSync(dotGit, 'utf8').trim();
    const m = pointer.match(/^gitdir:\s*(.+)$/);
    if (!m) { throw new Error(`.git pointer file has no gitdir line: ${dotGit}`); }
    let gitDir = m[1].trim();
    if (!path.isAbsolute(gitDir)) { gitDir = path.resolve(root, gitDir); }
    const commondir = path.join(gitDir, 'commondir');
    if (fs.existsSync(commondir)) {
      let cd = fs.readFileSync(commondir, 'utf8').trim();
      if (!path.isAbsolute(cd)) { cd = path.resolve(gitDir, cd); }
      return path.resolve(cd);
    }
    return path.resolve(gitDir);
  }
  // Root is either a bare repo (root/HEAD etc.) or an already-resolved gitdir.
  if (fs.existsSync(path.join(root, 'HEAD'))) { return path.resolve(root); }
  throw new Error(`No git metadata found under: ${root}`);
}

function tryStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

// Read the [core] bare flag from an INI-shaped file. Returns:
//   { present: false }              — file missing or [core] bare unset
//   { present: true, value: bool }  — the flag is set and this is its value
function readCoreBare(file) {
  if (!fs.existsSync(file)) { return { present: false }; }
  const text = fs.readFileSync(file, 'utf8');
  let inCore = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) { continue; }
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      inCore = sec[1].trim().toLowerCase() === 'core';
      continue;
    }
    if (!inCore) { continue; }
    const kv = line.match(/^bare\s*=\s*(.*)$/i);
    if (kv) {
      const v = kv[1].trim().toLowerCase();
      return { present: true, value: v === 'true' || v === '1' || v === 'yes' || v === 'on' };
    }
  }
  return { present: false };
}

// The gitdir file points at the worktree's working directory. If it does not
// exist, or the directory it names is gone, the worktree entry is stale — but
// that is `git worktree prune` territory, not this tool. We report and skip.
function readGitdirTarget(entryDir) {
  const g = path.join(entryDir, 'gitdir');
  if (!fs.existsSync(g)) { return null; }
  return fs.readFileSync(g, 'utf8').trim();
}

function isLocked(entryDir) {
  return fs.existsSync(path.join(entryDir, 'locked'));
}

function readHeadBranch(entryDir) {
  const h = path.join(entryDir, 'HEAD');
  if (!fs.existsSync(h)) { return null; }
  const text = fs.readFileSync(h, 'utf8').trim();
  const m = text.match(/^ref:\s+refs\/heads\/(.+)$/);
  return m ? m[1] : null;
}

// Idempotent write: only touch disk when the current file lacks a [core] bare
// value entirely. Someone who set bare=true on purpose keeps that choice.
function backfillEntry(entryDir, opts) {
  const target = path.join(entryDir, 'config.worktree');
  const state = readCoreBare(target);
  const name = path.basename(entryDir);
  if (state.present) {
    return { name, action: 'already-configured', target, value: state.value };
  }
  if (opts.dryRun) {
    return { name, action: 'would-write', target };
  }
  fs.writeFileSync(target, BODY, 'utf8');
  return { name, action: 'wrote', target };
}

// Ask git whether a branch is merged into the base ref. `git merge-base
// --is-ancestor <branch> <base>` exits 0 when it is, 1 when it is not.
function isBranchMerged(commonDir, branch, base) {
  const r = spawnSync('git', ['--git-dir', commonDir, 'merge-base', '--is-ancestor', branch, base], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

// Optional PR-closed probe. Requires gh + a remote. Returns null when the
// probe cannot run (no gh, no PR record). The caller treats null as "unknown"
// and refuses to delete on unknown.
function isPullRequestClosed(branch, repoDir, opts) {
  if (opts._forceGhResult !== null) { return opts._forceGhResult; }
  const available = opts._forceGhAvailable !== null
    ? opts._forceGhAvailable
    : spawnSync('gh', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!available) { return null; }
  const r = spawnSync('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'state'], {
    cwd: repoDir,
    encoding: 'utf8',
  });
  if (r.status !== 0) { return null; }
  try {
    const rows = JSON.parse(r.stdout || '[]');
    if (rows.length === 0) { return null; }
    return rows.every((row) => row.state === 'MERGED' || row.state === 'CLOSED');
  } catch {
    return null;
  }
}

function removeLeftover(entryDir, workDir, opts, log) {
  const args = ['worktree', 'remove', '--force'];
  if (workDir) { args.push(workDir); } else { args.push(entryDir); }
  if (opts.dryRun) {
    log(`  would-run: git ${args.join(' ')}`);
    return { ok: true, ranCommand: false };
  }
  const r = spawnSync('git', args, { cwd: opts.repo, encoding: 'utf8' });
  if (r.status !== 0) {
    return { ok: false, err: (r.stderr || r.stdout || '').trim() };
  }
  return { ok: true, ranCommand: true };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let commonDir;
  try {
    commonDir = resolveCommonDir(path.resolve(opts.repo));
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    return 1;
  }

  const worktreeDir = path.join(commonDir, 'worktrees');
  if (!fs.existsSync(worktreeDir)) {
    if (opts.json) { process.stdout.write(JSON.stringify({ commonDir, entries: [] }) + '\n'); }
    else { process.stdout.write(`No worktrees registered under ${worktreeDir}.\n`); }
    return 0;
  }

  const entries = fs.readdirSync(worktreeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(worktreeDir, d.name));

  const report = [];
  for (const entryDir of entries) {
    const name = path.basename(entryDir);
    const workDir = readGitdirTarget(entryDir);
    const workDirParent = workDir ? path.dirname(workDir) : null;

    // Cleanup path — only when explicitly requested AND every safety signal
    // agrees. Locked worktrees never get removed.
    if (opts.cleanup) {
      const branch = readHeadBranch(entryDir);
      const locked = isLocked(entryDir);
      if (locked) {
        report.push({ name, action: 'kept-locked', branch });
        continue;
      }
      if (branch) {
        const merged = isBranchMerged(commonDir, branch, opts.base);
        const prClosed = isPullRequestClosed(branch, opts.repo, opts);
        if (merged && prClosed === true) {
          const rm = removeLeftover(entryDir, workDirParent, opts, (msg) => report.push({ name, note: msg }));
          if (rm.ok) {
            report.push({ name, action: opts.dryRun ? 'would-remove' : 'removed', branch, workDir: workDirParent });
            continue;
          }
          report.push({ name, action: 'remove-failed', branch, error: rm.err });
          continue;
        }
        // Merged but PR unknown, or unmerged: fall through to backfill. Better
        // to have a working config.worktree than a half-cleaned tree.
      }
    }

    report.push(backfillEntry(entryDir, opts));
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ commonDir, worktreeDir, dryRun: opts.dryRun, cleanup: opts.cleanup, entries: report }, null, 2) + '\n');
  } else {
    for (const row of report) {
      if (row.note) { process.stdout.write(`${row.note}\n`); continue; }
      process.stdout.write(`${row.name}: ${row.action}` + (row.branch ? ` (branch=${row.branch})` : '') + '\n');
    }
    const wrote = report.filter((r) => r.action === 'wrote').length;
    const already = report.filter((r) => r.action === 'already-configured').length;
    const removed = report.filter((r) => r.action === 'removed' || r.action === 'would-remove').length;
    const kept = report.filter((r) => r.action === 'kept-locked').length;
    process.stdout.write(`\nSummary: wrote=${wrote} already-configured=${already} removed=${removed} kept-locked=${kept} dry-run=${opts.dryRun}\n`);
  }
  return 0;
}

const HELP = `Usage: node tools/backfill-worktree-configs.js [options]

  --repo <path>    Repo to target (default: current directory).
  --dry-run        Report only; do not touch disk.
  --cleanup        Remove leftover worktrees whose branch has been merged into
                   the base AND (when gh is available) whose PR is closed.
                   Locked entries are always kept.
  --base <ref>     Merge target for the cleanup check (default: master).
  --json           Machine-readable output.
  -h, --help       This message.
`;

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  parseArgs,
  resolveCommonDir,
  readCoreBare,
  readGitdirTarget,
  isLocked,
  readHeadBranch,
  backfillEntry,
  main,
  BODY,
};
