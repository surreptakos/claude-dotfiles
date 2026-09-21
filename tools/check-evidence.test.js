#!/usr/bin/env node
/**
 * node --test tools/check-evidence.test.js
 *
 * Issue 621. The grounding check for a research or memory note. What has to hold: a number the
 * cited source does not carry fails and names the line; a note whose facts are all in the source
 * passes; and a source nobody could read never comes back as a pass — the failure mode of a
 * grounding check is a green run over evidence it never opened.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'check-evidence.js');
const { checkNote, extractFacts, citedSources } = require('./check-evidence.js');

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-evidence-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const SOURCE = [
  'Debug log: provided additionalContext (1833 chars) under CLI 2.1.273 on 2026-09-16.',
  'A fresh session reported 30 notes and answered: "pwsh=none, prove .ps1 on the PC".',
  '',
].join('\n');

test('a number absent from the cited source exits 1 and names the line', () => {
  const dir = fixture({
    'raw.md': SOURCE,
    'note.md': '# Note\n\nSource: raw.md\n\nThe hook injected 1900 chars under CLI 2.1.273.\n',
  });
  const res = run(path.join(dir, 'note.md'));
  assert.equal(res.status, 1, 'a miss must exit 1, not 0');
  assert.match(res.stdout, /note\.md:5 fact not found in raw\.md: 1900/,
    'the finding must carry the note line the fact is on and the source it is missing from');
  assert.doesNotMatch(res.stdout, /2\.1\.273/, 'a fact the source does carry is not a finding');
});

test('a note whose facts all appear in the cited source exits 0', () => {
  const dir = fixture({
    'raw.md': SOURCE,
    'note.md': '# Note\n\nSource: raw.md\n\nOn 2026-09-16 the hook injected 1833 chars; 30 notes,\n'
      + 'and the session quoted "pwsh=none, prove .ps1 on the\nPC" back.\n',
  });
  const res = run(path.join(dir, 'note.md'));
  assert.equal(res.status, 0, `a grounded note must pass, got:\n${res.stdout}`);
  assert.match(res.stdout, /1 source\(s\) checked, 0 not found/);
  // The quotation wraps across two lines in the note and one in the source: still one fact.
  const facts = checkNote(path.join(dir, 'note.md')).facts.filter((f) => f.kind === 'quote');
  assert.deepEqual(facts.map((f) => f.text.replace(/\s+/g, ' ')), ['pwsh=none, prove .ps1 on the PC']);
});

test('a source that could not be read is reported unchecked, never as a pass', () => {
  const dir = fixture({
    'url.md': '# Note\n\nSource: https://example.invalid/spec\n\nThe budget is 2048 bytes.\n',
    'gone.md': '# Note\n\nSource: no-such-file.md\n\nThe budget is 2048 bytes.\n',
    'bare.md': '# Note\n\nThe budget is 2048 bytes, and nothing here says where that came from.\n',
  });
  for (const [name, why] of [['url.md', /unchecked https:\/\/example\.invalid\/spec/],
    ['gone.md', /unchecked no-such-file\.md \(no such file\)/],
    ['bare.md', /no cited sources/]]) {
    const res = run(path.join(dir, name));
    assert.notEqual(res.status, 0, `${name} was certified clean over evidence nothing read`);
    assert.equal(res.status, 3, `${name}: unchecked is exit 3, a miss is exit 1`);
    assert.match(res.stdout, why);
  }
});

test('what counts as a fact and as a citation — the contract the header states', () => {
  const lines = [
    'See [the gate](tests/bootstrap-test.sh) and [the ticket](https://example.invalid/issues/621).',
    'Worker wf_911fa64d-102-10 held the live copy; v27 of the harness, 1,833 chars.',
  ];
  const { sources } = citedSources(lines);
  assert.deepEqual(sources.map((s) => s.ref),
    ['tests/bootstrap-test.sh', 'https://example.invalid/issues/621']);

  const facts = extractFacts(lines).map((f) => f.text);
  assert.ok(!facts.includes('621'), 'a number inside a link target is not a claim the note makes');
  assert.ok(!facts.some((f) => ['911', '102', '10'].includes(f)),
    `a worker id is a name, not a claim: ${facts.join(', ')}`);
  assert.ok(facts.includes('27') && facts.includes('1,833'), `expected the real numbers, got ${facts.join(', ')}`);

  // A thousands separator may differ between note and source; a longer number does not match.
  const dir = fixture({
    'raw.md': 'injected 1833 chars, check 129 of 200\n',
    'note.md': 'Source: raw.md\n\nIt injected 1,833 chars on check 29.\n',
  });
  const res = run(path.join(dir, 'note.md'));
  assert.equal(res.status, 1);
  assert.match(res.stdout, /fact not found in raw\.md: 29$/m, '129 must not satisfy the claim of 29');
  assert.doesNotMatch(res.stdout, /1,833/, '1,833 is satisfied by 1833 in the source');
});
