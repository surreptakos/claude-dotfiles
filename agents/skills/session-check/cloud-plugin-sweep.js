#!/usr/bin/env node
/**
 * Cloud skill sweep — do the skills on this machine still match the plugin uploaded to claude.ai?
 *
 *   node cloud-plugin-sweep.js            # human report; exit 0 in sync, 1 drift, 2 cannot check
 *   node cloud-plugin-sweep.js --json     # same finding as JSON, for session-check
 *   node cloud-plugin-sweep.js --stamp    # record the current tree as the uploaded one
 *   node cloud-plugin-sweep.js --stamp --accounts a@x.com,b@y.com   # ...to these accounts only
 *
 * WHY IT EXISTS
 * Claude Code cloud containers never read ~/.claude/skills. They load what the claude.ai account
 * has enabled, and an uploaded plugin is a SNAPSHOT: claude.ai keeps its own copy, so a skill
 * edited or added here does not reach a cloud session until the zip is rebuilt and re-uploaded.
 * Nothing in the product says the copy went stale — this does.
 *
 * WHAT IT COMPARES
 * A fingerprint of every file the packager would ship (~/.claude/skills, dead junctions resolved
 * through ~/.agents/skills, backups and VCS noise excluded) plus the packager itself, against the
 * fingerprint written by the last `--stamp`. The packager is in the hash on purpose: changing how
 * frontmatter is rewritten changes the uploaded plugin as surely as editing a skill does.
 *
 * Exit 2 is "could not check" — a missing skills tree, an unreadable stamp. It is never a pass.
 *
 * Environment overrides (tests use them; leave them unset in real runs):
 *   CLOUD_PLUGIN_SKILLS_DIR, CLOUD_PLUGIN_FALLBACK_DIR, CLOUD_PLUGIN_STATE, CLOUD_PLUGIN_BUILDER,
 *   CLOUD_PLUGIN_ACCOUNT_DIRS (path-separator list of config dirs to read accounts from)
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const SKILLS_DIR = process.env.CLOUD_PLUGIN_SKILLS_DIR || path.join(HOME, '.claude', 'skills');
const FALLBACK_DIR = process.env.CLOUD_PLUGIN_FALLBACK_DIR || path.join(HOME, '.agents', 'skills');
const STATE_FILE = process.env.CLOUD_PLUGIN_STATE
  || path.join(HOME, '.claude', 'hook-state', 'cloud-plugin', 'state.json');
const BUILDER = process.env.CLOUD_PLUGIN_BUILDER
  || path.join(HOME, 'Claude', 'Projects', 'Meta', 'claude-dotfiles', 'tools', 'build-cloud-plugin.py');
// The AAC team skills ride the same plugin but live in the repo, not ~/.claude/skills. An edit
// there is drift the same as any other; absent dir (another machine) simply contributes nothing.
const AAC_DIR = process.env.CLOUD_PLUGIN_AAC_DIR
  || path.join(HOME, 'Claude', 'Projects', 'Meta', 'claude-dotfiles', 'aac-skills');

// One machine, two signed-in accounts (work and personal), and dan-skills is enabled on both -
// established 2026-08-31 when a work-account session listed dan-skills:* while nothing named
// dan-skills existed on disk. A single stamp therefore cannot answer "is the cloud copy current",
// because an upload to one account leaves the other serving the old snapshot, in that account's
// cloud sessions AND in its desktop skill list. The stamp records which accounts were uploaded to;
// a fingerprint match with an account missing is not a pass.
const ACCOUNT_DIRS = (process.env.CLOUD_PLUGIN_ACCOUNT_DIRS || '')
  ? process.env.CLOUD_PLUGIN_ACCOUNT_DIRS.split(path.delimiter).filter(Boolean)
  : [path.join(HOME, '.claude'), path.join(HOME, '.claude-personal')];

// The default profile is the asymmetric one: CLAUDE_CONFIG_DIR absent resolves ~/.claude.json, a
// SIBLING of ~/.claude, while a named profile keeps its .claude.json inside. Check inside first.
function accountFileFor(dir) {
  const inside = path.join(dir, '.claude.json');
  if (fs.existsSync(inside)) return inside;
  return path.join(path.dirname(dir), '.claude.json');
}

/** Emails of the accounts signed in on this machine. Unreadable or absent files are skipped. */
function discoverAccounts() {
  const found = [];
  for (const dir of ACCOUNT_DIRS) {
    try {
      const file = accountFileFor(dir);
      if (!fs.existsSync(file)) continue;
      const email = (JSON.parse(fs.readFileSync(file, 'utf8')).oauthAccount || {}).emailAddress;
      if (email && !found.includes(email)) found.push(email);
    } catch (e) { /* a profile we cannot read is a profile we cannot claim was uploaded to */ }
  }
  return found;
}

/** Files the packager does not ship. Keep in step with build-cloud-plugin.py's IGNORE. */
const IGNORED_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.pytest_cache']);
const isIgnoredFile = (name) => /\.bak(-|\.|$)/i.test(name) || name === '.DS_Store' || name === 'Thumbs.db';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function hashDir(dir) {
  const parts = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(childAbs, childRel);
      } else if (entry.isFile()) {
        if (isIgnoredFile(entry.name)) continue;
        parts.push(`${childRel}:${sha(fs.readFileSync(childAbs))}`);
      }
    }
  };
  walk(dir, '');
  return sha(parts.join('\n'));
}

/** The skills the packager would ship, in its order, with the same dead-junction fallback. */
function collectSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return null;
  const skills = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    let dir = path.join(SKILLS_DIR, entry.name);
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
      const alt = path.join(FALLBACK_DIR, entry.name);
      if (!fs.existsSync(path.join(alt, 'SKILL.md'))) continue; // packager skips it too
      dir = alt;
    }
    skills.push({ name: entry.name, hash: hashDir(dir) });
  }
  if (fs.existsSync(AAC_DIR)) {
    for (const entry of fs.readdirSync(AAC_DIR, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(AAC_DIR, entry.name);
      if (!fs.existsSync(path.join(dir, 'SKILL.md'))) continue;
      skills.push({ name: `aac/${entry.name}`, hash: hashDir(dir) });
    }
  }
  return skills;
}

function readStamp() {
  if (!fs.existsSync(STATE_FILE)) return null;
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function fingerprint(skills, builderHash) {
  const body = skills.map((s) => `${s.name}\t${s.hash}`).join('\n');
  return sha(`${body}\n--builder--\n${builderHash || 'absent'}`);
}

/** Compare the live tree against the stamp. Never throws — callers get a state, not an exception. */
function sweep() {
  let skills;
  try { skills = collectSkills(); } catch (e) { return { state: 'unknown', reason: e.message }; }
  if (!skills) return { state: 'unknown', reason: `no skills directory at ${SKILLS_DIR}` };

  let builderHash = null;
  try { if (fs.existsSync(BUILDER)) builderHash = sha(fs.readFileSync(BUILDER)); } catch (e) { /* treated as absent */ }

  const now = fingerprint(skills, builderHash);
  let stamp;
  try { stamp = readStamp(); } catch (e) { return { state: 'unknown', reason: `stamp unreadable: ${e.message}`, fingerprint: now, skills }; }
  // A machine with neither a stamp nor the packager never set the cloud plugin up. Silence is the
  // right answer there — a session-end check that nags about a feature you do not use gets ignored,
  // and then so does the one that matters.
  if (!stamp && !builderHash) return { state: 'not-configured', count: skills.length };
  if (!stamp) {
    return { state: 'never-uploaded', fingerprint: now, skills, count: skills.length };
  }
  if (stamp.fingerprint === now) {
    // A stamp written before accounts were tracked names none. Treat that as "the account it was
    // written from", not as "every account is stale" - the alternative renames a long-standing
    // in-sync machine to partial on upgrade and teaches the owner to ignore the check.
    const accounts = discoverAccounts();
    const uploaded = Array.isArray(stamp.accounts) ? stamp.accounts : accounts;
    const missing = accounts.filter((a) => !uploaded.includes(a));
    if (missing.length) {
      return {
        state: 'partial-upload', fingerprint: now, skills, count: skills.length,
        uploadedAt: stamp.uploadedAt, accounts, uploaded, missing,
      };
    }
    return {
      state: 'in-sync', fingerprint: now, skills, count: skills.length,
      uploadedAt: stamp.uploadedAt, accounts, uploaded,
    };
  }

  const before = new Map((stamp.skills || []).map((s) => [s.name, s.hash]));
  const after = new Map(skills.map((s) => [s.name, s.hash]));
  const added = [...after.keys()].filter((n) => !before.has(n));
  const removed = [...before.keys()].filter((n) => !after.has(n));
  const changed = [...after.keys()].filter((n) => before.has(n) && before.get(n) !== after.get(n));
  const builderChanged = (stamp.builderHash || null) !== builderHash;

  return {
    state: 'drift', fingerprint: now, skills, count: skills.length,
    added, removed, changed, builderChanged, uploadedAt: stamp.uploadedAt,
  };
}

function writeStamp(version, accounts) {
  const skills = collectSkills();
  if (!skills) { throw new Error(`no skills directory at ${SKILLS_DIR}`); }
  let builderHash = null;
  if (fs.existsSync(BUILDER)) builderHash = sha(fs.readFileSync(BUILDER));
  const stamp = {
    fingerprint: fingerprint(skills, builderHash),
    builderHash,
    version: version || null,
    uploadedAt: new Date().toISOString(),
    // Defaulting to every discovered account is the honest default only because --stamp is run
    // after a verified upload; naming a subset is how a one-account upload gets recorded truthfully.
    accounts: (accounts && accounts.length) ? accounts : discoverAccounts(),
    count: skills.length,
    skills,
  };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

/** One line per finding, capped — a list of forty skill names is not a report. */
function describe(result) {
  const lines = [];
  const cap = (label, names) => {
    if (!names || !names.length) return;
    const shown = names.slice(0, 5).join(', ');
    lines.push(`${label}: ${shown}${names.length > 5 ? ` ...and ${names.length - 5} more` : ''}`);
  };
  if (result.state === 'not-configured') {
    lines.push('no cloud plugin set up on this machine');
  } else if (result.state === 'in-sync') {
    lines.push(`${result.count} skills match the plugin uploaded ${result.uploadedAt || 'earlier'}`);
    if (result.uploaded && result.uploaded.length > 1) cap('accounts covered', result.uploaded);
  } else if (result.state === 'partial-upload') {
    lines.push(`${result.count} skills match the last upload, but not every account got it`);
    cap('still on the old snapshot', result.missing);
  } else if (result.state === 'never-uploaded') {
    lines.push(`${result.count} skills on this machine, no upload recorded yet`);
  } else if (result.state === 'drift') {
    cap('added', result.added);
    cap('changed', result.changed);
    cap('removed', result.removed);
    if (result.builderChanged) lines.push('the packager itself changed, so every skill repackages');
  } else {
    lines.push(result.reason || 'could not check');
  }
  return lines;
}

const EXIT = {
  'in-sync': 0, 'not-configured': 0,
  drift: 1, 'never-uploaded': 1, 'partial-upload': 1,
  unknown: 2,
};

function main(argv) {
  if (argv.includes('--stamp')) {
    const i = argv.indexOf('--version');
    const a = argv.indexOf('--accounts');
    const accounts = a >= 0 && argv[a + 1] ? argv[a + 1].split(',').map((s) => s.trim()).filter(Boolean) : null;
    const stamp = writeStamp(i >= 0 ? argv[i + 1] : null, accounts);
    if (!argv.includes('--quiet')) {
      const who = stamp.accounts && stamp.accounts.length ? stamp.accounts.join(', ') : 'no account recorded';
      console.log(`stamped ${stamp.count} skills as uploaded (${stamp.fingerprint.slice(0, 12)}) at ${stamp.uploadedAt}`);
      console.log(`  accounts: ${who}`);
    }
    return 0;
  }

  const result = sweep();
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ...result, lines: describe(result) }));
    return EXIT[result.state];
  }
  const headline = {
    'in-sync': 'cloud plugin is current',
    drift: 'cloud plugin is STALE — cloud sessions load the old skills',
    'partial-upload': 'cloud plugin uploaded to some accounts, not all',
    'never-uploaded': 'no upload recorded — cloud sessions may have no skills',
    unknown: 'could not check the cloud plugin',
    'not-configured': 'cloud plugin not set up here',
  }[result.state];
  console.log(headline);
  for (const line of describe(result)) console.log(`  ${line}`);
  if (result.state === 'partial-upload') {
    console.log('  fix: upload the same dist/dan-skills.zip to the account(s) above, then');
    console.log('       `node cloud-plugin-sweep.js --stamp --accounts <every account uploaded to>`');
  }
  if (result.state === 'drift' || result.state === 'never-uploaded') {
    console.log('  fix: rebuild with build-cloud-plugin.py, re-upload at claude.ai > Customize > Plugins,');
    console.log('       then `node cloud-plugin-sweep.js --stamp`');
  }
  return EXIT[result.state];
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error(String(e && e.message ? e.message : e)); process.exitCode = 2; }
}

module.exports = { sweep, writeStamp, describe, fingerprint, collectSkills };
