#!/usr/bin/env node
/**
 * node --test tools/review-meaning-copies.test.js
 *
 * The audit and the self-check each carry the review meaning module and the Jev client beside
 * their script (issue 1243), because the plugin payload resolves nothing outside a skill folder.
 * The two copies must never drift: a meaning check fixed in one folder and not the other would
 * give the manager and the skip-level different verdicts on the same draft. Edit one, copy it
 * over the other. The CLI tests are tests/review-meaning.test.py.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const skills = path.join(__dirname, '..', 'aac-skills');
const audit = path.join(skills, 'aac-performance-review-audit');
const selfCheck = path.join(skills, 'aac-review-self-check');

for (const name of ['review_meaning.py', 'jev.py']) {
  test(`${name}: the audit and self-check copies are byte-identical`, () => {
    const a = fs.readFileSync(path.join(audit, name));
    const b = fs.readFileSync(path.join(selfCheck, name));
    assert.ok(a.equals(b), `${name} differs between the two skill folders: copy one over the other`);
  });
}
