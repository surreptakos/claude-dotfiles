'use strict';

/**
 * Cloud-container bootstrap check (issue 163, spec #207 user story 7).
 *
 * The bootstrap SessionStart hook writes a marker file naming the plugin payload version and
 * skills it installed. This module asks:
 *
 *   - is the marker present at all? (STOP: hook never ran)
 *   - does the marker record a failed stage? (STOP naming the stage and cause: the hook ran and
 *     could not clone dotfiles or find the payload — issue 483; before this the hook died under
 *     set -e with nothing written and the only signal was "marker absent")
 *   - does the marker name a skills directory that actually still holds those skills? (STOP:
 *     the skills tree was wiped or never copied)
 *   - is the payload version the marker records the same as what dotfiles master offers today?
 *     (informational: "on v2026.9.151521, master v2026.9.161010" — a drift is not a stop, the
 *     next session will re-clone)
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
 *   readMarker(env)              -> { state: 'ok' | 'missing' | 'unreadable' | 'failed', marker?, path,
 *                                      reason?, stage? }
 *   verifySkills(marker, env)    -> { state: 'ok' | 'skills-missing', missing: [name] }
 *   compareToMaster(marker, env) -> { state: 'same' | 'drift' | 'unknown', master?, marker? }
 *   verifyPluginRoot(marker)     -> { state: 'ok' | 'absent' | 'unrecorded', root? }
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function markerPath(env) {
  return env.BOOTSTRAP_MARKER_FILE
    || path.join(env.HOME || os.homedir(), '.claude', 'hook-state', 'aac-bootstrap', 'state.json');
}

function skillsDir(env) {
  return env.BOOTSTRAP_SKILLS_DIR
    || path.join(env.HOME || os.homedir(), '.claude', 'skills');
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
 * Compare the marker's payload_version to what master offers today. The manifest lives in the
 * clone the bootstrap made under ~/.aac-dotfiles; the test override points to another file.
 * A missing manifest is 'unknown', not 'drift' — the answer requires evidence.
 */
function compareToMaster(marker, env) {
  const manifest = env.BOOTSTRAP_MASTER_MANIFEST
    || path.join(env.HOME || os.homedir(), '.aac-dotfiles', 'marketplace', 'aac-skills',
                 '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(manifest)) return { state: 'unknown', marker: marker.payload_version };
  try {
    const master = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    if (!master) return { state: 'unknown', marker: marker.payload_version };
    return master === marker.payload_version
      ? { state: 'same', master, marker: marker.payload_version }
      : { state: 'drift', master, marker: marker.payload_version };
  } catch (e) {
    return { state: 'unknown', marker: marker.payload_version, reason: e.message };
  }
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

module.exports = { readMarker, verifySkills, compareToMaster, verifyPluginRoot, markerPath, skillsDir };
