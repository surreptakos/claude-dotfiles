#!/usr/bin/env node
/**
 * followups-append — append one ticket-fleet run's discovery bullets to FOLLOW-UPS.md as a pure,
 * append-only operation (issue 882).
 *
 * The Report phase used to hand an agent a prose instruction ("append ... never rewrite or
 * reword an existing entry") and trust it to edit the file by hand. That agent overwrote
 * FOLLOW-UPS.md with only the new run's section, deleting seven earlier runs' worth of bullets -
 * the same class of failure `tools/resolve-stamp-conflict.js` and `tools/renumber-harness-upgrade.js`
 * already exist to take out of an agent's hands for merge conflicts and upgrade rows. This script
 * does the same for the follow-ups file: the writer now runs it instead of editing the file
 * itself, so the append is a deterministic function call, not a freeform edit.
 *
 * appendFollowupsSection() only ever concatenates onto the end of the existing text - it never
 * reads past it, never reorders it, never rewrites it - so its output always starts with its
 * input, byte for byte. That is the property `main()` re-checks before writing, and the property
 * the test file pins with two runs appended back to back.
 *
 * Usage:
 *   node tools/followups-append.js <followupsFile> <runId> <discoveriesJsonFile> [--date YYYY-MM-DD]
 *
 * <discoveriesJsonFile> holds a JSON array of discovery strings (the bullets, verbatim). --date
 * overrides today's UTC date for tests; a live run always uses today.
 *
 * Exit codes:
 *   0  appended; prints one line of JSON: {file, runId, appended, heading, bytesBefore, bytesAfter}
 *   2  usage or I/O error
 */
'use strict';

const fs = require('node:fs');

/**
 * Build the heading line for a run's section.
 *
 * @param {string} runId
 * @param {string} date - ISO date (YYYY-MM-DD)
 * @returns {string}
 */
function buildHeading(runId, date) {
  if (!runId) { throw new Error('buildHeading: runId required'); }
  if (!date) { throw new Error('buildHeading: date required'); }
  return `## Run ${date} (ticket-fleet ${runId})`;
}

/**
 * Pure: append one run's discovery section to the end of existing FOLLOW-UPS.md content.
 *
 * Never reads, reorders or rewrites a byte of `existingContent` - it only decides what
 * separator (if any) belongs between the existing text and the new section, then concatenates.
 * So `appendFollowupsSection(x, ...).startsWith(x)` holds for every `x`, which is the
 * pure-function form of "produces a git diff --numstat with 0 deletions".
 *
 * @param {string} existingContent - the file's current contents, or '' / null / undefined for a
 *   file that does not exist yet
 * @param {string} runId
 * @param {string[]} discoveries - non-empty array of self-contained bullet strings, verbatim
 * @param {string} date - ISO date (YYYY-MM-DD); the caller supplies today's UTC date
 * @returns {{text: string, heading: string}}
 */
function appendFollowupsSection(existingContent, runId, discoveries, date) {
  if (!Array.isArray(discoveries) || discoveries.length === 0) {
    throw new Error('appendFollowupsSection: discoveries must be a non-empty array of strings');
  }
  for (const d of discoveries) {
    if (typeof d !== 'string' || !d.trim()) {
      throw new Error('appendFollowupsSection: every discovery must be a non-empty string');
    }
  }
  const heading = buildHeading(runId, date);
  const bulletLines = discoveries.map((d) => `- ${d}`).join('\n');
  const section = `${heading}\n\n${bulletLines}\n`;
  const before = existingContent == null ? '' : String(existingContent);
  if (before === '') { return { text: section, heading }; }
  // Separate the new section from whatever the file already ends with, without touching any of
  // it: one blank line between sections, added only where the existing text does not already
  // end in one.
  const separator = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  return { text: before + separator + section, heading };
}

function main(argv) {
  const positional = [];
  let date = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--date') { date = argv[i + 1]; i += 1; continue; }
    if (a.startsWith('--date=')) { date = a.slice('--date='.length); continue; }
    if (a === '-h' || a === '--help') {
      process.stdout.write('usage: followups-append.js <followupsFile> <runId> <discoveriesJsonFile> [--date YYYY-MM-DD]\n');
      return 0;
    }
    if (a.startsWith('-')) { process.stderr.write('unknown option: ' + a + '\n'); return 2; }
    positional.push(a);
  }
  const [followupsFile, runId, discoveriesJsonFile] = positional;
  if (!followupsFile || !runId || !discoveriesJsonFile) {
    process.stderr.write('usage: followups-append.js <followupsFile> <runId> <discoveriesJsonFile> [--date YYYY-MM-DD]\n');
    return 2;
  }
  if (!date) { date = new Date().toISOString().slice(0, 10); }

  let discoveries;
  try {
    discoveries = JSON.parse(fs.readFileSync(discoveriesJsonFile, 'utf8'));
  } catch (err) {
    process.stderr.write('cannot read/parse ' + discoveriesJsonFile + ': ' + err.message + '\n');
    return 2;
  }

  let before = '';
  try {
    before = fs.readFileSync(followupsFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      process.stderr.write('cannot read ' + followupsFile + ': ' + err.message + '\n');
      return 2;
    }
  }

  let result;
  try {
    result = appendFollowupsSection(before, runId, discoveries, date);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    return 2;
  }

  if (!result.text.startsWith(before)) {
    // Cannot happen given the implementation above; kept as a hard stop rather than a silent
    // overwrite if this function is ever changed to no longer hold that property.
    process.stderr.write('followups-append: refusing to write - the computed content does not start with the existing file, which the whole point of this script is to prevent\n');
    return 2;
  }

  try {
    fs.writeFileSync(followupsFile, result.text);
  } catch (err) {
    process.stderr.write('cannot write ' + followupsFile + ': ' + err.message + '\n');
    return 2;
  }

  process.stdout.write(JSON.stringify({
    file: followupsFile,
    runId,
    appended: discoveries.length,
    heading: result.heading,
    bytesBefore: Buffer.byteLength(before),
    bytesAfter: Buffer.byteLength(result.text),
  }) + '\n');
  return 0;
}

module.exports = { buildHeading, appendFollowupsSection, main };

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
