#!/usr/bin/env node
// SessionStart hook — loads THIS REPO's committed memory notes (issue 210).
//
// WHY: per-project memory used to live only under ~/.claude/projects/<slug>/memory on one PC and
// travel to the repo as the generated memory/ mirror. A cloud container has no such home, so a
// cloud session started with no memory at all, and a note written in one place could never reach
// the other. The notes now live in the repo (docs/agents/memory/<name>.md, index MEMORY.md) and
// this hook reads the index of whichever repo the session opened. A note is published by an
// ordinary commit; the next session — anywhere — reads it from the index.
//
// Injects POINTERS, not content: one line per note, capped at 2KB total, so the note bodies stay
// on disk and only the "there is a note about X" cue reaches the context window. A session that
// wants the detail reads the file.
//
// Contract: reads the hook JSON on stdin (for `cwd`), writes one additionalContext JSON to stdout,
// and ALWAYS exits 0. A repo with no docs/agents/memory/MEMORY.md prints nothing. A session start
// must never fail because the memory index is missing, unreadable or malformed.
'use strict';

const fs = require('fs');
const path = require('path');

const INDEX_RELATIVE = path.join('docs', 'agents', 'memory', 'MEMORY.md');
const BUDGET = Number(process.env.REPO_MEMORY_BUDGET || 2048);
const MAX_WALK_UP = 12;

// The session's directory may be a subdirectory of the checkout (or a worktree), so walk up until
// the index shows up. The index file itself is the marker: no dependence on .git, which a worktree
// carries as a file and a tarball export not at all.
function findIndex(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < MAX_WALK_UP; i += 1) {
    const candidate = path.join(dir, INDEX_RELATIVE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function indexLines(text) {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') && line.length > 2);
}

// Note files present on disk but missing from the index. A session that adds a note and forgets
// the index line would otherwise be invisible to the next session; one line names them instead.
function unindexed(indexPath, lines) {
  // Two index line shapes are in use: `- name: hook` (this repo) and the auto-memory
  // `- [Title](name.md) — hook` (every other repo's index). Both name the file.
  const named = new Set(lines.map((line) => {
    const link = line.match(/\]\(([^)]+?)(?:\.md)?\)/);
    return link ? link[1].trim() : line.slice(2).split(':')[0].trim();
  }));
  let entries;
  try {
    entries = fs.readdirSync(path.dirname(indexPath));
  } catch (e) {
    return [];
  }
  return entries
    .filter((name) => name.endsWith('.md') && name !== 'MEMORY.md')
    .map((name) => name.slice(0, -3))
    .filter((name) => !named.has(name))
    .sort();
}

function build(indexPath, lines, missing, repoRoot) {
  const dir = path.relative(repoRoot, path.dirname(indexPath)).split(path.sep).join('/');
  const head = `${path.basename(repoRoot)} memory — ${lines.length} committed notes, `
    + `bodies in ${dir}/<name>.md. Add one there, add its index line, commit: that commit `
    + 'is the whole publish, there is no ~/.claude copy to keep in step.';
  const out = [head];
  let used = Buffer.byteLength(head) + 1;
  let dropped = 0;
  for (const line of lines) {
    const cost = Buffer.byteLength(line) + 1;
    // Keep room for the "+N more" tail so a truncated list never lies about being complete.
    if (used + cost > BUDGET - 80) { dropped += 1; continue; }
    out.push(line);
    used += cost;
  }
  if (dropped > 0) out.push(`- (+${dropped} more — read ${dir}/MEMORY.md)`);
  if (missing.length > 0) {
    const tail = `- not in the index yet: ${missing.join(', ')}`;
    if (used + Buffer.byteLength(tail) + 1 <= BUDGET) out.push(tail);
  }
  return out.join('\n');
}

function contextFor(startDir) {
  const indexPath = findIndex(startDir);
  if (!indexPath) return null;
  let text;
  try {
    text = fs.readFileSync(indexPath, 'utf8');
  } catch (e) {
    return null;
  }
  const lines = indexLines(text);
  if (lines.length === 0) return null;
  // The repo root is whatever the index path is INDEX_RELATIVE below, so the depth stays derived
  // from the one constant rather than a hand-counted run of '..'.
  const repoRoot = indexPath.slice(0, indexPath.length - INDEX_RELATIVE.length - 1);
  return build(indexPath, lines, unindexed(indexPath, lines), repoRoot);
}

function emit(startDir) {
  let context = null;
  try {
    context = contextFor(startDir);
  } catch (e) {
    context = null; // a session start never fails over memory
  }
  if (!context) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  }));
}

function startDirFrom(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.cwd === 'string' && parsed.cwd) return parsed.cwd;
  } catch (e) {
    // no stdin, or not JSON: the process cwd is the session's directory anyway
  }
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

if (require.main === module) {
  let buf = '';
  process.stdin.on('data', (c) => { buf += c; });
  process.stdin.on('end', () => { emit(startDirFrom(buf)); process.exit(0); });
  process.stdin.on('error', () => { emit(startDirFrom('')); process.exit(0); });
  // The host may hand us nothing and never close stdin — do not hang the session start.
  setTimeout(() => { emit(startDirFrom(buf)); process.exit(0); }, 2000).unref();
}

module.exports = { contextFor, indexLines, unindexed };
