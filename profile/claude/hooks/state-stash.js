#!/usr/bin/env node
// Shared state-stash hook: one capture path for every "context is about to be
// lost" boundary. Wired to BOTH PreCompact and SessionEnd — closing a session
// and compacting one need the same thing: snapshot what is done or missed,
// durably, before the window that knows about it goes away.
//
// Always exits 0 — never blocks. Snapshots tracked WIP via `git stash create`
// (working tree, index, and stash list untouched), anchors it under
// refs/rescue/, and writes a state file for state-rehydrate.js to re-inject.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

// Profile-aware: under `claude-personal` (CLAUDE_CONFIG_DIR set) state and the
// miner's credentials come from that profile, not the default ~/.claude.
const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

const RESCUE_PREFIX = 'refs/rescue/';
const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MINE_TAIL_CHARS = 50000;
const MINE_TIMEOUT_MS = 90000;

// Belt to the --settings suspenders: a miner child must never stash/mine again.
if (process.env.STATE_STASH_CHILD === '1') process.exit(0);

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000,
    }).trim();
  } catch {
    return null;
  }
}

// Rescue refs end in -<epoch ms>; drop refs past PRUNE_AFTER_MS so unattended
// sessions do not accumulate them forever.
function pruneRescueRefs(cwd) {
  const out = git(`for-each-ref --format="%(refname)" ${RESCUE_PREFIX}`, cwd);
  if (!out) return;
  for (const ref of out.split('\n')) {
    const ms = Number((ref.match(/-(\d{13})$/) || [])[1]);
    if (ms && Date.now() - ms > PRUNE_AFTER_MS) git(`update-ref -d ${ref}`, cwd);
  }
}

// Pull readable text out of a transcript jsonl tail: role-tagged text blocks,
// newest last, capped at MINE_TAIL_CHARS.
function transcriptTail(transcriptPath) {
  let raw;
  try { raw = fs.readFileSync(transcriptPath, 'utf8'); } catch { return null; }
  const pieces = [];
  for (const line of raw.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const m = e && e.message;
    if (!m || !m.role || !Array.isArray(m.content)) continue;
    const texts = m.content
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text.trim())
      .filter(Boolean);
    if (texts.length) pieces.push(`[${m.role}] ${texts.join('\n')}`);
  }
  if (!pieces.length) return null;
  let tail = pieces.join('\n---\n');
  if (tail.length > MINE_TAIL_CHARS) tail = tail.slice(-MINE_TAIL_CHARS);
  return tail;
}

// SessionEnd only: mine the conversation into a handoff-shaped digest via a
// hookless, toolless, session-persistence-free headless call. Compaction
// already mines itself, so PreCompact skips this. Any failure returns null —
// the git stash above is never held hostage by the miner.
function mineTranscript(transcriptPath) {
  const tail = transcriptTail(transcriptPath);
  if (!tail) return null;
  const prompt = [
    'You are mining a finished coding session for a handoff digest.',
    'From the transcript below, report in plain text, under 250 words:',
    '1. What was accomplished (verified facts only).',
    '2. Unfinished or interrupted work.',
    '3. Decisions made and their reasons.',
    '4. Explicit next steps or warnings for the next session.',
    'No preamble. Skip sections with nothing to report.',
    '', '--- TRANSCRIPT TAIL ---', tail,
  ].join('\n');
  // The child MUST run under an isolated CLAUDE_CONFIG_DIR. Measured without
  // it: the child inherits hooks + governance config, spends ~23 turns trying
  // to satisfy them with every tool denied, and returns result:"" at ~7x the
  // cost. Isolation gets 1 turn, ~5s. Credentials are copied fresh each run.
  const minerHome = path.join(CONFIG_DIR, 'hook-state', 'miner-home');
  const promptFile = path.join(minerHome, 'prompt.txt');
  try {
    fs.mkdirSync(minerHome, { recursive: true });
    fs.copyFileSync(
      path.join(CONFIG_DIR, '.credentials.json'),
      path.join(minerHome, '.credentials.json')
    );
    fs.writeFileSync(path.join(minerHome, 'settings.json'), '{}');
    fs.writeFileSync(promptFile, prompt);
  } catch { return null; }
  try {
    const out = execSync(
      `claude -p --model haiku --strict-mcp-config --no-session-persistence --output-format json < "${promptFile}"`,
      {
        encoding: 'utf8',
        timeout: MINE_TIMEOUT_MS,
        env: { ...process.env, CLAUDE_CONFIG_DIR: minerHome, STATE_STASH_CHILD: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    ).trim();
    const parsed = JSON.parse(out);
    if (!parsed || parsed.is_error !== false || typeof parsed.result !== 'string') return null;
    // Global CLAUDE.md still loads (it lives under homedir, not the config
    // dir), so the reply may open with the mandated ```diff pylons fence.
    const digest = parsed.result.replace(/^```diff\n[^\n]*\n```\s*/u, '').trim();
    return digest || null;
  } catch {
    return null;
  } finally {
    try { fs.unlinkSync(promptFile); } catch {}
  }
}

function pruneStateFiles(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > PRUNE_AFTER_MS) fs.unlinkSync(f);
    } catch {}
  }
}

let input = {};
try { input = JSON.parse(readStdin() || '{}'); } catch { /* stash what we can */ }

const sessionId = String(input.session_id || 'unknown').replace(/[^A-Za-z0-9-]/g, '');
const cwd = input.cwd || process.cwd();
const event = (input.hook_event_name === 'SessionEnd') ? 'sessionend' : 'precompact';
const stateDir = path.join(CONFIG_DIR, 'hook-state', 'compact-stash');
try { fs.mkdirSync(stateDir, { recursive: true }); } catch {}

const state = {
  stashed_at: new Date().toISOString(),
  event,
  session_id: sessionId,
  cwd,
  transcript_path: input.transcript_path || null,
  trigger: input.trigger || null,
  git: null,
};

if (git('rev-parse --is-inside-work-tree', cwd) === 'true') {
  const branch = git('rev-parse --abbrev-ref HEAD', cwd);
  const status = git('status --porcelain', cwd);
  const lastCommits = git('log --oneline -5', cwd);
  const upstream = git('rev-parse --abbrev-ref @{upstream}', cwd);
  const unpushed = upstream ? git('rev-list --count @{upstream}..HEAD', cwd) : null;
  let rescueRef = null;
  if (status) {
    const stashCommit = git('stash create rescue-snapshot', cwd);
    if (stashCommit) {
      rescueRef = `${RESCUE_PREFIX}${event}-${sessionId.slice(0, 8)}-${Date.now()}`;
      git(`update-ref ${rescueRef} ${stashCommit}`, cwd);
    }
  }
  pruneRescueRefs(cwd);
  state.git = {
    branch,
    status_porcelain: status,
    last_commits: lastCommits,
    unpushed_commits: unpushed,
    rescue_ref: rescueRef,
    rescue_note: rescueRef
      ? 'tracked changes only; untracked files stay on disk and are listed as ?? above'
      : null,
  };
}

state.mined_summary = (event === 'sessionend' && state.transcript_path)
  ? mineTranscript(state.transcript_path)
  : null;

try {
  fs.writeFileSync(path.join(stateDir, `${sessionId}.json`), JSON.stringify(state, null, 2));
} catch {}
pruneStateFiles(stateDir);
process.exit(0);
