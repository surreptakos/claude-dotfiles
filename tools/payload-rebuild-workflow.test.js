#!/usr/bin/env node
/**
 * node --test tools/payload-rebuild-workflow.test.js
 *
 * Issue 1308: a PR carries sources only, and .github/workflows/payload-rebuild.yml rebuilds the
 * plugin payload and both version files on master after each merge. Pinned here, one per stated
 * behaviour:
 *   - the rebuild runs on a push to master only, with the two regeneration commands verbatim
 *   - it cannot trigger itself: bot-actor and commit-marker guards, [skip ci], GITHUB_TOKEN only
 *   - it checks master against a fresh build after its commit
 *   - skill-stamps.yml no longer fails a PR whose payload is behind master, and fails one that
 *     edits the payload
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const REBUILD = read('.github/workflows/payload-rebuild.yml');
const STAMPS = read('.github/workflows/skill-stamps.yml');
const code = (yml) => yml.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');

test('the rebuild runs on a push to master, never on a pull request', () => {
  const on = code(REBUILD).match(/^on:\n([\s\S]*?)\n\S/m)[1];
  assert.match(on, /push:\n\s+branches: \[master\]/);
  assert.doesNotMatch(on, /pull_request/);
  assert.match(code(REBUILD), /permissions:\n\s+contents: write/);
});

test('the rebuild runs the two regeneration commands with the owner home', () => {
  const body = code(REBUILD);
  assert.ok(body.includes("python3 tools/skill-stamps.py stamp aac-skills --home 'C:\\Users\\Dan'"));
  assert.ok(body.includes("python3 tools/build-cloud-plugin.py --home 'C:\\Users\\Dan'\n"));
  assert.match(body, /git add -A -- aac-skills marketplace \.claude-plugin\/marketplace\.json/);
  assert.match(body, /git push origin HEAD:master/);
});

test('the rebuild cannot trigger itself in a loop', () => {
  const body = code(REBUILD);
  assert.match(body, /github\.actor != 'github-actions\[bot\]'/, 'skips a push made by the bot');
  assert.match(body, /!contains\(github\.event\.head_commit\.message, '\[payload-rebuild\]'\)/,
    'skips its own commit by marker');
  const commit = body.match(/git commit -m "([^"]+)"/);
  assert.ok(commit, 'the job commits with a message it controls');
  assert.ok(commit[1].includes('[payload-rebuild]') && commit[1].includes('[skip ci]'),
    `its commit carries both the marker and [skip ci]: ${commit[1]}`);
  // GITHUB_TOKEN pushes start no workflow; a PAT or deploy key would let this push re-trigger it.
  assert.doesNotMatch(body, /secrets\.|token:|ssh-key:/, 'push with the default GITHUB_TOKEN only');
  // Nothing to commit when the payload is current, so a re-run is a fixed point.
  assert.match(body, /if git diff --cached --quiet; then[\s\S]*?exit 0/);
});

test('the rebuild checks master against a fresh build after its commit', () => {
  const body = code(REBUILD);
  const verify = body.slice(body.indexOf('name: Master matches a fresh build'));
  assert.ok(verify.length > 0 && verify.includes('--no-marketplace --no-stamp-write'));
  assert.match(verify, /diff -r [^\n]*\/tmp\/verify\/aac-skills marketplace\/aac-skills/);
  assert.match(verify, /skill-stamps\.py check aac-skills --home 'C:\\Users\\Dan'/);
});

test('skill-stamps.yml passes a PR whose payload is behind master and fails one that edits it', () => {
  const body = code(STAMPS);
  assert.doesNotMatch(body, /diff -r/, 'no step compares the committed payload with a rebuild');
  assert.match(body, /skill-stamps\.py check aac-skills --home 'C:\\Users\\Dan'/, 'stamps are still checked');
  assert.match(body, /build-cloud-plugin\.py --home 'C:\\Users\\Dan' --no-stamp-write\n/,
    'the payload must still build, in the runner, without touching the sources');
  const guard = body.slice(body.indexOf('name: A pull request leaves the generated payload alone'));
  assert.match(guard, /github\.event_name == 'pull_request'/);
  assert.match(guard, /git diff --name-only "\$BASE\.\.\.\$HEAD" -- marketplace \.claude-plugin\/marketplace\.json/);
});
