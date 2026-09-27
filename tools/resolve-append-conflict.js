#!/usr/bin/env node
/**
 * resolve-append-conflict — resolve the git merge conflicts where both sides only ADDED lines
 * at the same spot, and refuse every other conflict (issue 908).
 *
 * The commonest real conflict in a fleet wave is two tickets appending new tests (or new
 * functions) at the end of one file: fleet run 6ab733a4 lost 840 and 812 on exactly that shape,
 * and the session resolved it by hand four more times the same way - keep both blocks, run the
 * suite. That is not a disagreement, so the deliver stage may resolve it without judgment, the
 * same way it resolves stamp blocks (tools/resolve-stamp-conflict.js).
 *
 * Deciding "only added" needs the merge base, so this reads diff3-style markers
 * (`git checkout --conflict=diff3 -- <path>` rewrites a conflicted file that way). A hunk is
 * resolvable when neither side removed or changed a base line: an empty base section, or a base
 * that survives intact in the lines both sides share at the hunk's start and end. It resolves to
 * ours followed by theirs. Any other hunk - a base line edited or deleted on either side (run
 * 6ab733a4's 813), or a hunk with no base section to check against - is left exactly as git
 * wrote it and the process exits non-zero. The resolution is only a starting point: the deliver
 * stage re-runs the full test command afterwards and a red suite blocks the ticket as before.
 *
 * Usage:
 *   node tools/resolve-append-conflict.js <file...> [--quiet]
 *
 * Exit codes:
 *   0  every conflict hunk in every named file was append-append and was resolved (or there
 *      were no conflict markers at all)
 *   1  at least one hunk was not append-append; it is left untouched for a real merge
 *   2  usage or I/O error
 */
'use strict';

const fs = require('node:fs');

const START = /^<<<<<<<(?:[ \t].*)?\r?$/;
const BASE = /^\|\|\|\|\|\|\|(?:[ \t].*)?\r?$/;
const SEP = /^=======\r?$/;
const END = /^>>>>>>>(?:[ \t].*)?\r?$/;

/** True when `needle` appears in `hay` in order (not necessarily contiguous). */
function isSubsequence(needle, hay) {
  let i = 0;
  for (const l of hay) if (i < needle.length && l === needle[i]) i += 1;
  return i === needle.length;
}

/**
 * Classify one conflict hunk. `base` is null when the markers carried no base section.
 *
 * @param {{ours:string[], base:(string[]|null), theirs:string[]}} hunk
 * @returns {{resolvable:boolean, reason:string, lines?:string[]}} lines is the resolution
 *   (ours then theirs) when resolvable.
 */
function classifyHunk({ ours, base, theirs }) {
  if (base === null || base === undefined) {
    return { resolvable: false, reason: 'no base section - rewrite the file with git checkout --conflict=diff3 first' };
  }
  if (!ours.length || !theirs.length) return { resolvable: false, reason: 'one side removed lines' };
  if (!base.length) return { resolvable: true, reason: 'both sides only added lines', lines: ours.concat(theirs) };
  if (!isSubsequence(base, ours) || !isSubsequence(base, theirs)) {
    return { resolvable: false, reason: 'a base line was removed or changed' };
  }
  // Both sides kept every base line. Resolve only when the base sits wholly inside the lines the
  // two sides share at the start and the end of the hunk, so what lies between is pure addition
  // on each side and ours-then-theirs duplicates no base line.
  let p = 0;
  while (p < ours.length && p < theirs.length && ours[p] === theirs[p]) p += 1;
  let s = 0;
  const room = Math.min(ours.length, theirs.length) - p;
  while (s < room && ours[ours.length - 1 - s] === theirs[theirs.length - 1 - s]) s += 1;
  const prefix = ours.slice(0, p);
  const suffix = ours.slice(ours.length - s);
  if (!isSubsequence(base, prefix.concat(suffix))) {
    return { resolvable: false, reason: 'the additions interleave with base lines - not a plain append' };
  }
  const lines = prefix.concat(ours.slice(p, ours.length - s), theirs.slice(p, theirs.length - s), suffix);
  return { resolvable: true, reason: 'both sides only added lines', lines };
}

/**
 * Resolve the append-append conflict hunks in one file's text.
 *
 * @param {string} text - file contents, conflict markers and all
 * @returns {{text:string, resolved:number, unresolved:Array<{line:number, reason:string}>}}
 */
function resolveAppendConflicts(text) {
  const lines = text.split('\n');
  const out = [];
  const unresolved = [];
  let resolved = 0;
  let i = 0;
  while (i < lines.length) {
    if (!START.test(lines[i])) { out.push(lines[i]); i += 1; continue; }
    const ours = [];
    let base = null;
    const theirs = [];
    let bucket = ours;
    let sawSep = false;
    let endIdx = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (!sawSep && BASE.test(lines[j])) { base = []; bucket = base; continue; }
      if (!sawSep && SEP.test(lines[j])) { bucket = theirs; sawSep = true; continue; }
      if (END.test(lines[j])) { endIdx = j; break; }
      bucket.push(lines[j]);
    }
    if (endIdx < 0 || !sawSep) { out.push(lines[i]); i += 1; continue; }
    const c = classifyHunk({ ours, base, theirs });
    if (c.resolvable) {
      for (const l of c.lines) out.push(l);
      resolved += 1;
    } else {
      for (let k = i; k <= endIdx; k += 1) out.push(lines[k]);
      unresolved.push({ line: i + 1, reason: c.reason });
    }
    i = endIdx + 1;
  }
  return { text: out.join('\n'), resolved, unresolved };
}

function main(argv) {
  const files = [];
  let quiet = false;
  for (const a of argv) {
    if (a === '--quiet') { quiet = true; continue; }
    if (a === '-h' || a === '--help') {
      process.stdout.write('usage: resolve-append-conflict.js <file...> [--quiet]\n');
      return 0;
    }
    if (a.startsWith('-')) { process.stderr.write('unknown option: ' + a + '\n'); return 2; }
    files.push(a);
  }
  if (!files.length) {
    process.stderr.write('usage: resolve-append-conflict.js <file...> [--quiet]\n');
    return 2;
  }
  let blocked = false;
  for (const file of files) {
    let before;
    try { before = fs.readFileSync(file, 'utf8'); }
    catch (err) { process.stderr.write('cannot read ' + file + ': ' + err.message + '\n'); return 2; }
    const r = resolveAppendConflicts(before);
    // All or nothing per file: a file with one real conflict keeps every hunk as git wrote it.
    if (r.unresolved.length) {
      blocked = true;
      for (const u of r.unresolved) {
        process.stderr.write(file + ':' + u.line + ': not an append-append conflict (' + u.reason + ') - left untouched, resolve it as a real merge\n');
      }
      continue;
    }
    if (r.text !== before) {
      try { fs.writeFileSync(file, r.text); }
      catch (err) { process.stderr.write('cannot write ' + file + ': ' + err.message + '\n'); return 2; }
    }
    if (!quiet && r.resolved) {
      process.stdout.write(file + ': resolved ' + r.resolved + ' append-append hunk(s) as ours + theirs\n');
    }
  }
  return blocked ? 1 : 0;
}

module.exports = { classifyHunk, resolveAppendConflicts, main };

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
