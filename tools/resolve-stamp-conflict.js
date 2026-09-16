#!/usr/bin/env node
/**
 * resolve-stamp-conflict — resolve the git merge conflicts that live entirely inside a
 * SKILL.md metadata stamp block, and refuse every other conflict (issue 318).
 *
 * The packager rotates four keys under `metadata:` on every sync push whose skill content
 * moved — `modified`, `previous-modified`, `revision`, `content-sha` (tools/skill-stamps.py).
 * Two branches that both touched a skill therefore both rotated that block, and merging one
 * into the other conflicts on exactly those four lines. That conflict is not a real
 * disagreement: the stamps are regenerated from the content by
 * `tools/skill-stamps.py stamp …` right after the merge, so either side is a fine starting
 * point and the default branch's side is the one that matches what is already published.
 *
 * A conflict anywhere ELSE in a SKILL.md is a real merge. Taking the default branch's copy of
 * such a file wholesale drops the branch's work — that is what went wrong in PR #306 and is
 * the reason this resolver exists as a script with a hard refusal rather than as a sentence
 * in a prompt.
 *
 * So: a hunk whose every line (both sides) is one of the four stamp keys is resolved to the
 * chosen side; any other hunk is left exactly as git wrote it, markers included, and the
 * process exits non-zero. A side that is empty does not count as stamp-only — a deleted
 * stamp block is not a stamp rotation.
 *
 * Usage:
 *   node tools/resolve-stamp-conflict.js <file...> [--side theirs|ours] [--quiet]
 *
 * `--side theirs` (the default) takes the side being merged IN, which during
 * `git merge origin/<defaultBranch>` from a feature branch is the default branch.
 *
 * Exit codes:
 *   0  every conflict hunk in every named file was stamp-only and was resolved (or there
 *      were no conflict markers at all)
 *   1  at least one hunk was not stamp-only; it is left untouched for a real merge
 *   2  usage or I/O error
 */
'use strict';

const fs = require('node:fs');

/** The four keys tools/skill-stamps.py writes under `metadata:`. */
const STAMP_KEYS = ['modified', 'previous-modified', 'revision', 'content-sha'];
const STAMP_LINE = new RegExp('^\\s*(?:' + STAMP_KEYS.join('|') + ')\\s*:');

const START = /^<<<<<<<(?:[ \t].*)?\r?$/;
const BASE = /^\|\|\|\|\|\|\|(?:[ \t].*)?\r?$/;
const SEP = /^=======\r?$/;
const END = /^>>>>>>>(?:[ \t].*)?\r?$/;

/**
 * True when every non-blank line of a conflict side is one of the four stamp keys. An empty
 * side is deliberately NOT stamp-only.
 *
 * @param {string[]} lines
 * @returns {boolean}
 */
function isStampOnly(lines) {
  const meaningful = lines.filter((l) => l.trim() !== '');
  return meaningful.length > 0 && meaningful.every((l) => STAMP_LINE.test(l));
}

/**
 * Resolve the stamp-only conflict hunks in one file's text.
 *
 * @param {string} text - file contents, conflict markers and all
 * @param {'theirs'|'ours'} [side] - which side a stamp-only hunk resolves to (default theirs)
 * @returns {{text:string, resolved:number, unresolved:Array<{line:number}>}} text is the
 *   rewritten contents; a hunk that is not stamp-only survives verbatim, markers intact.
 */
function resolveStampConflicts(text, side) {
  const take = side === 'ours' ? 'ours' : 'theirs';
  const lines = text.split('\n');
  const out = [];
  const unresolved = [];
  let resolved = 0;
  let i = 0;
  while (i < lines.length) {
    if (!START.test(lines[i])) { out.push(lines[i]); i += 1; continue; }
    const ours = [];
    const base = [];
    const theirs = [];
    let bucket = ours;
    let sawSep = false;
    let endIdx = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (BASE.test(lines[j])) { bucket = base; continue; }
      if (SEP.test(lines[j])) { bucket = theirs; sawSep = true; continue; }
      if (END.test(lines[j])) { endIdx = j; break; }
      bucket.push(lines[j]);
    }
    if (endIdx < 0 || !sawSep) {
      // Malformed markers: copy the start line and carry on rather than eat the rest of the file.
      out.push(lines[i]);
      i += 1;
      continue;
    }
    if (isStampOnly(ours) && isStampOnly(theirs)) {
      for (const l of (take === 'ours' ? ours : theirs)) out.push(l);
      resolved += 1;
    } else {
      for (let k = i; k <= endIdx; k += 1) out.push(lines[k]);
      unresolved.push({ line: i + 1 });
    }
    i = endIdx + 1;
  }
  return { text: out.join('\n'), resolved, unresolved };
}

function main(argv) {
  const files = [];
  let side = 'theirs';
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--side') { side = argv[i + 1]; i += 1; continue; }
    if (a.startsWith('--side=')) { side = a.slice('--side='.length); continue; }
    if (a === '--quiet') { quiet = true; continue; }
    if (a === '-h' || a === '--help') {
      process.stdout.write('usage: resolve-stamp-conflict.js <file...> [--side theirs|ours] [--quiet]\n');
      return 0;
    }
    if (a.startsWith('-')) { process.stderr.write('unknown option: ' + a + '\n'); return 2; }
    files.push(a);
  }
  if (!files.length) {
    process.stderr.write('usage: resolve-stamp-conflict.js <file...> [--side theirs|ours]\n');
    return 2;
  }
  if (side !== 'theirs' && side !== 'ours') {
    process.stderr.write('--side must be theirs or ours, got: ' + side + '\n');
    return 2;
  }

  let blocked = false;
  for (const file of files) {
    let before;
    try { before = fs.readFileSync(file, 'utf8'); }
    catch (err) { process.stderr.write('cannot read ' + file + ': ' + err.message + '\n'); return 2; }
    const r = resolveStampConflicts(before, side);
    if (r.text !== before) {
      try { fs.writeFileSync(file, r.text); }
      catch (err) { process.stderr.write('cannot write ' + file + ': ' + err.message + '\n'); return 2; }
    }
    if (!quiet && r.resolved) {
      process.stdout.write(file + ': resolved ' + r.resolved + ' stamp-only hunk(s) to ' + side + '\n');
    }
    for (const u of r.unresolved) {
      blocked = true;
      process.stderr.write(file + ':' + u.line + ': conflict outside the stamp block - left untouched, resolve it as a real merge\n');
    }
  }
  return blocked ? 1 : 0;
}

module.exports = { STAMP_KEYS, isStampOnly, resolveStampConflicts, main };

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
