#!/usr/bin/env node
// Empties the PC's per-project memory directory for THIS repo down to a pointer file (issue 210).
//
// WHY: the notes are committed now (docs/agents/memory/, index MEMORY.md) and the plugin's
// SessionStart hook reads them from the checkout. The old copy under
// ~/.claude/projects/<slug carrying -claude-dotfiles>/memory is no longer carried by sync.ps1 (see
// Get-MemoryItems in lib/manifest.ps1), so leaving notes there would create a second, invisible
// copy of the same memory that drifts against the repo. Two copies cannot diverge if only one of
// them exists.
//
// Both sync modes call this, so the emptying lands on the owner's next push or pull rather than
// waiting for anyone to run a one-off command by hand. Nothing is deleted before it is archived:
// every file it removes is copied into a backup directory first, and the run prints where. Safe to
// run repeatedly - a directory that already holds only the pointer is left untouched.
//
// Usage: node tools/repo-memory-pointer.js [--home <dir>] [--backup <dir>] [--dry-run] [--quiet]
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Anywhere in the slug, not only at the end: an agent worktree of this repo slugs as
// `<checkout path>--claude-worktrees-<id>` and its memory is just as much a second copy.
const SLUG_MARKER = '-claude-dotfiles';
const POINTER_NAME = 'MEMORY.md';
const POINTER_TEXT = `# Moved into the repo (issue 210)

The claude-dotfiles memory notes are committed in the repo, one file per note under
\`docs/agents/memory/\` with \`MEMORY.md\` as the index. The aac-skills plugin's SessionStart hook
(\`hooks/scripts/repo-memory-load.js\`) injects that index in every session, on every surface, from
whichever checkout the session opened.

Do not write notes here. \`sync.ps1\` no longer carries this directory, so a note left here reaches
no other machine and no cloud session, and the next sync archives and removes it. Write the note at
\`docs/agents/memory/<name>.md\` in the repo, add its index line, and commit — that commit is the
whole publish.
`;

function parseArgs(argv) {
  const opts = { home: os.homedir(), homeExplicit: false, backup: null, dryRun: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--home') {
      opts.home = argv[i + 1]; opts.homeExplicit = true; i += 1;
    } else if (arg === '--backup') {
      opts.backup = argv[i + 1]; i += 1;
    } else if (arg === '--dry-run') { opts.dryRun = true; } else if (arg === '--quiet') {
      opts.quiet = true;
    }
  }
  return opts;
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function stamp(now) {
  return now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
}

// One directory: archive everything that is not already the pointer, delete it, write the pointer.
// Returns the log lines for this directory (empty when there was nothing to do).
function applyOne(memoryDir, slug, opts, backupRoot) {
  const files = listFiles(memoryDir);
  const pointer = path.join(memoryDir, POINTER_NAME);
  const pointerCurrent = fs.existsSync(pointer)
    && fs.readFileSync(pointer, 'utf8') === POINTER_TEXT;
  // The old index lives at the pointer's own path, so it is archived like any other note rather
  // than silently overwritten; only a pointer file that is already current stays put.
  const stale = files.filter((f) => !(f === pointer && pointerCurrent));
  if (stale.length === 0 && pointerCurrent) return [];

  const lines = [];
  if (stale.length > 0) {
    const dest = path.join(backupRoot, slug);
    for (const file of stale) {
      const relative = path.relative(memoryDir, file);
      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(path.join(dest, relative)), { recursive: true });
        fs.copyFileSync(file, path.join(dest, relative));
        fs.rmSync(file);
      }
    }
    lines.push(`${opts.dryRun ? 'would archive' : 'archived'} ${stale.length} note(s) from `
      + `${memoryDir} to ${dest}`);
  }
  if (!opts.dryRun) {
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(pointer, POINTER_TEXT);
  }
  lines.push(`${opts.dryRun ? 'would point' : 'pointed'} ${pointer} at docs/agents/memory/`);
  return lines;
}

function run(opts) {
  // sync.ps1 passes the home it is syncing (`--home $UserHome`) and addresses `<home>\.claude`
  // directly, so an explicit --home wins over CLAUDE_CONFIG_DIR; without one, an account running
  // under a redirected config dir is still handled.
  const configDir = (!opts.homeExplicit && process.env.CLAUDE_CONFIG_DIR)
    || path.join(opts.home, '.claude');
  const projects = path.join(configDir, 'projects');
  const backupRoot = opts.backup
    || path.join(opts.home, `.claude-dotfiles-backup-repo-memory-${stamp(new Date())}`);
  const lines = [];
  let entries = [];
  try {
    entries = fs.readdirSync(projects, { withFileTypes: true });
  } catch (e) {
    return lines; // no projects directory: nothing to do, and that is not an error
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.toLowerCase().includes(SLUG_MARKER)) continue;
    const memoryDir = path.join(projects, entry.name, 'memory');
    if (!fs.existsSync(memoryDir)) continue;
    lines.push(...applyOne(memoryDir, entry.name, opts, backupRoot));
  }
  return lines;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const lines = run(opts);
  if (!opts.quiet) for (const line of lines) process.stdout.write(`repo-memory: ${line}\n`);
  process.exit(0);
}

module.exports = { run, parseArgs, POINTER_TEXT, POINTER_NAME, SLUG_MARKER };
