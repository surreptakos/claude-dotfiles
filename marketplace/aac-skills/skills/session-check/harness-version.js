'use strict';

/**
 * Read the project-harness skill's own version and a repo's stamp, then compare.
 *
 * The skill writes `docs/agents/harness-version.md` on every install or upgrade
 * (`harness-version: N`). Session-start reads it against the SAME number the skill
 * would write today — the `harness-version:` line in `templates/harness-version.md`
 * next to the skill's own SKILL.md. Cross-checked against the "Current version: N"
 * line in the skill's SKILL.md so a stamp cannot silently lag the upgrade table
 * (it did once: the v9 row records the template still saying 7).
 *
 * States:
 *   'current'         repo stamp equals the skill's number
 *   'behind'          repo stamp is older than the skill's number
 *   'ahead'           repo stamp is newer than the skill's number (this repo is where
 *                     the skill's number is bumped from; a stamp above the template means
 *                     someone edited the marker without bumping the template)
 *   'stale-skill-copy' repo stamp is newer than the skill's number, but the CANONICAL
 *                     project-harness copy is newer still and the stamp does not pass it —
 *                     the marker is fine, the skill copy this session loaded is behind the
 *                     published one (a cloud container on a stale plugin payload, issue 412)
 *   'not-harnessed'   docs/agents/harness-version.md absent AND scripts/build-dashboard.js absent
 *   'v1-implicit'     folded into 'behind' when template > 1 — the skill's own rule,
 *                     "File absent means version 1 (pre-marker), not unharnessed"
 *   'skill-missing'   this machine or container has no project-harness skill to compare against
 *   'stamp-mismatch'  SKILL.md and the template disagree — a test failure signal, not a repo
 *                     report (the packager writes both, so they must move together)
 *
 * READ ONLY. Session-start reports; it never runs the upgrade.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEMPLATE_RE = /^\s*harness-version:\s*(\d+)\s*$/m;
const SKILL_RE = /\*\*Current version:\s*(\d+)\.\*\*/;

/**
 * Find the project-harness skill directory relative to this file. In the plugin tree
 * (`${CLAUDE_PLUGIN_ROOT}/skills/session-check/`) and on the owner's machine
 * (`~/.claude/skills/session-check/`), the sibling is `../project-harness`. Fallbacks
 * cover a cloud container whose plugin lays skills under `~/.agents/skills` and the
 * explicit `CLAUDE_PLUGIN_ROOT` variable. Returns null when the skill is not installed.
 */
function findSkillDir(baseDir, env) {
  const e = env || process.env;
  // Explicit override wins and short-circuits discovery. The tests point HARNESS_SKILL_DIR at
  // a fixture skill to exercise the four states without moving check.js; an empty string means
  // "no skill available", which is the skill-missing case.
  if (typeof e.HARNESS_SKILL_DIR === 'string') {
    if (!e.HARNESS_SKILL_DIR) return null;
    try {
      if (fs.existsSync(path.join(e.HARNESS_SKILL_DIR, 'SKILL.md'))) return e.HARNESS_SKILL_DIR;
    } catch (_e) { /* fall through */ }
    return null;
  }
  const cands = [
    path.join(baseDir, '..', 'project-harness'),
    path.join(os.homedir(), '.agents', 'skills', 'project-harness'),
    e.CLAUDE_PLUGIN_ROOT ? path.join(e.CLAUDE_PLUGIN_ROOT, 'skills', 'project-harness') : null,
  ].filter(Boolean);
  for (const c of cands) {
    try {
      if (fs.existsSync(path.join(c, 'SKILL.md'))) return c;
    } catch (_e) { /* keep going */ }
  }
  return null;
}

/**
 * Read the skill's own current version, cross-checked between two spellings.
 *
 * Returns `{ version }` on success, `{ error: 'template and SKILL.md disagree',
 * template, skill }` for the mismatch case (a test failure the ticket calls out),
 * or `{ error }` when the skill is not installed or a file cannot be parsed.
 */
function readSkillVersion(skillDir) {
  if (!skillDir) return { error: 'project-harness skill not found' };
  const tmpl = path.join(skillDir, 'templates', 'harness-version.md');
  const skill = path.join(skillDir, 'SKILL.md');
  let tmplText;
  let skillText;
  try { tmplText = fs.readFileSync(tmpl, 'utf8'); }
  catch (e) { return { error: `cannot read ${tmpl}: ${e.message}` }; }
  try { skillText = fs.readFileSync(skill, 'utf8'); }
  catch (e) { return { error: `cannot read ${skill}: ${e.message}` }; }
  const tm = tmplText.match(TEMPLATE_RE);
  const sm = skillText.match(SKILL_RE);
  if (!tm) return { error: `no harness-version line in ${tmpl}` };
  if (!sm) return { error: `no "Current version: N." line in ${skill}` };
  const template = Number(tm[1]);
  const skillN = Number(sm[1]);
  if (template !== skillN) return { error: 'template and SKILL.md disagree', template, skill: skillN };
  return { version: template };
}

/**
 * Read the repo's own stamp. Returns `{ version }`, `{ v1Implicit: true }` for a repo
 * where the file is absent but `scripts/build-dashboard.js` is present (the skill's rule,
 * "File absent means version 1 (pre-marker), not unharnessed"), or `{ absent: true }` when
 * neither signal is present.
 */
function readRepoVersion(repoRoot) {
  const stamp = path.join(repoRoot, 'docs', 'agents', 'harness-version.md');
  const dash = path.join(repoRoot, 'scripts', 'build-dashboard.js');
  if (fs.existsSync(stamp)) {
    const text = fs.readFileSync(stamp, 'utf8');
    const m = text.match(TEMPLATE_RE);
    if (m) return { version: Number(m[1]) };
    return { error: `no harness-version line in ${stamp}` };
  }
  if (fs.existsSync(dash)) return { v1Implicit: true };
  return { absent: true };
}

const TEMPLATE_IN_REPO = 'marketplace/aac-skills/skills/project-harness/templates/harness-version.md';

/**
 * The CANONICAL project-harness version: the number the published plugin payload offers today,
 * independent of the copy this session happens to have loaded.
 *
 * It has to come off the REMOTE (issue 674). It used to be read from the template inside the
 * bootstrap's dotfiles clone under `~/.aac-dotfiles`, but the loaded skill copy is copied from
 * that same clone, so in a container the two numbers were equal by construction and a repo
 * stamped forward from master always fell through to 'ahead'. The clone now only names the
 * remote (`remote.origin.url`, read, never written): the template is fetched from that URL into
 * a throwaway blobless, depth-1 bare repo under the OS temp dir, read with `git show`, and the
 * scratch repo is deleted. Nothing outside the temp dir is written. The clone's own template is
 * never a fallback, because its answer is the bug; no clone, no remote or a failed fetch is
 * `{ error }`, which leaves the prior reading alone.
 *
 * `HARNESS_CANONICAL_FILE` pins the number to a file for tests; an empty string means "no
 * canonical copy here". `BOOTSTRAP_DOTFILES_REF` names the ref (default master), as it does for
 * bootstrap-check.js. `run` is injected for tests; in a real session it is bootstrap-check's
 * bounded, never-throwing git.
 */
function readCanonicalVersion(env, run) {
  const e = env || process.env;
  let text;
  let where;
  if (typeof e.HARNESS_CANONICAL_FILE === 'string') {
    if (!e.HARNESS_CANONICAL_FILE) return { error: 'no canonical project-harness copy configured' };
    where = e.HARNESS_CANONICAL_FILE;
    try { text = fs.readFileSync(where, 'utf8'); }
    catch (err) { return { error: `cannot read ${where}: ${err.message}` }; }
  } else {
    const clone = path.join(e.HOME || os.homedir(), '.aac-dotfiles');
    if (!fs.existsSync(path.join(clone, '.git'))) return { error: 'no dotfiles clone to name the remote' };
    const exec = run || require('./bootstrap-check').execGit;
    const url = String(exec('git', ['-C', clone, 'config', '--get', 'remote.origin.url']).stdout || '').trim();
    if (!url) return { error: 'the dotfiles clone names no remote' };
    const ref = e.BOOTSTRAP_DOTFILES_REF || 'master';
    let scratch;
    try {
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-canonical-'));
      const git = (...args) => exec('git', ['-C', scratch, ...args]);
      const ok = exec('git', ['init', '--bare', '-q', scratch]).status === 0
        && git('remote', 'add', 'origin', url).status === 0
        && git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', ref).status === 0;
      if (!ok) return { error: `cannot fetch ${ref} from ${url}` };
      const shown = git('show', `FETCH_HEAD:${TEMPLATE_IN_REPO}`);
      if (shown.status !== 0) return { error: `cannot read ${TEMPLATE_IN_REPO} at ${ref}` };
      text = shown.stdout;
      where = `${ref}:${TEMPLATE_IN_REPO}`;
    } catch (err) {
      return { error: `cannot read the canonical template: ${err.message}` };
    } finally {
      if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    }
  }
  const m = String(text).match(TEMPLATE_RE);
  if (!m) return { error: `no harness-version line in ${where}` };
  return { version: Number(m[1]) };
}

/**
 * Compare a repo's harness stamp against the skill's own current version.
 */
function harnessState(repoRoot, skillDir, env, run) {
  const s = readSkillVersion(skillDir);
  if (s.error === 'template and SKILL.md disagree') {
    return { state: 'stamp-mismatch', template: s.template, skill: s.skill };
  }
  const r = readRepoVersion(repoRoot);
  if (s.error) {
    if (r.absent) return { state: 'skill-missing', reason: s.error };
    return { state: 'skill-missing', reason: s.error };
  }
  const current = s.version;
  if (r.error) return { state: 'skill-missing', reason: r.error, current };
  if (r.absent) return { state: 'not-harnessed', current };
  const repoVersion = r.v1Implicit ? 1 : r.version;
  if (repoVersion === current) return { state: 'current', current, repo: repoVersion };
  if (repoVersion < current) return { state: 'behind', current, repo: repoVersion, v1Implicit: !!r.v1Implicit };
  // repoVersion > current. Before blaming the marker, ask whether the skill copy this session
  // loaded is itself behind the published one: a stale plugin payload makes every correctly
  // stamped repo look edited (issue 412). Only the canonical number can tell the two apart, and
  // only when it is readable — an unreadable canonical leaves the original reading in place.
  const c = readCanonicalVersion(env, run);
  if (typeof c.version === 'number' && c.version > current && repoVersion <= c.version) {
    return { state: 'stale-skill-copy', current, repo: repoVersion, canonical: c.version };
  }
  return { state: 'ahead', current, repo: repoVersion };
}

module.exports = {
  findSkillDir,
  readSkillVersion,
  readRepoVersion,
  readCanonicalVersion,
  harnessState,
};
