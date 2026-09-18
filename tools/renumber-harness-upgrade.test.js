#!/usr/bin/env node
/**
 * node --test tools/renumber-harness-upgrade.test.js
 *
 * Issue 515. Two tickets in one fleet wave both bumped the harness to v26 and the second
 * branch could not merge until the number was moved by hand in nine places. The renumberer
 * does that move, so it is tested the way it runs: over a real fixture branch whose merge of
 * the default branch leaves `UPGRADES.md` conflicted on a `| 26 |` row.
 *
 * One test per stated behaviour: renumber the branch's row and every other place the branch
 * wrote that number (rebuilding the generated bootstrap template with the real generator);
 * refuse a UPGRADES.md change that is not a pure row addition; and leave a merge alone when
 * the two branches took different numbers.
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'renumber-harness-upgrade.js');
const GENERATOR = path.join(__dirname, 'build-harness-bootstrap-hook.js');
const TABLE = 'aac-skills/project-harness/UPGRADES.md';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function tryGit(cwd, args) {
  try { return { code: 0, out: git(cwd, args) }; }
  catch (err) { return { code: err.status, out: String(err.stdout || '') + String(err.stderr || '') }; }
}
function runCli(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}
function write(dir, rel, text) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}
function read(dir, rel) { return fs.readFileSync(path.join(dir, rel), 'utf8'); }

const HOOK = (v) => [
  '#!/usr/bin/env bash',
  '# CANONICAL COPY. The project-harness skill copies this file into every harnessed repo',
  `# as \`.claude/hooks/session-start.sh\` (SKILL.md step 16, harness v${v}, issue 218).`,
  'exit 0',
  '',
].join('\n');

const SKILL = (v) => [
  '# project-harness',
  '',
  `9. **Harness version marker** — copy the template. **Current version: ${v}.** The check STOPs`,
  `   when the repo is behind, so a repo without the v${v} bootstrap hook is exactly that state.`,
  '',
].join('\n');

const MARKER = (v) => `# Harness version\n\n    harness-version: ${v}\n\nInstalled/upgraded: 2026-09-12.\n`;

const TABLE_TEXT = (rows) => [
  '# Harness upgrade table',
  '',
  'One row per harness version: what it added, and which step of `SKILL.md` installs it.',
  '',
  '| Version | Date | What it added | Re-run |',
  '|---|---|---|---|',
].concat(rows).concat(['']).join('\n');

const ROW_24 = '| 24 | 2026-09-10 | `templates/pre-commit` learns the v24 gate | step 5 |';
const ROW_25 = '| 25 | 2026-09-12 | `templates/tracker-audit.js` narrows citations | step 8 |';
const ROW_26_MASTER = '| 26 | 2026-09-16 | `templates/dashboard.yml` listens to two issue types | step 3 |';
const ROW_26_BRANCH = '| 26 | 2026-09-17 | **The cloud bootstrap hook reaches any repo** | step 16 |';

/**
 * A repo at v25, a master that bumps it to v26, and a branch that forked before master's bump
 * and also took v26 - writing it in the nine places a harness bump writes a version.
 *
 * @param {object} [opts]
 * @param {string} [opts.branchRow] - the row the branch appends (default: its own v26 row)
 * @param {number} [opts.branchVersion] - the number the branch writes everywhere else
 * @param {boolean} [opts.branchEditsProse] - branch also rewords UPGRADES.md's prose
 * @returns {string} the repo directory, with the merge of master already attempted
 */
function fixtureBranch(opts) {
  const o = opts || {};
  const v = o.branchVersion || 26;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renumber-harness-'));
  git(dir, ['init', '-q', '-b', 'master', '.']);
  git(dir, ['config', 'user.email', 'fixture@example.com']);
  git(dir, ['config', 'user.name', 'Fixture']);

  write(dir, TABLE, TABLE_TEXT([ROW_24, ROW_25]));
  write(dir, 'aac-skills/project-harness/SKILL.md', SKILL(25));
  write(dir, 'aac-skills/project-harness/templates/harness-version.md', MARKER(25));
  write(dir, 'docs/agents/harness-version.md', MARKER(25));
  write(dir, '.claude/hooks/session-start.sh', HOOK(25));
  write(dir, 'aac-skills/project-harness/templates/session-start.sh', HOOK(25));
  // The real generator, so the rebuild step under test is the one that ships.
  write(dir, 'tools/build-harness-bootstrap-hook.js',
    fs.readFileSync(GENERATOR, 'utf8').replace(/harness v\d+, issue 218/, 'harness v25, issue 218'));
  write(dir, 'tools/harness-delivery.test.js', `// Harness v25 (issue 218).\nconst PREFIX = 'harness-v25-';\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base: harness v25']);

  // master: its own bump to v26, plus a file the branch never touches.
  write(dir, TABLE, TABLE_TEXT([ROW_24, ROW_25, ROW_26_MASTER]));
  write(dir, 'aac-skills/project-harness/templates/harness-version.md', MARKER(26));
  write(dir, 'docs/agents/harness-version.md', MARKER(26));
  write(dir, 'README.md', 'The dashboard workflow was narrowed in harness v26.\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'harness v26: dashboard issue filter']);
  const master = git(dir, ['rev-parse', 'HEAD']).trim();

  // the branch, forked before master's bump, taking the same number.
  git(dir, ['checkout', '-q', '-b', 'agent/issue-218-attempt1', 'HEAD~1']);
  const rows = [ROW_24, ROW_25, o.branchRow || ROW_26_BRANCH];
  let table = TABLE_TEXT(rows);
  if (o.branchEditsProse) table = table.replace('One row per harness version:', 'One row per harness release:');
  write(dir, TABLE, table);
  write(dir, 'aac-skills/project-harness/SKILL.md', SKILL(v));
  write(dir, 'aac-skills/project-harness/templates/harness-version.md', MARKER(v));
  write(dir, 'docs/agents/harness-version.md', MARKER(v));
  write(dir, '.claude/hooks/session-start.sh', HOOK(v));
  write(dir, 'aac-skills/project-harness/templates/session-start.sh', HOOK(v));
  write(dir, 'tools/build-harness-bootstrap-hook.js',
    read(dir, 'tools/build-harness-bootstrap-hook.js').replace(/harness v\d+, issue 218/, `harness v${v}, issue 218`));
  write(dir, 'tools/harness-delivery.test.js', `// Harness v${v} (issue 218).\nconst PREFIX = 'harness-v${v}-';\n`);
  write(dir, 'docs/tickets/218-decision.md', `Delivered as harness v${v}.\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', `harness v${v}: cloud bootstrap hook`]);

  tryGit(dir, ['merge', '--no-edit', master]);
  return dir;
}

test('renumbers a colliding row and every other place the branch wrote that version', () => {
  const dir = fixtureBranch();
  assert.match(read(dir, TABLE), /^<{7}/m, 'the fixture must reproduce the conflicted UPGRADES.md');

  const r = runCli(['--repo', dir]);
  assert.equal(r.code, 0, `renumber must succeed: ${r.stderr}`);

  const table = read(dir, TABLE);
  assert.doesNotMatch(table, /^<{7}|^={7}$|^>{7}/m, 'the conflict must be resolved');
  assert.ok(table.includes(ROW_24) && table.includes(ROW_25), 'the rows already published must survive verbatim');
  assert.ok(table.includes(ROW_26_MASTER), "the default branch's row keeps the number it merged with");
  assert.ok(table.includes(ROW_26_BRANCH.replace('| 26 |', '| 27 |')),
    "the branch's row must take the next free number and keep its text");
  assert.ok(table.indexOf(ROW_26_MASTER) < table.indexOf('| 27 |'), 'rows must stay in version order');

  // The nine places, each read back at its new number.
  assert.match(read(dir, 'aac-skills/project-harness/templates/harness-version.md'), /harness-version: 27/);
  assert.match(read(dir, 'docs/agents/harness-version.md'), /harness-version: 27/);
  assert.match(read(dir, 'aac-skills/project-harness/SKILL.md'), /Current version: 27\./);
  assert.match(read(dir, 'aac-skills/project-harness/SKILL.md'), /the v27 bootstrap hook/);
  assert.match(read(dir, '.claude/hooks/session-start.sh'), /harness v27, issue 218/);
  assert.match(read(dir, 'tools/build-harness-bootstrap-hook.js'), /harness v27, issue 218/);
  assert.match(read(dir, 'tools/harness-delivery.test.js'), /harness-v27-/);
  assert.match(read(dir, 'docs/tickets/218-decision.md'), /harness v27/);
  assert.equal(read(dir, 'aac-skills/project-harness/templates/session-start.sh'),
    read(dir, '.claude/hooks/session-start.sh'),
    'the generated template must be rebuilt from the renumbered hook by build-harness-bootstrap-hook.js');

  assert.match(read(dir, 'README.md'), /harness v26/,
    'a file the branch never changed is out of range: its v26 is somebody else\'s');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('refuses a UPGRADES.md change that is not a pure row addition', () => {
  const dir = fixtureBranch({ branchEditsProse: true });
  const before = read(dir, TABLE);

  const r = runCli(['--repo', dir]);
  assert.equal(r.code, 1, 'a prose edit is a real merge, not a renumber');
  assert.match(r.stderr, /outside the version table/);
  assert.equal(read(dir, TABLE), before, 'the conflicted file must be left exactly as git wrote it');
  assert.match(read(dir, 'aac-skills/project-harness/SKILL.md'), /Current version: 26\./,
    'a refusal must move no version number anywhere');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('combines the rows without renumbering when the two branches took different numbers', () => {
  const dir = fixtureBranch({
    branchRow: '| 27 | 2026-09-17 | **The cloud bootstrap hook reaches any repo** | step 16 |',
    branchVersion: 27,
  });

  const r = runCli(['--repo', dir]);
  assert.equal(r.code, 0, `no collision must still resolve the conflict: ${r.stderr}`);
  assert.match(r.stdout, /no number collision/);
  const table = read(dir, TABLE);
  assert.ok(table.includes(ROW_26_MASTER) && table.includes('| 27 |'), 'both rows must survive');
  assert.doesNotMatch(table, /^<{7}/m, 'the conflict must be resolved');
  assert.match(read(dir, 'aac-skills/project-harness/SKILL.md'), /Current version: 27\./,
    'nothing outside the table moves when no number collided');
  fs.rmSync(dir, { recursive: true, force: true });
});
