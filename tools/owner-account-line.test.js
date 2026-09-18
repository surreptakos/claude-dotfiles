#!/usr/bin/env node
/**
 * node --test tools/owner-account-line.test.js
 *
 * Covers the four things issue 114 pins:
 *   - apply is idempotent (a second run rewrites the same bytes)
 *   - check exits 1 when the line disagrees with the registry (missing, wrong owner, wrong surfaces)
 *   - render matches the registry's ({owner, surfaces}) for every live repo
 *   - the emitted line passes tools/claude-md-lint.js (its "keeps the reader from a wrong-account
 *     session" test is why the line stays)
 *
 * The last assertion is what stops a future style rule from silently deleting the line: a rule
 * that fires on the block breaks this test.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const CLI = path.join(__dirname, 'owner-account-line.js');
const {
  renderLine,
  renderBlock,
  renderSurfaces,
  extractLine,
  updateContent,
  findRepoEntry,
  surfacesFor,
  BEGIN_MARK,
  END_MARK,
  INSTRUCTIONS_CANDIDATES,
  pickInstructionsFile,
  liveRepos,
  indexClonesUnder,
  checkAll,
  rollup,
  readViaGithub,
} = require('./owner-account-line.js');
const { lint } = require('./claude-md-lint.js');

// A minimal registry that mirrors the shape of profile/claude/accounts.json without depending on the live
// file. Each account gets a distinct surface list so a swapped label produces a visibly different
// line.
function fixtureRegistry() {
  return {
    accounts: {
      'Dan-AAC': { uuid: 'aaa', surfaces: ['desktop'] },
      Dan: { uuid: 'bbb', surfaces: ['cli', 'mobile', 'web', 'task-scheduler'] },
      'Active Alarm': { uuid: '', surfaces: ['cowork', 'cloud-routines'] },
    },
    repos: {
      'surreptakos/claude-dotfiles': { owner: 'Dan-AAC' },
      'surreptakos/aac-contract-builder': { owner: 'Dan' },
      'surreptakos/aac-task-management': { owner: 'Dan-AAC', status: 'dead' },
    },
  };
}

function makeRepo(mdBody, slug) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-account-line-'));
  const regPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(regPath, JSON.stringify(fixtureRegistry()));
  const repoPath = path.join(dir, 'repo');
  fs.mkdirSync(repoPath);
  fs.writeFileSync(path.join(repoPath, 'CLAUDE.md'), mdBody);
  return { dir, regPath, repoPath, slug };
}

function cli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('render: friendly surface names, one line per registry entry', () => {
  assert.equal(renderLine('Dan-AAC', ['desktop']), 'Owner account: Dan-AAC (desktop app)');
  assert.equal(
    renderLine('Dan', ['cli', 'mobile', 'web', 'task-scheduler']),
    'Owner account: Dan (CLI, mobile app, claude.ai/code, task scheduler)'
  );
  // unknown surfaces render verbatim so a new registry surface does not need a code change here
  assert.equal(renderSurfaces(['brand-new']), 'brand-new');
  // no surfaces
  assert.equal(renderSurfaces([]), 'no surfaces registered');
});

test('findRepoEntry / surfacesFor pull the right fields for every live repo shape', () => {
  const reg = fixtureRegistry();
  const dotfiles = findRepoEntry(reg, 'surreptakos/claude-dotfiles');
  assert.equal(dotfiles.owner, 'Dan-AAC');
  assert.deepEqual(surfacesFor(reg, dotfiles.owner), ['desktop']);
  const cb = findRepoEntry(reg, 'surreptakos/aac-contract-builder');
  assert.equal(cb.owner, 'Dan');
  assert.deepEqual(surfacesFor(reg, cb.owner), ['cli', 'mobile', 'web', 'task-scheduler']);
  // Case-insensitive slug lookup: GitHub treats owner/repo as case-insensitive.
  assert.equal(findRepoEntry(reg, 'SURREPTAKOS/Claude-Dotfiles').owner, 'Dan-AAC');
  // Missing entry
  assert.equal(findRepoEntry(reg, 'somebody/else'), null);
});

test('apply: idempotent — the second run produces the same bytes', () => {
  const md = '# repo\n\nintro paragraph.\n\n## Section\n\nbody.\n';
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/claude-dotfiles');
  const first = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const afterFirst = fs.readFileSync(path.join(repoPath, 'CLAUDE.md'), 'utf8');
  const second = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(second.status, 0, second.stdout + second.stderr);
  assert.equal(fs.readFileSync(path.join(repoPath, 'CLAUDE.md'), 'utf8'), afterFirst);
  // The block landed right after the H1 (line 0) and its trailing blank line.
  const lines = afterFirst.split('\n');
  assert.equal(lines[0], '# repo');
  assert.equal(lines[1], '');
  assert.equal(lines[2], BEGIN_MARK);
  assert.equal(lines[3], 'Owner account: Dan-AAC (desktop app)');
  assert.equal(lines[4], END_MARK);
});

test('apply: replaces an out-of-date block in place, does not double-insert', () => {
  const stale = renderBlock('Dan', ['cli']);  // wrong owner and wrong surfaces vs registry
  const md = `# repo\n\n${stale}\n\nbody.\n`;
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/claude-dotfiles');
  const r = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = fs.readFileSync(path.join(repoPath, 'CLAUDE.md'), 'utf8');
  // exactly one block
  const matches = after.match(new RegExp(BEGIN_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
  assert.equal(matches.length, 1);
  assert.equal(extractLine(after), 'Owner account: Dan-AAC (desktop app)');
});

test('check: exits 1 when the block is missing', () => {
  const md = '# repo\n\nno owner block here.\n';
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/claude-dotfiles');
  const r = cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /drift/);
  assert.match(r.stderr, /Dan-AAC/);
});

test('check: exits 1 when the block names the wrong owner', () => {
  const wrong = renderBlock('Dan', ['cli']);
  const md = `# repo\n\n${wrong}\n\nbody.\n`;
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/claude-dotfiles');
  const r = cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /expected: Owner account: Dan-AAC/);
});

test('check: exits 1 when the block names the wrong surfaces', () => {
  // Right owner, but the surface list has drifted (e.g. registry gained "task-scheduler" for Dan).
  const stale = `${BEGIN_MARK}\nOwner account: Dan (CLI, mobile app)\n${END_MARK}`;
  const md = `# repo\n\n${stale}\n\nbody.\n`;
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/aac-contract-builder');
  const r = cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/aac-contract-builder']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /task scheduler/);
});

test('check: passes once apply has run', () => {
  const md = '# repo\n\nintro.\n';
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/claude-dotfiles');
  const applied = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(applied.status, 0);
  const checked = cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /ok/);
});

test('dead repos: no block written, and a stale block is removed on apply', () => {
  const md = '# repo\n\nintro.\n';
  const { regPath, repoPath } = makeRepo(md, 'surreptakos/aac-task-management');
  const r = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/aac-task-management']);
  assert.equal(r.status, 0);
  const after = fs.readFileSync(path.join(repoPath, 'CLAUDE.md'), 'utf8');
  assert.equal(after.includes(BEGIN_MARK), false);
  // check: dead + missing block = ok
  assert.equal(cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/aac-task-management']).status, 0);
  // seed a stale block: apply should strip it
  const withStale = md.replace('# repo\n\n', '# repo\n\n' + renderBlock('Dan-AAC', ['desktop']) + '\n\n');
  fs.writeFileSync(path.join(repoPath, 'CLAUDE.md'), withStale);
  const stripped = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/aac-task-management']);
  assert.equal(stripped.status, 0);
  assert.equal(fs.readFileSync(path.join(repoPath, 'CLAUDE.md'), 'utf8').includes(BEGIN_MARK), false);
  // check on the stale seed alone would have caught it
  fs.writeFileSync(path.join(repoPath, 'CLAUDE.md'), withStale);
  assert.equal(cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/aac-task-management']).status, 1);
});

test('unregistered slug or missing registry: exit 2 (could not audit, not a pass)', () => {
  const { regPath, repoPath } = makeRepo('# repo\n', 'nope/nope');
  assert.equal(cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'nope/nope']).status, 2);
  assert.equal(cli(['check', '--repo', repoPath, '--registry', path.join(repoPath, 'missing.json'), '--slug', 'surreptakos/claude-dotfiles']).status, 2);
  assert.equal(cli(['nonsense'], { encoding: 'utf8' }).status, 2);
  assert.equal(cli([]).status, 2);
});

test('render mode: prints the line without touching any file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-account-render-'));
  const regPath = path.join(dir, 'accounts.json');
  fs.writeFileSync(regPath, JSON.stringify(fixtureRegistry()));
  const r = cli(['render', '--registry', regPath, '--slug', 'surreptakos/claude-dotfiles']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'Owner account: Dan-AAC (desktop app)');
});

test('updateContent: preserves CRLF line endings when the file uses them', () => {
  const md = '# repo\r\n\r\nbody line.\r\n';
  const out = updateContent(md, renderBlock('Dan-AAC', ['desktop']));
  assert.ok(out.includes('\r\n'));
  assert.ok(!/(?<!\r)\n/.test(out));
});

test('the emitted block survives claude-md-lint (all three account shapes)', () => {
  // If any lint rule fires on the emitted block, the ticket's own "keep this line" argument
  // breaks and the tool needs a suppression comment. This asserts the line is clean on its own,
  // and is also clean grafted into a reasonable-looking CLAUDE.md.
  for (const [label, surfaces] of [
    ['Dan-AAC', ['desktop']],
    ['Dan', ['cli', 'mobile', 'web', 'task-scheduler']],
    ['Active Alarm', ['cowork', 'cloud-routines']],
  ]) {
    const block = renderBlock(label, surfaces);
    const bare = lint(block).findings.filter((f) => f.rule !== 'size');
    assert.deepEqual(bare, [], `bare block fired: ${JSON.stringify(bare)}`);

    const grafted = `# my-repo\n\n${block}\n\n## Commands\n\n- Do the thing.\n`;
    const graftedFindings = lint(grafted).findings.filter((f) => f.rule !== 'size');
    assert.deepEqual(graftedFindings, [], `grafted block fired: ${JSON.stringify(graftedFindings)}`);
  }
});

// -------------------------------------------------------------------------- check-all / apply-all
//
// Issue 114's third acceptance criterion — every one of the eight live repos carries the line on
// its default branch — is what these tests defend. Doing that with real network calls or real
// git operations would make the suite flaky and require GitHub credentials, so the driver takes
// its resolver as an argument: checkAll never touches the filesystem or the network. The tests
// exercise the roll-up rules (drift → 1, error → 2, ok → 0), a pass over every live repo in the
// fixture, and the CLI's stdout/stderr wiring for both check-all and apply-all.

test('liveRepos: skips repos flagged dead, returns every other', () => {
  const reg = fixtureRegistry();
  const live = liveRepos(reg);
  assert.equal(live.length, 2);
  assert.deepEqual(live.map((r) => r.slug).sort(), ['surreptakos/aac-contract-builder', 'surreptakos/claude-dotfiles']);
});

test('checkAll: every live repo agrees → exit 0', () => {
  const reg = fixtureRegistry();
  const good = (slug) => {
    const entry = findRepoEntry(reg, slug);
    const surfaces = surfacesFor(reg, entry.owner);
    const block = renderBlock(entry.owner, surfaces);
    return { content: `# ${slug}\n\n${block}\n\nbody\n`, mdPath: `${slug}/CLAUDE.md` };
  };
  const results = checkAll(reg, good);
  assert.equal(rollup(results), 0);
  assert.equal(results.every((r) => r.status === 'ok'), true, JSON.stringify(results));
});

test('checkAll: one repo drifts → exit 1, others still reported', () => {
  const reg = fixtureRegistry();
  const resolver = (slug) => {
    if (slug === 'surreptakos/aac-contract-builder') {
      return { content: `# repo\n\n${renderBlock('Dan-AAC', ['desktop'])}\n\nbody\n`, mdPath: 'x' };
    }
    const entry = findRepoEntry(reg, slug);
    const surfaces = surfacesFor(reg, entry.owner);
    return { content: `# repo\n\n${renderBlock(entry.owner, surfaces)}\n`, mdPath: 'y' };
  };
  const results = checkAll(reg, resolver);
  assert.equal(rollup(results), 1);
  const drifted = results.find((r) => r.slug === 'surreptakos/aac-contract-builder');
  assert.equal(drifted.status, 'drift');
  assert.equal(drifted.expectedLine, 'Owner account: Dan (CLI, mobile app, claude.ai/code, task scheduler)');
});

test('checkAll: no CLAUDE.md on default branch → drift, not error', () => {
  const reg = fixtureRegistry();
  const resolver = (slug) => ({ content: null, notFound: true, mdPath: `${slug}/CLAUDE.md@main` });
  const results = checkAll(reg, resolver);
  assert.equal(rollup(results), 1);
  assert.equal(results.every((r) => r.status === 'drift'), true);
});

test('checkAll: resolver failure → exit 2 (could not audit, not a pass)', () => {
  const reg = fixtureRegistry();
  const resolver = (slug) => {
    if (slug === 'surreptakos/aac-contract-builder') throw new Error('network is down');
    return { content: `# r\n\n${renderBlock('Dan-AAC', ['desktop'])}\n`, mdPath: 'x' };
  };
  const results = checkAll(reg, resolver);
  assert.equal(rollup(results), 2);
  const err = results.find((r) => r.status === 'error');
  assert.match(err.reason, /network is down/);
});

test('checkAll: missing clone → skipped, not counted against exit code', () => {
  const reg = fixtureRegistry();
  const resolver = (slug) => {
    if (slug === 'surreptakos/aac-contract-builder') return { missing: true, reason: 'no clone under X' };
    const e = findRepoEntry(reg, slug);
    return { content: `# r\n\n${renderBlock(e.owner, surfacesFor(reg, e.owner))}\n`, mdPath: 'z' };
  };
  const results = checkAll(reg, resolver);
  assert.equal(rollup(results), 0);
  assert.equal(results.some((r) => r.status === 'skipped'), true);
});

test('checkAll: exercises every live repo in the real profile/claude/accounts.json (registry drift guard)', () => {
  const regPath = path.join(__dirname, '..', 'profile', 'claude', 'accounts.json');
  if (!fs.existsSync(regPath)) return;
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const live = liveRepos(reg);
  assert.ok(live.length >= 1, 'registry should list at least one live repo');
  for (const r of live) {
    assert.ok(reg.accounts[r.owner], `${r.slug} names an unknown owner ${r.owner}`);
  }
  const resolver = (slug) => {
    const e = findRepoEntry(reg, slug);
    return { content: `# r\n\n${renderBlock(e.owner, surfacesFor(reg, e.owner))}\n`, mdPath: slug };
  };
  const results = checkAll(reg, resolver);
  assert.equal(rollup(results), 0, JSON.stringify(results));
});

test('indexClonesUnder: finds a checkout by remote origin URL, ignores unrelated dirs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-clones-'));
  try {
    const a = path.join(root, 'workspace-a'); fs.mkdirSync(a); fs.mkdirSync(path.join(a, '.git'));
    const b = path.join(root, 'workspace-b'); fs.mkdirSync(b); fs.mkdirSync(path.join(b, '.git'));
    const c = path.join(root, 'not-a-repo'); fs.mkdirSync(c);
    const nested = path.join(root, 'vertical', 'aac-cockpit'); fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(path.join(nested, '.git'));
    const urls = {
      [a]: 'https://github.com/surreptakos/claude-dotfiles.git',
      [b]: 'git@github.com:surreptakos/aac-contract-builder',
      [nested]: 'https://github.com/surreptakos/aac-sales-cockpit',
    };
    const map = indexClonesUnder(root, { execOrigin: (p) => urls[p] || '' });
    assert.equal(map.get('surreptakos/claude-dotfiles'), a);
    assert.equal(map.get('surreptakos/aac-contract-builder'), b);
    assert.equal(map.get('surreptakos/aac-sales-cockpit'), nested);
    assert.equal(map.has('surreptakos/nothing'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI check-all --via clones: rolls up local clones, exit 1 on drift', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-checkall-'));
  try {
    const regPath = path.join(dir, 'accounts.json');
    fs.writeFileSync(regPath, JSON.stringify(fixtureRegistry()));
    const clonesRoot = path.join(dir, 'clones');
    fs.mkdirSync(clonesRoot);

    for (const [name, slug, ownerBlock] of [
      ['claude-dotfiles', 'surreptakos/claude-dotfiles', renderBlock('Dan-AAC', ['desktop'])],
      ['aac-contract-builder', 'surreptakos/aac-contract-builder', renderBlock('Dan', ['cli', 'mobile', 'web', 'task-scheduler'])],
    ]) {
      const d = path.join(clonesRoot, name); fs.mkdirSync(d);
      spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', d]);
      spawnSync('git', ['-C', d, 'remote', 'add', 'origin', `https://github.com/${slug}`]);
      fs.writeFileSync(path.join(d, 'CLAUDE.md'), `# ${name}\n\n${ownerBlock}\n\nbody\n`);
    }
    const env = { ...process.env, CLAUDE_ACCOUNTS_JSON: regPath, CLAUDE_CLONES_ROOT: clonesRoot };
    const clean = spawnSync(process.execPath, [CLI, 'check-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /ok\s+surreptakos\/claude-dotfiles/);
    assert.match(clean.stdout, /ok\s+surreptakos\/aac-contract-builder/);

    fs.writeFileSync(
      path.join(clonesRoot, 'aac-contract-builder', 'CLAUDE.md'),
      `# aac-contract-builder\n\n${renderBlock('Dan-AAC', ['desktop'])}\n\nbody\n`
    );
    const drift = spawnSync(process.execPath, [CLI, 'check-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /drift\s+surreptakos\/aac-contract-builder/);
    assert.match(drift.stderr, /expected: Owner account: Dan/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI apply-all --via clones: writes the block into each clone, idempotent on re-run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-applyall-'));
  try {
    const regPath = path.join(dir, 'accounts.json');
    fs.writeFileSync(regPath, JSON.stringify(fixtureRegistry()));
    const clonesRoot = path.join(dir, 'clones');
    fs.mkdirSync(clonesRoot);

    for (const [name, slug] of [
      ['claude-dotfiles', 'surreptakos/claude-dotfiles'],
      ['aac-contract-builder', 'surreptakos/aac-contract-builder'],
    ]) {
      const d = path.join(clonesRoot, name); fs.mkdirSync(d);
      spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', d]);
      spawnSync('git', ['-C', d, 'remote', 'add', 'origin', `https://github.com/${slug}`]);
      fs.writeFileSync(path.join(d, 'CLAUDE.md'), `# ${name}\n\nbody without an owner line yet.\n`);
    }
    const env = { ...process.env, CLAUDE_ACCOUNTS_JSON: regPath, CLAUDE_CLONES_ROOT: clonesRoot };
    const r1 = spawnSync(process.execPath, [CLI, 'apply-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.match(r1.stdout, /update\s+surreptakos\/claude-dotfiles/);
    assert.match(r1.stdout, /update\s+surreptakos\/aac-contract-builder/);
    const c = spawnSync(process.execPath, [CLI, 'check-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(c.status, 0, c.stdout + c.stderr);
    const before = fs.readFileSync(path.join(clonesRoot, 'claude-dotfiles', 'CLAUDE.md'), 'utf8');
    const r2 = spawnSync(process.execPath, [CLI, 'apply-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(r2.status, 0);
    assert.equal(fs.readFileSync(path.join(clonesRoot, 'claude-dotfiles', 'CLAUDE.md'), 'utf8'), before);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


// -----------------------------------------------------------------------------
// AGENTS.md fallback (issue 114): one live repo (surreptakos/zoho-source-of-truth)
// carries no CLAUDE.md, only AGENTS.md, so the tool must audit and write there
// instead of tripping notFound. Below covers pickInstructionsFile, apply on an
// AGENTS.md-only repo, check on the same, and the CLI apply-all path.
// -----------------------------------------------------------------------------

test('INSTRUCTIONS_CANDIDATES: CLAUDE.md is preferred, AGENTS.md is the fallback', () => {
  assert.deepEqual([...INSTRUCTIONS_CANDIDATES], ['CLAUDE.md', 'AGENTS.md']);
});

test('pickInstructionsFile: picks CLAUDE.md when present, AGENTS.md when only that exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-pick-'));
  try {
    assert.equal(path.basename(pickInstructionsFile(root)), 'CLAUDE.md');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# agents\n');
    assert.equal(path.basename(pickInstructionsFile(root)), 'AGENTS.md');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# both\n');
    assert.equal(path.basename(pickInstructionsFile(root)), 'CLAUDE.md');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('apply: writes the block into AGENTS.md when the repo has no CLAUDE.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-agents-'));
  try {
    const regPath = path.join(dir, 'accounts.json');
    fs.writeFileSync(regPath, JSON.stringify({
      accounts: { Dan: { uuid: 'x', surfaces: ['cli', 'mobile', 'web', 'task-scheduler'] } },
      repos: { 'surreptakos/zoho-source-of-truth': { owner: 'Dan' } },
    }));
    const repoPath = path.join(dir, 'repo');
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, 'AGENTS.md'), '# zoho-source-of-truth\n\nbody.\n');
    const r = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/zoho-source-of-truth']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(path.join(repoPath, 'CLAUDE.md')), false);
    const agents = fs.readFileSync(path.join(repoPath, 'AGENTS.md'), 'utf8');
    assert.equal(extractLine(agents), 'Owner account: Dan (CLI, mobile app, claude.ai/code, task scheduler)');
    const r2 = cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/zoho-source-of-truth']);
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.equal(fs.readFileSync(path.join(repoPath, 'AGENTS.md'), 'utf8'), agents);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('check: audits AGENTS.md when the repo has no CLAUDE.md - drift then ok after apply', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-agents-check-'));
  try {
    const regPath = path.join(dir, 'accounts.json');
    fs.writeFileSync(regPath, JSON.stringify({
      accounts: { Dan: { uuid: 'x', surfaces: ['cli', 'mobile', 'web', 'task-scheduler'] } },
      repos: { 'surreptakos/zoho-source-of-truth': { owner: 'Dan' } },
    }));
    const repoPath = path.join(dir, 'repo');
    fs.mkdirSync(repoPath);
    fs.writeFileSync(path.join(repoPath, 'AGENTS.md'), '# zoho\n\nno owner block yet.\n');
    const d = cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/zoho-source-of-truth']);
    assert.equal(d.status, 1, d.stdout + d.stderr);
    assert.match(d.stderr, /drift:/);
    cli(['apply', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/zoho-source-of-truth']);
    const ok = cli(['check', '--repo', repoPath, '--registry', regPath, '--slug', 'surreptakos/zoho-source-of-truth']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('apply-all --via clones: writes into AGENTS.md when that is the only instructions file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-agents-all-'));
  try {
    const regPath = path.join(dir, 'accounts.json');
    fs.writeFileSync(regPath, JSON.stringify({
      accounts: { Dan: { uuid: 'x', surfaces: ['cli'] } },
      repos: { 'surreptakos/zoho-source-of-truth': { owner: 'Dan' } },
    }));
    const clonesRoot = path.join(dir, 'clones');
    const zoho = path.join(clonesRoot, 'zoho-source-of-truth');
    fs.mkdirSync(zoho, { recursive: true });
    spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', zoho]);
    spawnSync('git', ['-C', zoho, 'remote', 'add', 'origin', 'https://github.com/surreptakos/zoho-source-of-truth']);
    fs.writeFileSync(path.join(zoho, 'AGENTS.md'), '# zoho\n\nbody\n');
    const env = { ...process.env, CLAUDE_ACCOUNTS_JSON: regPath, CLAUDE_CLONES_ROOT: clonesRoot };
    const r = spawnSync(process.execPath, [CLI, 'apply-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.existsSync(path.join(zoho, 'CLAUDE.md')), false, 'apply-all must NOT create a CLAUDE.md when AGENTS.md is present');
    assert.equal(extractLine(fs.readFileSync(path.join(zoho, 'AGENTS.md'), 'utf8')), 'Owner account: Dan (CLI)');
    const c = spawnSync(process.execPath, [CLI, 'check-all', '--via', 'clones', '--registry', regPath, '--clones-root', clonesRoot], { encoding: 'utf8', env });
    assert.equal(c.status, 0, c.stdout + c.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('readViaGithub: falls back to AGENTS.md on a CLAUDE.md 404, propagates non-404', () => {
  const fakeGh = (args) => {
    if (args[1] === 'repos/x/y' && args[2] === '--jq') return JSON.stringify({ default_branch: 'main' });
    if (args[1] === 'repos/x/y/contents/CLAUDE.md') {
      const err = new Error('gh 404'); err.stderr = '{"status":"404"}'; throw err;
    }
    if (args[1] === 'repos/x/y/contents/AGENTS.md') {
      return JSON.stringify({ content: Buffer.from('# y\n\nbody\n', 'utf8').toString('base64'), encoding: 'base64', sha: 'abc' });
    }
    throw new Error(`unexpected call ${args.join(' ')}`);
  };
  const r = readViaGithub('x/y', { gh: fakeGh });
  assert.equal(r.notFound, false);
  assert.equal(r.filename, 'AGENTS.md');
  assert.equal(r.defaultBranch, 'main');
  assert.match(r.content, /^# y/);
  const boom = (args) => {
    if (args[1] === 'repos/x/y' && args[2] === '--jq') return JSON.stringify({ default_branch: 'main' });
    const err = new Error('gh 500'); err.stderr = 'HTTP 500'; throw err;
  };
  assert.throws(() => readViaGithub('x/y', { gh: boom }), /HTTP 500|gh 500/);
  const missing = (args) => {
    if (args[1] === 'repos/x/y' && args[2] === '--jq') return JSON.stringify({ default_branch: 'main' });
    const err = new Error('gh 404'); err.stderr = '{"status":"404"}'; throw err;
  };
  const nf = readViaGithub('x/y', { gh: missing });
  assert.equal(nf.notFound, true);
  assert.equal(nf.filename, 'CLAUDE.md');
});

// -----------------------------------------------------------------------------
// Real-file drift guard (issue 114, attempt 2 review fix): the prior attempt's
// tests all synthesized their "actual" content from the registry via renderBlock,
// so corrupting the real CLAUDE.md left the suite green. This test reads THIS
// repo's own CLAUDE.md and profile/claude/accounts.json off disk without synthesizing
// either side, and fails if the block on disk disagrees with the registry. Hand
// edit the block or the registry and this test goes red before commit.
// -----------------------------------------------------------------------------

test('drift-guard: THIS repo\'s CLAUDE.md carries the block profile/claude/accounts.json says it should (no synthesis)', () => {
  const repoRoot = path.join(__dirname, '..');
  const mdPath = path.join(repoRoot, 'CLAUDE.md');
  const regPath = path.join(repoRoot, 'profile', 'claude', 'accounts.json');
  assert.ok(fs.existsSync(mdPath), `expected ${mdPath} to exist`);
  assert.ok(fs.existsSync(regPath), `expected ${regPath} to exist`);

  // Read the registry off disk (not a fixture) and pull the entry for this repo. If the
  // registry ever loses this slug, the tool would fail with exit 2, so assert it explicitly
  // first — a clearer failure than "exit 2, could not audit".
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  const slug = 'surreptakos/claude-dotfiles';
  const entry = findRepoEntry(reg, slug);
  assert.ok(entry, `${slug} must be in ${regPath}`);
  const surfaces = surfacesFor(reg, entry.owner);
  const expectedLine = renderLine(entry.owner, surfaces);

  // Read the actual bytes of CLAUDE.md and pull the line the block carries. No renderBlock
  // on this side of the assertion — an editor who mis-typed the block by one character
  // fails here.
  const md = fs.readFileSync(mdPath, 'utf8');
  const actualLine = extractLine(md);
  assert.equal(
    actualLine,
    expectedLine,
    `CLAUDE.md is out of sync with ${regPath} for ${slug}\n` +
    `  expected: ${expectedLine}\n` +
    `  actual:   ${actualLine || '(no owner-account block)'}\n` +
    `  fix:      node tools/owner-account-line.js apply`
  );

  // Belt and braces: run the CLI in check mode against the real files. Exercises the same
  // codepath a hook or CI job would fire, so a regression in the driver (parseArgs, exit
  // codes, file resolution) is caught here even if the extract-and-compare above passes.
  const r = spawnSync(
    process.execPath,
    [CLI, 'check', '--repo', repoRoot, '--registry', regPath, '--slug', slug],
    { encoding: 'utf8' }
  );
  assert.equal(
    r.status,
    0,
    `owner-account-line check on the real CLAUDE.md exited ${r.status}\n` +
    `stdout: ${r.stdout}\nstderr: ${r.stderr}`
  );
});
