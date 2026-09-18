#!/usr/bin/env node
/**
 * node --test tools/tracker-audit-template.test.js
 *
 * The project-harness skill installs `templates/tracker-audit.js` into every harnessed repo. It
 * used to be a second, hand-maintained copy of `tools/tracker-audit.js`, nothing compared the two,
 * and it silently fell two fixes behind (issue 336): the citation narrowing that stops
 * `owner/other-repo#157` and the hex colour `#9a690f` reading as this repo's #157 and #9, and the
 * `duplicate-title?` advisory. The template is now GENERATED from the repo copy, and these tests
 * are the tripwire — a fix to `tools/tracker-audit.js` that is not regenerated fails here rather
 * than shipping a stale audit to eight repos.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');

const { renderTemplate, SOURCE, TARGET } = require('./build-harness-tracker-audit.js');
const repoCopy = require('./tracker-audit.js');
const template = require('../aac-skills/project-harness/templates/tracker-audit.js');

test('the template is the generated copy of tools/tracker-audit.js, byte for byte', () => {
  assert.strictEqual(
    fs.readFileSync(TARGET, 'utf8'),
    renderTemplate(fs.readFileSync(SOURCE, 'utf8')),
    'template is stale — run: node tools/build-harness-tracker-audit.js'
  );
});

test('the template carries the citedIssueNumbers citation narrowing', () => {
  const body = [
    'Ported from surreptakos/aac-contract-builder#157 and blocked by #42.',
    'The swatch is #9a690f, not a ticket.',
  ].join('\n');
  const cited = template.citedIssueNumbers(body);
  assert.deepStrictEqual([...cited.keys()], [42]);
  assert.deepStrictEqual([...cited.keys()], [...repoCopy.citedIssueNumbers(body).keys()]);
});

test('the template carries the duplicate-title? advisory', () => {
  assert.match(fs.readFileSync(TARGET, 'utf8'), /'duplicate-title\?'/);
  const open = [
    { number: 285, title: "tracker-audit's comments fetch still swallows a short page" },
    { number: 281, title: "The tracker-audit's comments fetch swallows a short page again" },
  ];
  const found = template.duplicateTitleFindings(open);
  assert.strictEqual(found.length, 1);
  assert.strictEqual(found[0].issue.number, 285);
  assert.strictEqual(found[0].duplicateOf.number, 281);
  assert.deepStrictEqual(found, repoCopy.duplicateTitleFindings(open));
});
