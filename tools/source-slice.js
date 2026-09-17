#!/usr/bin/env node
/**
 * The slice a source-assertion test takes out of a file it reads as text.
 *
 * Issue 488. Tests all over this repo pin the wording of a prompt, a section or a marked block by
 * slicing the file between two string literals:
 *
 *     src.slice(src.indexOf(start), src.indexOf(tail, start))
 *
 * When one of those literals is renamed in the source, `indexOf` returns -1 and the slice does not
 * fail - `slice(start, -1)` quietly runs to the last character of the file, so the assertions that
 * follow are satisfied by whatever text happens to come next. That is how
 * `tools/editable-install-guard.test.js` spent several runs asserting a rail against the wrong
 * prompt (fixed for that one entry in PR #466). A green test meant nothing.
 *
 * These helpers turn the -1 into a named failure that says which literal is gone, so a renamed
 * anchor fails the test that depends on it instead of disarming it.
 */
'use strict';

/** Raised when an anchor a source-assertion test slices on is no longer in the file. */
class SourceSliceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SourceSliceError';
  }
}

const label = (what) => (what ? `${what}: ` : '');
const show = (literal) => JSON.stringify(literal);

/**
 * The text from `start` (inclusive) up to `tail` (exclusive).
 * Throws `SourceSliceError` naming the missing literal rather than slicing to end-of-file.
 *
 * @param {string} text   the file's contents
 * @param {string} start  literal the slice begins at
 * @param {string} tail   literal the slice ends before, searched after `start`
 * @param {string} [what] what is being sliced, for the failure message
 */
function sliceBetween(text, start, tail, what) {
  const s = text.indexOf(start);
  if (s < 0) throw new SourceSliceError(`${label(what)}the start anchor ${show(start)} is gone from the file`);
  const e = text.indexOf(tail, s + start.length);
  if (e < 0) {
    throw new SourceSliceError(
      `${label(what)}the tail anchor ${show(tail)} does not follow ${show(start)} - it was renamed or removed, `
      + 'and slicing to end-of-file would let the assertions pass on some later text');
  }
  return text.slice(s, e);
}

/**
 * The text between a marker pair, both markers excluded - the `// [NAME-START]` / `// [NAME-END]`
 * blocks the fleet script and the skills carry for their tests to evaluate.
 */
function sliceBetweenTags(text, startTag, endTag, what) {
  return sliceBetween(text, startTag, endTag, what).slice(startTag.length);
}

/**
 * The text from `start` (inclusive) to the end of the file - the deliberate "rest of it" slice.
 * Throws when `start` is gone rather than returning the file's last character.
 */
function sliceFrom(text, start, what) {
  const s = text.indexOf(start);
  if (s < 0) throw new SourceSliceError(`${label(what)}the start anchor ${show(start)} is gone from the file`);
  return text.slice(s);
}

module.exports = { sliceBetween, sliceBetweenTags, sliceFrom, SourceSliceError };
