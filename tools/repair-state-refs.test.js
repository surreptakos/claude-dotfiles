#!/usr/bin/env node
/**
 * node --test tools/repair-state-refs.test.js
 *
 * Tests for tools/repair-state-refs.js (issue 92). The pure `rewrite` and `contextFor`
 * functions are exercised exhaustively — including the collision case (a bare `#N` valid in
 * BOTH claude-dotfiles and the owning repo) that the attempt-3 verifier reproduced live on
 * `surreptakos/claude-dotfiles#75` line 570. `knownNumbers` and `repair` are exercised
 * end-to-end against an in-process fake `gh` runner (opts.runGh), so the read path
 * (issue view + issue/pr list) AND the write path (`gh issue edit --body-file -`) are both
 * under test.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { rewrite, repair, knownNumbers, contextFor, REPOS, DOTFILES, CONTEXT_WINDOW } =
  require('./repair-state-refs.js');

const REPO = 'surreptakos/aac-contract-builder';
// Every low dotfiles number ALSO exists in aac-contract-builder in the live repo (verified
// 2026-09-14: 178 dotfiles numbers, all colliding with aac-contract-builder). The tests keep
// that overlap so a naive "prefer knownRepo" or "prefer knownDotfiles" mistake would fail on
// the collision cases below.
const knownDotfiles = new Set([44, 92, 116, 123, 125, 157, 158, 217]);
const knownRepo     = new Set([44, 92, 116, 123, 125, 157, 158, 217, 237]);

// ---- rewrite: pure function, exhaustive discipline ---------------------------------------

test('bare #N with no nearby repo mention is left alone (safe default)', () => {
  const [out, n] = rewrite('the registry lives in #44.', knownDotfiles, knownRepo, REPO);
  assert.equal(out, 'the registry lives in #44.');
  assert.equal(n, 0);
});

test('bare #N preceded by owning-repo mention is qualified', () => {
  const [out, n] = rewrite('surreptakos/aac-contract-builder#237 opened; #157 landed.',
    knownDotfiles, knownRepo, REPO);
  assert.equal(out,
    'surreptakos/aac-contract-builder#237 opened; surreptakos/aac-contract-builder#157 landed.');
  assert.equal(n, 1);
});

test('bare #N preceded by claude-dotfiles mention stays bare (legitimate dotfiles ref)', () => {
  const body = 'brief `surreptakos/claude-dotfiles#125` closed; comment on #116 was noise.';
  const [out, n] = rewrite(body, knownDotfiles, knownRepo, REPO);
  assert.equal(out, body);
  assert.equal(n, 0);
});

test('collision case: "closed #123" after an owning-repo mention IS qualified', () => {
  // Verbatim from surreptakos/claude-dotfiles#75 line 570 (paraphrased): the master wrote
  // `merged … surreptakos/aac-contract-builder#216 … and closed #123`. #123 exists in BOTH
  // repos; the attempt-3 tool left it bare because it checked knownDotfiles first. The
  // context-aware rewrite catches it.
  const body = 'merged spec PR surreptakos/aac-contract-builder#216 at 17:31Z and closed #123.';
  const [out, n] = rewrite(body, knownDotfiles, knownRepo, REPO);
  assert.equal(out,
    'merged spec PR surreptakos/aac-contract-builder#216 at 17:31Z and closed surreptakos/aac-contract-builder#123.');
  assert.equal(n, 1);
});

test('already-qualified owner/repo#N round-trips unchanged', () => {
  const original = 'surreptakos/aac-contract-builder#217 merged.';
  const [out, n] = rewrite(original, knownDotfiles, knownRepo, REPO);
  assert.equal(out, original);
  assert.equal(n, 0);
});

test('truly dangling #N (in neither set) is left alone; the audit still flags it', () => {
  const [out, n] = rewrite('cites #9999 which is unknown.', knownDotfiles, knownRepo, REPO);
  assert.equal(out, 'cites #9999 which is unknown.');
  assert.equal(n, 0);
});

test('mixed refs: owning-repo bare qualified, dotfiles bare left alone', () => {
  // A paragraph that mentions both repos: the closest preceding mention decides for each
  // bare ref. `#157` sits after `aac-contract-builder`; `#44` sits after `claude-dotfiles`.
  const body = 'surreptakos/aac-contract-builder#237 references #157; surreptakos/claude-dotfiles#125 references #44.';
  const [out, n] = rewrite(body, knownDotfiles, knownRepo, REPO);
  assert.equal(out,
    'surreptakos/aac-contract-builder#237 references surreptakos/aac-contract-builder#157; surreptakos/claude-dotfiles#125 references #44.');
  assert.equal(n, 1);
});

test('word-char before # is not a bare ref (branch names, hex)', () => {
  const body = 'surreptakos/aac-contract-builder#237 near branch abc#123 and hash deadbeef#158.';
  const [out, n] = rewrite(body, knownDotfiles, knownRepo, REPO);
  assert.equal(out, body);
  assert.equal(n, 0);
});

test('parenthesised bare #N following an owning-repo mention is qualified', () => {
  const [out, n] = rewrite('surreptakos/aac-contract-builder#237 cleanup (#158) and doc.',
    knownDotfiles, knownRepo, REPO);
  assert.equal(out,
    'surreptakos/aac-contract-builder#237 cleanup (surreptakos/aac-contract-builder#158) and doc.');
  assert.equal(n, 1);
});

test('the same number appearing many times is qualified each time when context matches', () => {
  const [out, n] = rewrite(
    'surreptakos/aac-contract-builder#237 first; #157 opened. later #157 landed. finally #157 closed.',
    knownDotfiles, knownRepo, REPO);
  assert.equal(out,
    'surreptakos/aac-contract-builder#237 first; surreptakos/aac-contract-builder#157 opened. ' +
    'later surreptakos/aac-contract-builder#157 landed. finally surreptakos/aac-contract-builder#157 closed.');
  assert.equal(n, 3);
});

test('empty body is a no-op', () => {
  const [out, n] = rewrite('', knownDotfiles, knownRepo, REPO);
  assert.equal(out, '');
  assert.equal(n, 0);
});

test('start-of-line bare #N with no prior repo mention stays bare', () => {
  const [out, n] = rewrite('#217 opened.\n#44 registry.', knownDotfiles, knownRepo, REPO);
  assert.equal(out, '#217 opened.\n#44 registry.');
  assert.equal(n, 0);
});

test('a repo mention farther than CONTEXT_WINDOW does not disambiguate', () => {
  // A window of 500 bytes; put the owner mention just past it, then a bare #157.
  const filler = ' '.repeat(CONTEXT_WINDOW + 10);
  const body = 'surreptakos/aac-contract-builder#237' + filler + '#157 opened.';
  const [out, n] = rewrite(body, knownDotfiles, knownRepo, REPO);
  assert.equal(out, body);
  assert.equal(n, 0);
});

test('an unrelated repo mention just before the bare #N leaves it bare', () => {
  // A state issue for one master may mention another master's repo. Refuse to guess.
  const body = 'surreptakos/aac-bill-intake#42 unrelated; then #157.';
  const [out, n] = rewrite(body, knownDotfiles, knownRepo, REPO);
  assert.equal(out, body);
  assert.equal(n, 0);
});

test('REPOS table matches the watchdog $Repos rows (slug, repo, stateIssue triples)', () => {
  assert.deepEqual(
    REPOS.map((r) => [r.slug, r.repo, r.stateIssue]),
    [
      ['bill-intake',      'surreptakos/aac-bill-intake',      74],
      ['contract-builder', 'surreptakos/aac-contract-builder', 75],
      ['sales-cockpit',    'surreptakos/aac-sales-cockpit',    76],
      ['zoho',             'surreptakos/zoho-source-of-truth', 77],
    ]);
  assert.equal(DOTFILES, 'surreptakos/claude-dotfiles');
});

// ---- contextFor: direct coverage of the disambiguator -------------------------------------

test('contextFor: owning-repo mention immediately before returns "repo"', () => {
  const body = 'surreptakos/aac-contract-builder#237 then #157';
  const hashAt = body.indexOf('#157');
  assert.equal(contextFor(body, hashAt, REPO), 'repo');
});

test('contextFor: dotfiles mention immediately before returns "dotfiles"', () => {
  const body = '`surreptakos/claude-dotfiles#125` then #44';
  const hashAt = body.indexOf('#44');
  assert.equal(contextFor(body, hashAt, REPO), 'dotfiles');
});

test('contextFor: no mention within window returns null', () => {
  const body = 'the registry lives in #44.';
  const hashAt = body.indexOf('#44');
  assert.equal(contextFor(body, hashAt, REPO), null);
});

// ---- knownNumbers: injected gh runner, no real subprocess ---------------------------------

function makeFakeGh(canned) {
  const calls = [];
  function runGh(args, input) {
    calls.push({ args: args.slice(), input });
    const key = JSON.stringify(args);
    if (!(key in canned)) throw new Error('fake gh: unexpected call ' + key);
    const val = canned[key];
    if (typeof val === 'function') return val(args, input);
    return val;
  }
  runGh.calls = calls;
  return runGh;
}

test('knownNumbers merges issues and PRs into one Set (dedupes shared numbers)', () => {
  const gh = makeFakeGh({
    [JSON.stringify(['issue', 'list', '-R', REPO, '--state', 'all', '--limit', '1000', '--json', 'number'])]:
      JSON.stringify([{ number: 1 }, { number: 42 }, { number: 157 }]),
    [JSON.stringify(['pr',    'list', '-R', REPO, '--state', 'all', '--limit', '1000', '--json', 'number'])]:
      JSON.stringify([{ number: 217 }, { number: 42 }]),
  });
  const nums = knownNumbers(REPO, gh);
  assert.equal(nums.size, 4);
  assert.deepEqual([...nums].sort((a, b) => a - b), [1, 42, 157, 217]);
  assert.equal(gh.calls.length, 2);
});

// ---- repair: end-to-end with a fake gh, both read AND write paths -------------------------

function buildFakeForRepair({ body, dotfilesNums = [44, 92, 116, 123, 125], repoNums = [44, 92, 116, 123, 125, 157, 158, 217, 237] }) {
  const row = REPOS.find((r) => r.slug === 'contract-builder');
  const writes = [];
  const canned = {};
  canned[JSON.stringify(['issue', 'view', String(row.stateIssue), '-R', DOTFILES, '--json', 'body', '-q', '.body'])] = body;
  canned[JSON.stringify(['issue', 'list', '-R', DOTFILES, '--state', 'all', '--limit', '1000', '--json', 'number'])] = JSON.stringify(dotfilesNums.map((n) => ({ number: n })));
  canned[JSON.stringify(['pr',    'list', '-R', DOTFILES, '--state', 'all', '--limit', '1000', '--json', 'number'])] = JSON.stringify([]);
  canned[JSON.stringify(['issue', 'list', '-R', row.repo, '--state', 'all', '--limit', '1000', '--json', 'number'])]  = JSON.stringify(repoNums.map((n) => ({ number: n })));
  canned[JSON.stringify(['pr',    'list', '-R', row.repo, '--state', 'all', '--limit', '1000', '--json', 'number'])]  = JSON.stringify([]);
  canned[JSON.stringify(['issue', 'edit', String(row.stateIssue), '-R', DOTFILES, '--body-file', '-'])] = (args, input) => {
    writes.push(input);
    return '';
  };
  return { row, gh: makeFakeGh(canned), writes };
}

test('repair: dirty body triggers gh issue edit with the qualified body (collision case)', () => {
  // This is the exact scenario the attempt-3 verifier reproduced: #123 sits in both repos,
  // and the closest preceding qualified ref is aac-contract-builder — the tool MUST qualify.
  const dirty = 'Heartbeat 5\n\nMerged PR surreptakos/aac-contract-builder#216 and closed #123.\n';
  const clean = 'Heartbeat 5\n\nMerged PR surreptakos/aac-contract-builder#216 and closed surreptakos/aac-contract-builder#123.\n';
  const { row, gh, writes } = buildFakeForRepair({ body: dirty });
  const res = repair(row, { runGh: gh });
  assert.equal(res.changed, 1);
  assert.equal(res.wrote, true);
  assert.equal(res.newBody, clean);
  assert.equal(writes.length, 1);
  assert.equal(writes[0], clean);
});

test('repair: already-clean body skips gh issue edit entirely (idempotent)', () => {
  // Two bare refs, both with dotfiles context — neither should be rewritten.
  const clean = 'Registry #44 is fixed. Decision brief `surreptakos/claude-dotfiles#125` cites #116.';
  const { row, gh, writes } = buildFakeForRepair({ body: clean });
  const res = repair(row, { runGh: gh });
  assert.equal(res.changed, 0);
  assert.equal(res.wrote, false);
  assert.equal(writes.length, 0);
  assert.equal(gh.calls.filter((c) => c.args[1] === 'edit').length, 0);
  assert.ok(gh.calls.some((c) => c.args[1] === 'view'));
});

test('repair --dry-run: dirty body, no gh issue edit', () => {
  const dirty = 'surreptakos/aac-contract-builder#237 references #217 which needs qualifying.';
  const { row, gh, writes } = buildFakeForRepair({ body: dirty });
  const res = repair(row, { runGh: gh, dryRun: true });
  assert.equal(res.changed, 1);
  assert.equal(res.wrote, false);
  assert.equal(res.dryRun, true);
  assert.equal(writes.length, 0);
});

test('repair: CRLF in fetched body is normalised to LF before rewriting', () => {
  const dirty = 'surreptakos/aac-contract-builder#237 first\r\n#157 here\r\nlast line\r\n';
  const { row, gh, writes } = buildFakeForRepair({ body: dirty });
  const res = repair(row, { runGh: gh });
  assert.equal(res.changed, 1);
  assert.equal(res.wrote, true);
  assert.equal(res.newBody, 'surreptakos/aac-contract-builder#237 first\n' + 'surreptakos/aac-contract-builder#157 here\n' + 'last line\n');
  assert.equal(writes[0], res.newBody);
});

test('repair: opts.knownDotfiles / opts.knownRepo bypass the list calls', () => {
  // #999 is not in knownRepo, so it stays bare. #157 is in knownRepo and the closest
  // preceding repo mention is aac-contract-builder, so it qualifies.
  const dirty = 'surreptakos/aac-contract-builder#237 ref #157 and #999';
  const { row, gh, writes } = buildFakeForRepair({ body: dirty });
  const res = repair(row, { runGh: gh, knownDotfiles: new Set([44]), knownRepo: new Set([157, 237]) });
  assert.equal(res.changed, 1);
  assert.equal(res.wrote, true);
  assert.equal(writes[0], 'surreptakos/aac-contract-builder#237 ref surreptakos/aac-contract-builder#157 and #999');
  const kinds = gh.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.deepEqual(kinds.filter((k) => k.endsWith('list')), []);
});
