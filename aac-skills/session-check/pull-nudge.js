'use strict';

/**
 * Whether the desktop has pulled a commit that touched a path `sync.ps1 -Mode pull` still
 * writes (issue 735, claude-dotfiles).
 *
 * Before this, the session check said nothing about pulling and the owner ran
 * `.\sync.ps1 -Mode pull` on habit — and still missed changes, because a merge that only moved
 * plugin-carried content (a skill, a hook the plugin now serves) needs no pull at all (issues
 * 732-734 shrank the whitelist to exactly the files a pull still installs). The fix is a targeted
 * nudge: `sync.ps1 -Mode pull` records the commit it installed from (`writeStamp`, called from
 * PowerShell — see sync.ps1's `Write-PullStamp`), and this module compares that commit with the
 * default branch's head, restricted to the paths `lib/manifest.ps1`'s `Get-DotfileItems` still
 * names. A merge outside that list moves the comparison forward with nothing to report.
 *
 * States `evaluate` can return:
 *   'no-stamp'     this machine has never recorded a pull — nothing to compare against
 *   'clean'        no commit since the stamp touched a whitelisted path (or none merged at all)
 *   'needs-pull'   at least one commit since the stamp touched a whitelisted path
 *
 * Pure logic only — `readStamp`/`writeStamp` are the one bit of file I/O, isolated so a test can
 * point `DOTFILES_PULL_STATE` at a scratch file instead of the real machine state. Getting the
 * changed-file list and the default branch head is check.js's job, the same way it already runs
 * git for every other check; this module never spawns a process.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const STATE_FILE = process.env.DOTFILES_PULL_STATE
  || path.join(os.homedir(), '.claude', 'hook-state', 'dotfiles-pull', 'state.json');

/** `{ sha, pulledAt }` from the last recorded pull, or null when none exists yet or the file is
 *  unreadable — both read as "no stamp", never as an error to throw. */
function readStamp(file) {
  const target = file || STATE_FILE;
  if (!fs.existsSync(target)) return null;
  try {
    // sync.ps1 writes the stamp with PowerShell 5.1's `Set-Content -Encoding UTF8`, which prefixes a BOM.
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
    return (parsed && typeof parsed.sha === 'string' && parsed.sha) ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** Record `sha` as the commit this pull installed from. Exported for tests and for a JS caller;
 *  the real writer is `sync.ps1`'s `Write-PullStamp`, which writes the same shape by hand so a
 *  desktop with no node on PATH still gets a stamp. */
function writeStamp(sha, file) {
  const target = file || STATE_FILE;
  const stamp = { sha, pulledAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

/** The `Repo = '...'` paths named inside `lib/manifest.ps1`'s `Get-DotfileItems` function — the
 *  same whitelist `sync.ps1 -Mode pull` writes, read rather than restated so the two cannot drift
 *  apart. Bounded to that one function's body: a `Repo = '...'` elsewhere in the file (there is
 *  none today) would otherwise silently widen the whitelist this module enforces. */
function parseWhitelist(text) {
  const block = /function Get-DotfileItems\b[\s\S]*?\n\}/.exec(String(text || ''));
  if (!block) return { error: 'no function Get-DotfileItems { ... } block found' };
  const paths = [];
  const re = /Repo\s*=\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block[0])) !== null) paths.push(m[1]);
  if (!paths.length) return { error: 'Get-DotfileItems names no Repo paths' };
  return { paths };
}

/** Whether `file` (a repo-relative path, forward slashes, as `git diff --name-only` prints it) is
 *  on the whitelist — either the exact path (a `File` entry) or under it (a `Dir` entry, e.g.
 *  `profile/claude/agents/new-agent.md` under `profile/claude/agents`). */
function matchesWhitelist(file, whitelist) {
  return (whitelist || []).some((w) => file === w || file.startsWith(w.endsWith('/') ? w : `${w}/`));
}

/** `stampSha` is the commit the last pull installed from (or null/undefined — no stamp yet).
 *  `changedFiles` is `git diff --name-only stampSha..head`, already computed by the caller. */
function evaluate(stampSha, changedFiles, whitelist) {
  if (!stampSha) return { state: 'no-stamp' };
  const files = (changedFiles || []).filter((f) => matchesWhitelist(f, whitelist));
  if (!files.length) return { state: 'clean' };
  return { state: 'needs-pull', files };
}

module.exports = { STATE_FILE, readStamp, writeStamp, parseWhitelist, matchesWhitelist, evaluate };
