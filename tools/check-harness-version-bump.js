#!/usr/bin/env node
/**
 * check-harness-version-bump — a change to a project-harness template must bump the harness
 * version in the same change (issue 933).
 *
 *   node tools/check-harness-version-bump.js [--base <rev>] [--head <rev>]
 *
 * WHY: PR 914 (issue 889) changed `templates/tracker-audit.js` so a ticket parked in Maybe Someday
 * is not reported untriaged, and left the harness at v33. Every install already read 33, so none
 * read as behind, no step-7 sweep ran, and aac-bill-intake kept flagging two parked tickets until a
 * session re-added a label against the owner's ruling to quiet it. A stale install cannot see its
 * own staleness; only the version number can carry the news, so a template change that does not
 * move the number is caught here, in `.github/workflows/generated-code.yml`, on every push and
 * pull request.
 *
 * The rule: if anything under `aac-skills/project-harness/templates/` other than
 * `harness-version.md` differs between <base> and <head>, then `harness-version: N` in
 * `templates/harness-version.md` must be higher at <head> than at <base>. <base> defaults to the
 * merge-base of <head> and `origin/master`, so a branch is judged on everything it changed.
 *
 * Exit codes: 0 no template change, or the version went up; 1 a template changed and the version
 * did not; 2 git error (not a pass).
 */
'use strict';

const { execFileSync } = require('node:child_process');

const TEMPLATES = 'aac-skills/project-harness/templates/';
const MARKER = TEMPLATES + 'harness-version.md';
const VERSION_RE = /harness-version:\s*(\d+)/;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The marker's number at <rev>, or null when the file or the line is absent there. */
function versionAt(rev, cwd) {
  let text;
  try { text = git(['show', `${rev}:${MARKER}`], cwd); } catch { return null; }
  const m = VERSION_RE.exec(text);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * @param {{changed:string[], baseVersion:number|null, headVersion:number|null}} input
 * @returns {{ok:boolean, templates:string[]}}
 */
function evaluate({ changed, baseVersion, headVersion }) {
  const templates = changed.filter((f) => f.startsWith(TEMPLATES) && f !== MARKER);
  if (templates.length === 0) return { ok: true, templates };
  const bumped = headVersion != null && (baseVersion == null || headVersion > baseVersion);
  return { ok: bumped, templates };
}

function main(argv, cwd = process.cwd()) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const head = arg('--head') || 'HEAD';
  let base = arg('--base');
  let changed;
  try {
    if (!base) base = git(['merge-base', head, 'origin/master'], cwd).trim();
    changed = git(['diff', '--name-only', base, head, '--', TEMPLATES], cwd)
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) {
    process.stderr.write(`check-harness-version-bump: could not diff (${String(e.stderr || e.message).trim()})\n`);
    return 2;
  }
  const baseVersion = versionAt(base, cwd);
  const headVersion = versionAt(head, cwd);
  const { ok, templates } = evaluate({ changed, baseVersion, headVersion });
  if (templates.length === 0) {
    process.stdout.write('check-harness-version-bump: no harness template changed\n');
    return 0;
  }
  if (ok) {
    process.stdout.write(`check-harness-version-bump: templates changed and the harness moved v${baseVersion} -> v${headVersion}\n`);
    return 0;
  }
  process.stderr.write(
    `check-harness-version-bump: FAIL - ${templates.length} harness template(s) changed but ` +
    `harness-version stayed at ${headVersion} (base ${base.slice(0, 12)}):\n` +
    templates.map((f) => `  ${f}\n`).join('') +
    'A stale install cannot see its own staleness (issue 933). Bump the version: ' +
    `${MARKER}, "Current version: N." in aac-skills/project-harness/SKILL.md, a new ` +
    'UPGRADES.md row and docs/agents/harness-version.md; then run the step-7 sweep.\n');
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { evaluate, main, TEMPLATES, MARKER };
