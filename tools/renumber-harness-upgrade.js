#!/usr/bin/env node
/**
 * renumber-harness-upgrade — settle the one merge collision two harness-version bumps in the
 * same fleet wave always produce: both branches take the same version number (issue 515).
 *
 * A wave's branches all fork from the same commit, so two tickets that each bump the harness
 * both write the NEXT row of `aac-skills/project-harness/UPGRADES.md` — the same `| N |`.
 * The first merges; the second's pre-push merge stops on a conflict that is not a
 * disagreement. Run `6aab1eac` hit exactly that (#453 and #218 both took v26) and the number
 * was moved by hand in nine places, found by grep.
 *
 * This is that renumber, done by a script the deliver stage can read the exit code of:
 *
 *   - the branch's added row keeps its text and takes the next free number;
 *   - every OTHER place the branch wrote that number moves with it — `harness-version: N`,
 *     SKILL.md's `Current version: N.`, and any `vN` token in a file the branch changed
 *     (the hook header, its generated template, the generator's and the test's comments,
 *     the repo's own `docs/agents/harness-version.md`, a ticket decision note);
 *   - the generated bootstrap template is rebuilt with `tools/build-harness-bootstrap-hook.js`,
 *     so the copy and its source still say the same number.
 *
 * The rewrite is confined to the files the branch itself touched (`git diff --name-only
 * <merge-base> <ours>`), which is what keeps `v26` in a two-year-old UPGRADES row, or in
 * another repo's prose, out of range.
 *
 * Refuse rather than guess: if the branch changed UPGRADES.md anywhere but by ADDING rows —
 * prose edited, an existing row reworded or dropped — the file is left exactly as git wrote
 * it and the exit code is 1, which puts the path back in the deliver stage's "real merge"
 * class. Same rule as tools/resolve-stamp-conflict.js.
 *
 * Usage:
 *   node tools/renumber-harness-upgrade.js [--path <UPGRADES.md>] [--ours <rev>]
 *                                          [--theirs <rev>] [--repo <dir>] [--quiet]
 *
 * With a merge in progress the sides are HEAD and MERGE_HEAD. Run it after a merge that
 * committed cleanly and the sides are that merge commit's two parents — a clean merge is the
 * other way this collision arrives, because two rows appended in different places do not
 * conflict, they just both say `| 26 |`.
 *
 * Exit codes:
 *   0  renumbered, or there was no collision to renumber (nothing written in that case)
 *   1  refused: the branch's UPGRADES.md change is not a pure row addition
 *   2  usage, git or I/O error
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_TABLE = 'aac-skills/project-harness/UPGRADES.md';
const GENERATOR = 'tools/build-harness-bootstrap-hook.js';

/** A version row: `| 27 | 2026-09-17 | … | … |`. The separator row has no digits and is not one. */
const ROW = /^\|(\s*)(\d+)(\s*)\|/;
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7}|\|{7})(?:[ \t].*)?$/;

/**
 * Split a table file into its rows and everything else, so an "additions only" change is a
 * comparison of two skeletons rather than a diff to interpret.
 *
 * @param {string} text
 * @returns {{lines:string[], rows:Array<{num:number, text:string, index:number}>, skeleton:string[]}}
 */
function splitTable(text) {
  const lines = String(text).split('\n');
  const rows = [];
  lines.forEach((line, index) => {
    const m = ROW.exec(line);
    if (m) rows.push({ num: parseInt(m[2], 10), text: line, index });
  });
  return { lines, rows, skeleton: lines.filter((l) => !ROW.test(l)) };
}

/** Rewrite the leading `| N |` of one row, keeping its spacing and the rest of the row verbatim. */
function withNumber(rowText, num) {
  return rowText.replace(ROW, (_m, a, _d, b) => '|' + a + num + b + '|');
}

/**
 * Three-way merge of the version table: the default branch's file, plus the rows this branch
 * added, each renumbered when its number is already taken.
 *
 * @param {string} baseText - UPGRADES.md at the merge base
 * @param {string} oursText - UPGRADES.md on the branch
 * @param {string} theirsText - UPGRADES.md on the default branch
 * @returns {{text:string|null, mapping:Array<{from:number,to:number}>, refused?:string}}
 *   `text` is the resolved file (null when the branch added nothing, i.e. nothing to do).
 */
function planMerge(baseText, oursText, theirsText) {
  const base = splitTable(baseText);
  const ours = splitTable(oursText);
  const theirs = splitTable(theirsText);
  if (ours.skeleton.join('\n') !== base.skeleton.join('\n')) {
    return { text: null, mapping: [], refused: 'the branch changed UPGRADES.md outside the version table' };
  }
  for (const r of base.rows) {
    if (!ours.rows.some((o) => o.text === r.text)) {
      return { text: null, mapping: [], refused: `the branch edited or removed the existing row for version ${r.num}` };
    }
  }
  const baseTexts = new Set(base.rows.map((r) => r.text));
  const added = ours.rows.filter((r) => !baseTexts.has(r.text)).sort((a, b) => a.num - b.num);
  if (!added.length) return { text: null, mapping: [] };
  if (!theirs.rows.length) {
    return { text: null, mapping: [], refused: 'the default branch copy of UPGRADES.md holds no version row' };
  }

  const first = theirs.rows[0].index;
  const last = theirs.rows[theirs.rows.length - 1].index;
  for (let i = first; i <= last; i += 1) {
    if (!ROW.test(theirs.lines[i]) && theirs.lines[i].trim() !== '') {
      return { text: null, mapping: [], refused: `the default branch table is interrupted at line ${i + 1}; renumbering would reorder prose` };
    }
  }

  const taken = new Set(theirs.rows.map((r) => r.num));
  let next = Math.max(...theirs.rows.map((r) => r.num), ...added.map((r) => r.num));
  const mapping = [];
  const placed = [];
  for (const r of added) {
    let num = r.num;
    if (taken.has(num)) { next += 1; num = next; mapping.push({ from: r.num, to: num }); }
    taken.add(num);
    placed.push({ num, text: num === r.num ? r.text : withNumber(r.text, num) });
  }

  const merged = theirs.rows.concat(placed).sort((a, b) => a.num - b.num).map((r) => r.text);
  const out = theirs.lines.slice(0, first).concat(merged, theirs.lines.slice(last + 1));
  return { text: out.join('\n'), mapping };
}

/**
 * Move one version number everywhere a harness bump writes it in ONE file: the marker line,
 * SKILL.md's current-version sentence, and any bare `vN` token (`harness v27`, `harness-v27-`,
 * `(v27: …)`).
 *
 * @param {string} text
 * @param {number} from
 * @param {number} to
 * @returns {string}
 */
function rewriteVersionMentions(text, from, to) {
  return String(text)
    .replace(new RegExp('(harness-version:\\s*)' + from + '\\b', 'g'), '$1' + to)
    .replace(new RegExp('(Current version:\\s*)' + from + '(?=\\.)', 'g'), '$1' + to)
    .replace(new RegExp('\\bv' + from + '\\b', 'g'), 'v' + to);
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function show(repo, rev, file) {
  try { return git(repo, ['show', `${rev}:${file}`]); }
  catch (err) { return null; }
}

/** The two sides of the merge in progress, or of the merge commit just made. */
function resolveSides(repo, opts) {
  if (opts.ours && opts.theirs) return { ours: opts.ours, theirs: opts.theirs };
  try {
    const mergeHead = git(repo, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
    if (mergeHead) return { ours: 'HEAD', theirs: mergeHead };
  } catch (err) { /* no merge in progress */ }
  try {
    const parents = git(repo, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
    if (parents.length >= 3) return { ours: parents[1], theirs: parents[2] };
  } catch (err) { /* not a repo; reported by the caller */ }
  return null;
}

function main(argv) {
  let repo = process.cwd();
  let file = null;
  let quiet = false;
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--quiet') { quiet = true; continue; }
    if (a === '-h' || a === '--help') {
      process.stdout.write('usage: renumber-harness-upgrade.js [--path <UPGRADES.md>] [--ours <rev>] [--theirs <rev>] [--repo <dir>] [--quiet]\n');
      return 0;
    }
    if (a === '--repo') { repo = argv[i + 1]; i += 1; continue; }
    if (a === '--path') { file = argv[i + 1]; i += 1; continue; }
    if (a === '--ours') { opts.ours = argv[i + 1]; i += 1; continue; }
    if (a === '--theirs') { opts.theirs = argv[i + 1]; i += 1; continue; }
    process.stderr.write('unknown argument: ' + a + '\n');
    return 2;
  }
  try { repo = git(repo, ['rev-parse', '--show-toplevel']); }
  catch (err) { process.stderr.write('not a git repository: ' + repo + '\n'); return 2; }
  if (!file) file = DEFAULT_TABLE;

  const sides = resolveSides(repo, opts);
  if (!sides) {
    process.stderr.write('no merge in progress and HEAD is not a merge commit; pass --ours and --theirs\n');
    return 2;
  }
  let base;
  try { base = git(repo, ['merge-base', sides.ours, sides.theirs]); }
  catch (err) { process.stderr.write('cannot find the merge base: ' + err.message + '\n'); return 2; }

  const baseText = show(repo, base, file);
  const oursText = show(repo, sides.ours, file);
  const theirsText = show(repo, sides.theirs, file);
  if (baseText === null || oursText === null || theirsText === null) {
    if (!quiet) process.stdout.write(file + ': not present on all three sides - nothing to renumber\n');
    return 0;
  }

  const plan = planMerge(baseText, oursText, theirsText);
  if (plan.refused) {
    process.stderr.write(file + ': ' + plan.refused + ' - left untouched, resolve it as a real merge\n');
    return 1;
  }
  if (plan.text === null) {
    if (!quiet) process.stdout.write(file + ': the branch adds no version row - nothing to renumber\n');
    return 0;
  }

  const abs = path.join(repo, file);
  try { fs.writeFileSync(abs, plan.text); }
  catch (err) { process.stderr.write('cannot write ' + abs + ': ' + err.message + '\n'); return 2; }

  if (!plan.mapping.length) {
    if (!quiet) process.stdout.write(file + ': rows combined, no number collision\n');
    return 0;
  }

  // The branch's number moved, so every other place the BRANCH wrote it must move too. Only
  // the files it changed are in range; `v26` anywhere else in the repo is somebody's history.
  let changed = [];
  try {
    changed = git(repo, ['diff', '--name-only', '--diff-filter=d', base, sides.ours])
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    process.stderr.write('cannot list the branch\'s changed files: ' + err.message + '\n');
    return 2;
  }

  const touched = [];
  const stillConflicted = [];
  for (const rel of changed) {
    if (rel === file) continue;
    const p = path.join(repo, rel);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (err) { continue; }
    if (text.indexOf('\0') >= 0) continue;
    // A file git left conflicted is not ours to rewrite: renumbering inside the markers would
    // bake the new number into both sides of a merge nobody has resolved yet. Name it instead.
    if (text.split('\n').some((l) => CONFLICT_MARKER.test(l))) { stillConflicted.push(rel); continue; }
    let next = text;
    for (const m of plan.mapping) next = rewriteVersionMentions(next, m.from, m.to);
    if (next === text) continue;
    try { fs.writeFileSync(p, next); }
    catch (err) { process.stderr.write('cannot write ' + p + ': ' + err.message + '\n'); return 2; }
    touched.push(rel);
  }

  const moves = plan.mapping.map((m) => 'v' + m.from + ' -> v' + m.to).join(', ');
  if (!quiet) {
    process.stdout.write(file + ': renumbered ' + moves + '\n');
    for (const rel of touched) process.stdout.write('  rewrote ' + rel + '\n');
  }
  for (const rel of stillConflicted) {
    process.stderr.write(rel + ': still conflicted, so its version number was NOT moved - resolve that '
      + 'conflict, then re-run this script or set the number to ' + plan.mapping[plan.mapping.length - 1].to + ' by hand\n');
  }

  // Rebuild the generated bootstrap template from the hook the renumber just edited. Skipped
  // while the hook itself is still conflicted: the generator copies bytes, markers included.
  const generator = path.join(repo, GENERATOR);
  if (fs.existsSync(generator)) {
    const source = path.join(repo, '.claude', 'hooks', 'session-start.sh');
    const sourceText = fs.existsSync(source) ? fs.readFileSync(source, 'utf8') : '';
    if (sourceText.split('\n').some((l) => CONFLICT_MARKER.test(l))) {
      process.stderr.write('.claude/hooks/session-start.sh still holds conflict markers; re-run ' + GENERATOR + ' after resolving it\n');
    } else {
      try {
        const out = execFileSync(process.execPath, [generator], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        if (!quiet) process.stdout.write('  ' + String(out).trim() + '\n');
      } catch (err) {
        process.stderr.write('cannot rebuild the bootstrap template: ' + String((err && err.stderr) || (err && err.message)) + '\n');
        return 2;
      }
    }
  }
  return 0;
}

module.exports = { DEFAULT_TABLE, splitTable, withNumber, planMerge, rewriteVersionMentions, main };

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
