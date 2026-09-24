'use strict';

/**
 * Cloud-container bootstrap check (issue 163, spec #207 user story 7).
 *
 * The bootstrap SessionStart hook writes a marker file naming the plugin payload version and
 * skills it installed. This module asks:
 *
 *   - is the marker present at all? (STOP: hook never ran)
 *   - was the marker written before this container booted? (the hook did not run in THIS
 *     session: the marker, the skills and the seated governance hooks are whatever the container
 *     image carried. Issue 643: a Routine-fired session read a two-day-old clone-failure marker
 *     and reported nothing, because a hook that never runs writes nothing either)
 *   - does the marker record a failed stage? (STOP naming the stage and cause: the hook ran and
 *     could not clone dotfiles or find the payload — issue 483; before this the hook died under
 *     set -e with nothing written and the only signal was "marker absent")
 *   - does the marker name a skills directory that actually still holds those skills? (STOP:
 *     the skills tree was wiped or never copied)
 *   - is the payload version the marker records the same as what dotfiles master offers today?
 *     (a WARNING naming both versions and the skills whose revision differs, issue 703 — not a
 *     stop: re-running the bootstrap takes master)
 *
 * The marker lives at ~/.claude/hook-state/aac-bootstrap/state.json; a bootstrap that ran
 * anywhere in this container writes it. Env overrides are for tests only.
 *
 *   BOOTSTRAP_MARKER_FILE      absolute path to the marker file
 *   BOOTSTRAP_SKILLS_DIR       absolute path to the skills tree the marker names
 *   BOOTSTRAP_MASTER_MANIFEST  absolute path to a plugin.json to compare the marker's version
 *                              against (in real runs the check fetches this from git; the env
 *                              override lets a test pin it)
 *
 * Exports:
 *   readMarker(env)              -> { state: 'ok' | 'missing' | 'unreadable' | 'failed' | 'stale',
 *                                      marker?, path, reason?, stage?, writtenAt?, bootedAt? }
 *   verifySkills(marker, env)    -> { state: 'ok' | 'skills-missing', missing: [name] }
 *   compareToMaster(marker, env) -> { state: 'same' | 'drift' | 'unknown', master?, marker?,
 *                                      stale?: [{ name, local, master }] | null }
 *   verifyPluginRoot(marker)     -> { state: 'ok' | 'absent' | 'unrecorded', root? }
 *   verifySelfHook(marker)       -> { state: 'ok' | 'absent' | 'not-executable' | 'unrecorded', hook? }
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANIFEST_IN_REPO = 'marketplace/aac-skills/.claude-plugin/plugin.json';

// A session start waits on this, so it is bounded and never throws: a git that hangs, fails or is
// absent is 'could not read', not a broken check.
function execGit(command, args) {
  try {
    const stdout = execFileSync(command, args, {
      encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status == null ? 1 : e.status, stdout: '' };
  }
}

function markerPath(env) {
  return env.BOOTSTRAP_MARKER_FILE
    || path.join(env.HOME || os.homedir(), '.claude', 'hook-state', 'aac-bootstrap', 'state.json');
}

function skillsDir(env) {
  return env.BOOTSTRAP_SKILLS_DIR
    || path.join(env.HOME || os.homedir(), '.claude', 'skills');
}

/**
 * When this container booted, as an ISO string and epoch ms. A cloud container's home is
 * restored from a snapshot, so a marker older than the boot is one the image carried: the
 * bootstrap hook did not run in this session (issue 643).
 */
function containerBootedAt() {
  const ms = Date.now() - os.uptime() * 1000;
  return { ms, iso: new Date(ms).toISOString() };
}

function readMarker(env) {
  const p = markerPath(env);
  if (!fs.existsSync(p)) return { state: 'missing', path: p };
  try {
    const marker = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (marker && typeof marker === 'object' && marker.failed === true) {
      return {
        state: 'failed',
        marker,
        path: p,
        stage: String(marker.stage || 'unknown stage'),
        reason: String(marker.reason || 'no reason recorded'),
      };
    }
    if (!marker || typeof marker !== 'object' || !Array.isArray(marker.skills)) {
      return { state: 'unreadable', path: p, reason: 'marker JSON has no `skills` array' };
    }
    // Written before this container booted: whatever the image held, not what this session
    // installed. The grace second covers a marker written while the clock was still settling.
    const boot = containerBootedAt();
    const written = Date.parse(marker.installed_at || '');
    if (Number.isFinite(written) && written < boot.ms - 1000) {
      return {
        state: 'stale', marker, path: p,
        writtenAt: marker.installed_at, bootedAt: boot.iso,
      };
    }
    return { state: 'ok', marker, path: p };
  } catch (e) {
    return { state: 'unreadable', path: p, reason: e.message };
  }
}

function verifySkills(marker, env) {
  const dir = skillsDir(env);
  const missing = [];
  for (const name of marker.skills || []) {
    const skillDir = path.join(dir, name);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) missing.push(name);
  }
  return missing.length ? { state: 'skills-missing', missing } : { state: 'ok', missing: [] };
}

/**
 * Compare the marker's payload_version to what master offers today.
 *
 * "Today" has to come off the REMOTE. The version used to be read from the manifest inside the
 * bootstrap's own clone — the very tree the payload was cut from — so the answer was 'same' by
 * construction and the line "payload matches dotfiles master" could never be false. Seen
 * 2026-09-21: the clone was 11 commits behind master, the payload was missing a skill
 * description that had merged 10 minutes before the session opened, and the check reported a
 * match. A shallow `git fetch` of the ref, then `git show <ref>:…plugin.json`, reads the version
 * master actually offers; the clone's own manifest is never a fallback, because its answer is
 * the bug. No remote, no answer: 'unknown', which check.js already prints honestly.
 *
 * `run` is injected for tests; in a real session it is a bounded execFileSync.
 */
function gitVersionAtRemote(clone, ref, run) {
  const git = (...args) => run('git', ['-C', clone, ...args]);
  if (git('fetch', '--depth', '1', 'origin', ref).status !== 0) return null;
  const shown = git('show', `FETCH_HEAD:${MANIFEST_IN_REPO}`);
  if (shown.status !== 0) return null;
  const version = JSON.parse(shown.stdout).version;
  return version || null;
}

const SKILLS_IN_REPO = 'marketplace/aac-skills/skills';

function skillRevision(text) {
  const m = /^\s*revision:\s*['"]?(\d+)['"]?\s*$/m.exec(text || '');
  return m ? m[1] : null;
}

/**
 * Which installed skills differ from the ones master offers (issue 703: a Routine's Skill tool
 * served todoist-triage revision 8 while master had 17). Run straight after the fetch in
 * gitVersionAtRemote, so FETCH_HEAD is master's tree. A skill whose `revision` stamp differs
 * from the installed copy's, or that master has and this container lacks, is one the Skill tool
 * would serve stale. Entries are { name, local, master }, `local` null when absent. Null when
 * master's skill list cannot be read.
 */
function staleSkillsAtRemote(clone, localSkills, run) {
  const git = (...args) => run('git', ['-C', clone, ...args]);
  const listed = git('ls-tree', '--name-only', `FETCH_HEAD:${SKILLS_IN_REPO}`);
  if (listed.status !== 0) return null;
  const stale = [];
  for (const name of listed.stdout.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const shown = git('show', `FETCH_HEAD:${SKILLS_IN_REPO}/${name}/SKILL.md`);
    if (shown.status !== 0) continue;
    const master = skillRevision(shown.stdout);
    let local = null;
    try {
      local = skillRevision(fs.readFileSync(path.join(localSkills, name, 'SKILL.md'), 'utf8'));
    } catch { /* not installed */ }
    if (local !== master) stale.push({ name, local, master });
  }
  return stale;
}

function compareToMaster(marker, env, run = execGit) {
  const unknown = (reason) => ({ state: 'unknown', marker: marker.payload_version, reason });
  let master = null;
  let clone = null;
  try {
    if (env.BOOTSTRAP_MASTER_MANIFEST) {
      if (!fs.existsSync(env.BOOTSTRAP_MASTER_MANIFEST)) return unknown('no manifest to read');
      master = JSON.parse(fs.readFileSync(env.BOOTSTRAP_MASTER_MANIFEST, 'utf8')).version || null;
    } else {
      clone = path.join(env.HOME || os.homedir(), '.aac-dotfiles');
      if (!fs.existsSync(path.join(clone, '.git'))) return unknown('no dotfiles clone to fetch in');
      master = gitVersionAtRemote(clone, env.BOOTSTRAP_DOTFILES_REF || 'master', run);
    }
  } catch (e) {
    return unknown(e.message);
  }
  if (!master) return unknown('master version could not be read from the remote');
  if (master === marker.payload_version) return { state: 'same', master, marker: marker.payload_version };
  const drift = { state: 'drift', master, marker: marker.payload_version };
  if (clone) {
    try { drift.stale = staleSkillsAtRemote(clone, skillsDir(env), run); } catch { /* unlisted */ }
  }
  return drift;
}

/**
 * The seat the governance hooks were merged for (harness v30, issue 614). The bootstrap rewrites
 * every `${CLAUDE_PLUGIN_ROOT}` in the payload's hook commands to the payload's absolute path
 * and records that path as `plugin_root`; settings.json entries then name scripts under it, and
 * a payload that has since moved or been deleted leaves every governance hook failing on a path.
 * A marker without the key is from a pre-v30 hook, whose merged entries could not run at all.
 */
function verifyPluginRoot(marker) {
  const root = marker && typeof marker.plugin_root === 'string' ? marker.plugin_root : '';
  if (!root) return { state: 'unrecorded' };
  return fs.existsSync(path.join(root, 'hooks', 'scripts'))
    ? { state: 'ok', root }
    : { state: 'absent', root };
}

/**
 * The home-anchored seat (harness v31, issue 643). The bootstrap copies itself to
 * ~/.claude/hooks/aac-bootstrap.sh, records that path as `self_hook`, and registers it as a
 * SessionStart entry in user settings — the only entry a session whose project dir is not a
 * harnessed repo ever reaches. A recorded path that is gone, or not executable, means the next
 * such session bootstraps nothing and reads the image's state instead.
 */
function verifySelfHook(marker) {
  const hook = marker && typeof marker.self_hook === 'string' ? marker.self_hook : '';
  if (!hook) return { state: 'unrecorded' };
  if (!fs.existsSync(hook)) return { state: 'absent', hook };
  try {
    fs.accessSync(hook, fs.constants.X_OK);
  } catch {
    return { state: 'not-executable', hook };
  }
  return { state: 'ok', hook };
}

module.exports = {
  readMarker, verifySkills, compareToMaster, verifyPluginRoot, verifySelfHook,
  staleSkillsAtRemote, markerPath, skillsDir, containerBootedAt, execGit,
};
