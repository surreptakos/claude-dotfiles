#!/usr/bin/env node
/**
 * node --test tools/source-slice.test.js
 *
 * Issue 488. The slice helper every source-assertion test in this repo takes its window with.
 * The bug it exists to end is silent: a renamed tail made `indexOf` return -1, the slice ran to
 * end-of-file, and the assertions that followed were satisfied by a later prompt's text. So the
 * test that matters here is the one that passes a tail the file does not contain and demands a
 * failure.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { sliceBetween, sliceBetweenTags, sliceFrom, SourceSliceError } = require('./source-slice.js');

const FLEET_SCRIPT = path.join(__dirname, '..', 'aac-skills', 'ticket-fleet', 'ticket-fleet.js');

test('a tail the file does not contain raises a named failure instead of slicing to end-of-file', () => {
  const src = fs.readFileSync(FLEET_SCRIPT, 'utf8');
  const start = 'Implement GitHub issue';
  assert.ok(src.includes(start), 'the fleet script must still carry the implementer prompt this test anchors on');
  assert.throws(
    () => sliceBetween(src, start, 'label: `this tail was renamed away`', 'the implementer prompt'),
    (err) => {
      assert.ok(err instanceof SourceSliceError, `expected a SourceSliceError, got ${err && err.name}`);
      assert.match(err.message, /the implementer prompt/, 'the failure must name what was being sliced');
      assert.match(err.message, /this tail was renamed away/, 'and the anchor that is gone');
      return true;
    },
    'a missing tail must fail the test that depends on it, not run the slice to the end of the file');
  // The start anchor is the same trap from the other end: indexOf -1 would slice the whole file.
  assert.throws(() => sliceBetween(src, 'no prompt opens with this', 'label: `impl:'), SourceSliceError);
  assert.throws(() => sliceFrom(src, 'no section is headed this'), SourceSliceError);
});

test('the window a present pair of anchors returns keeps the start literal and drops the tail', () => {
  const text = 'head\nSTART middle TAIL tail\n';
  assert.equal(sliceBetween(text, 'START', 'TAIL'), 'START middle ');
  assert.equal(sliceFrom(text, 'START'), 'START middle TAIL tail\n');
  assert.equal(sliceBetweenTags('x// [A-START]\nbody\n// [A-END]y', '// [A-START]', '// [A-END]'), '\nbody\n');
  // A tail that occurs only before the start anchor is still a missing tail.
  assert.throws(() => sliceBetween('TAIL then START', 'START', 'TAIL'), SourceSliceError);
});
