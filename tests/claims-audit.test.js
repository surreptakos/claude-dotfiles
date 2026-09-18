#!/usr/bin/env node
/**
 * node --test tests/claims-audit.test.js
 *
 * The engine is generic - the tests treat it as a black box: build a temp "repo" on disk with a
 * synthetic doc, source and docs/claims.json, run the engine, and assert on findings and exit
 * code. Every claim type gets a pass case AND a fail case, because a checker that has only ever
 * returned green is not yet a checker.
 *
 * Two execution paths are exercised deliberately: the in-process `auditClaims` (unit-level) and
 * the CLI (`node claims-audit.js`), because a downstream repo's wrapper test can call either.
 *
 * Attempt 3 regression guards (the review of attempt 2 caught these):
 *
 *  A. Missing-file resilience. A claim that names a source or doc the repo does not (yet) have
 *     must produce a finding, NOT crash the whole audit at exit 2. Attempt 2's readFileOrDie
 *     was called with exitCode=2 from every verifier and any missing cite killed the process
 *     before later claims could evaluate. Every claim type gets an explicit "cite missing"
 *     test below, and the batch test ("still evaluates later claims after a broken one") is
 *     the direct regression pin.
 *
 *  B. Documented exit-code contract matches actual behaviour. The docstring at the top of
 *     claims-audit.js now says: exit 2 is reserved for audit-level configuration errors
 *     (missing claims file, malformed JSON, wrong shape); anything scoped to one claim -
 *     unknown type, missing cite, malformed field - becomes a finding at exit 1. The CLI
 *     tests below assert that exact split so the doc and the code cannot re-diverge silently.
 */

'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Default target is the mirror inside this repo, so `node --test tests/claims-audit.test.js` from
// a clean checkout works with no environment plumbing. The restore-test gate overrides this via
// CLAIMS_AUDIT_ENGINE to point at the freshly RESTORED engine under the fake home - that is what
// turns "the mirror parses" into "the file the sync pipeline actually lands on a new machine
// parses". Both call sites must load the same file, so the tests treat this as a pin, not a
// preference: an absent env var falls through to the mirror; a non-existent path throws below and
// fails the run rather than silently masking a broken restore.
const ENGINE = process.env.CLAIMS_AUDIT_ENGINE || path.join(
  __dirname, '..', 'aac-skills', 'consistency-audit', 'claims-audit.js'
);
const { auditClaims } = require(ENGINE);

// ---------------------------------------------------- helpers

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'claims-audit-test-'));
}

// Wire up a repo-shaped directory: doc + optional source + claims.json under docs/.
function seed(root, files, claims) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  const claimsPath = path.join(root, 'docs', 'claims.json');
  fs.mkdirSync(path.dirname(claimsPath), { recursive: true });
  fs.writeFileSync(claimsPath, JSON.stringify({ claims }, null, 2));
  return claimsPath;
}

function runCli(root, claimsFile) {
  try {
    const out = execFileSync(process.execPath, [ENGINE, claimsFile || ''].filter(Boolean), {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err) {
    return { code: err.status, stdout: String(err.stdout || ''), stderr: String(err.stderr || '') };
  }
}

// Every finding message quotes the offending line number, so the tests grep on that shape too -
// a regression in the output format would break every downstream repo's wrapper test.
function assertFindingShape(finding, expectedId) {
  assert.equal(typeof finding.claimId, 'string');
  assert.equal(finding.claimId, expectedId);
  assert.equal(typeof finding.doc, 'string');
  assert.equal(typeof finding.line, 'number');
  assert.equal(typeof finding.message, 'string');
  assert.ok(finding.message.length > 0);
}

// ---------------------------------------------------- token-subset

test('token-subset: passes when every doc-named token appears in the source', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'README.md': 'The endpoints are `/api/foo`, `/api/bar`, and `/api/baz`.',
      'src/routes.js':
        'app.get("/api/foo", h);\napp.get("/api/bar", h);\napp.get("/api/baz", h);\n',
    }, [{
      id: 'T-pass', type: 'token-subset', doc: 'README.md', source: 'src/routes.js',
      pattern: '`(/api/[a-z]+)`',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.deepEqual(findings, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('token-subset: fails when the doc names a token no source file emits', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      // The doc names an endpoint the router does not expose - the exact drift a token-subset
      // claim is supposed to catch.
      'README.md': 'The endpoints are `/api/foo`, `/api/bar`, and `/api/ghost`.',
      'src/routes.js': 'app.get("/api/foo", h);\napp.get("/api/bar", h);\n',
    }, [{
      id: 'T-fail', type: 'token-subset', doc: 'README.md', source: 'src/routes.js',
      pattern: '`(/api/[a-z]+)`',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'T-fail');
    assert.match(findings[0].message, /\/api\/ghost/);
    assert.equal(findings[0].doc, 'README.md');
    assert.ok(findings[0].line > 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('token-subset: missing source becomes a finding, never a process exit', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'README.md': 'The endpoints are `/api/foo`.',
      // src/routes.js deliberately not written.
    }, [{
      id: 'T-missing-src', type: 'token-subset', doc: 'README.md', source: 'src/routes.js',
      pattern: '`(/api/[a-z]+)`',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'T-missing-src');
    assert.match(findings[0].message, /cannot read source/);
    assert.match(findings[0].message, /src\/routes\.js/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------- symbol-exists

test('symbol-exists: passes when the doc names a symbol the source defines', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'docs/api.md': 'Call `processInvoice()` to enqueue a bill for review.',
      'src/pipeline.js': 'function processInvoice(rec) { return rec; }\n',
    }, [{
      id: 'S-pass', type: 'symbol-exists',
      doc: 'docs/api.md', source: 'src/pipeline.js', symbol: 'processInvoice',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.deepEqual(findings, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('symbol-exists: fails both directions (doc drops it OR source drops it)', () => {
  // Direction A: source defines it, doc does not cite it any more (registry went stale).
  const rootA = scratch();
  try {
    const claimsPath = seed(rootA, {
      'docs/api.md': 'Nothing here mentions the old function name.',
      'src/pipeline.js': 'function processInvoice(rec) { return rec; }\n',
    }, [{
      id: 'S-fail-doc', type: 'symbol-exists',
      doc: 'docs/api.md', source: 'src/pipeline.js', symbol: 'processInvoice',
    }]);
    const { findings } = auditClaims(claimsPath, rootA);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'S-fail-doc');
    assert.match(findings[0].message, /no longer mentioned/);
  } finally { fs.rmSync(rootA, { recursive: true, force: true }); }

  // Direction B: doc cites the symbol but the source no longer defines it (rename or delete
  // shipped without the doc catching up).
  const rootB = scratch();
  try {
    const claimsPath = seed(rootB, {
      'docs/api.md': 'Call `processInvoice()` to enqueue a bill.',
      'src/pipeline.js': '// renamed away, nothing defines processInvoice here now\n',
    }, [{
      id: 'S-fail-src', type: 'symbol-exists',
      doc: 'docs/api.md', source: 'src/pipeline.js', symbol: 'processInvoice',
    }]);
    const { findings } = auditClaims(claimsPath, rootB);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'S-fail-src');
    assert.match(findings[0].message, /no definition found/);
  } finally { fs.rmSync(rootB, { recursive: true, force: true }); }
});

test('symbol-exists: missing source becomes a finding, never a process exit', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'docs/api.md': 'Call `processInvoice()` to enqueue a bill.',
      // src/pipeline.js not written.
    }, [{
      id: 'S-missing-src', type: 'symbol-exists',
      doc: 'docs/api.md', source: 'src/pipeline.js', symbol: 'processInvoice',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'S-missing-src');
    assert.match(findings[0].message, /cannot read source/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------- expected-text

test('expected-text: passes when the doc contains the expected passage verbatim', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'CLAUDE.md': 'Rule: never commit generated files by hand.\n\nExtra prose here.',
    }, [{
      id: 'E-pass', type: 'expected-text',
      doc: 'CLAUDE.md', expected: 'Rule: never commit generated files by hand.',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.deepEqual(findings, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('expected-text: fails when the doc has been rewritten around the pinned passage', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'CLAUDE.md': 'Rule: never commit generated files.\n',   // whitespace-tightened
    }, [{
      id: 'E-fail', type: 'expected-text',
      doc: 'CLAUDE.md', expected: 'Rule: never commit generated files by hand.',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'E-fail');
    assert.match(findings[0].message, /expected passage not found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('expected-text: missing doc becomes a finding, never a process exit', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      // CLAUDE.md not written.
    }, [{
      id: 'E-missing-doc', type: 'expected-text',
      doc: 'CLAUDE.md', expected: 'Rule: never commit generated files by hand.',
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'E-missing-doc');
    assert.match(findings[0].message, /cannot read doc/);
    assert.match(findings[0].message, /CLAUDE\.md/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------- command-single-source

test('command-single-source: passes when every bound doc quotes the config value', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      '.claude/session.json': JSON.stringify({ test: 'node --test tests/' }),
      'README.md': 'Run `node --test tests/` before committing.',
      'docs/runbook.md': 'CI executes `node --test tests/` and then deploys.',
    }, [{
      id: 'C-pass', type: 'command-single-source',
      source: '.claude/session.json', sourcePath: 'test',
      bindings: [
        { doc: 'README.md',       occurrence: 'Run `node --test tests/` before committing.' },
        { doc: 'docs/runbook.md', occurrence: 'CI executes `node --test tests/` and then deploys.' },
      ],
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.deepEqual(findings, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('command-single-source: fails when a bound doc drifted from the config', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      // The config is the single source of truth; the runbook still quotes the OLD command,
      // which is the drift-generator failure this claim exists to trip on.
      '.claude/session.json': JSON.stringify({ test: 'node --test tests/' }),
      'README.md':      'Run `node --test tests/` before committing.',
      'docs/runbook.md': 'CI executes `node --test gas/` and then deploys.',
    }, [{
      id: 'C-fail', type: 'command-single-source',
      source: '.claude/session.json', sourcePath: 'test',
      bindings: [
        { doc: 'README.md',       occurrence: 'Run `node --test tests/` before committing.' },
        { doc: 'docs/runbook.md', occurrence: 'CI executes `node --test gas/` and then deploys.' },
      ],
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'C-fail');
    assert.match(findings[0].message, /node --test gas\//);
    assert.equal(findings[0].doc, 'docs/runbook.md');
    assert.ok(findings[0].line > 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('command-single-source: missing source becomes a finding, never a process exit', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      // .claude/session.json deliberately not written; the bound doc IS there so the failure
      // is unambiguously the source read.
      'README.md': 'Run `node --test tests/` before committing.',
    }, [{
      id: 'C-missing-src', type: 'command-single-source',
      source: '.claude/session.json', sourcePath: 'test',
      bindings: [
        { doc: 'README.md', occurrence: 'Run `node --test tests/` before committing.' },
      ],
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'C-missing-src');
    assert.match(findings[0].message, /cannot read/);
    assert.match(findings[0].message, /session\.json/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('command-single-source: missing bound doc becomes a finding, never a process exit', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      '.claude/session.json': JSON.stringify({ test: 'node --test tests/' }),
      // README.md not written.
    }, [{
      id: 'C-missing-doc', type: 'command-single-source',
      source: '.claude/session.json', sourcePath: 'test',
      bindings: [
        { doc: 'README.md', occurrence: 'Run `node --test tests/` before committing.' },
      ],
    }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assertFindingShape(findings[0], 'C-missing-doc');
    assert.match(findings[0].message, /cannot read doc/);
    assert.match(findings[0].message, /README\.md/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------- CROSS-CLAIM RESILIENCE
//
// The direct regression pin for the attempt-2 crash-on-missing-file bug: put a broken claim in
// the middle of a batch, prove the engine still reports on every later claim.

test('a broken claim (missing cite) does not prevent later claims from evaluating', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'README.md': 'The stable code path is `stable-mode`.',
      'src/mode.js': 'const MODE = "stable-mode";\n',
      // NO src/missing.js on disk.
    }, [
      { id: 'A-ok',      type: 'token-subset', doc: 'README.md', source: 'src/mode.js',
        pattern: '`([a-z-]+)`' },
      { id: 'B-broken',  type: 'token-subset', doc: 'README.md', source: 'src/missing.js',
        pattern: '`([a-z-]+)`' },
      { id: 'C-ok-fail', type: 'expected-text', doc: 'README.md',
        expected: 'a passage that is not there' },
    ]);
    const { findings } = auditClaims(claimsPath, root);
    // Attempt 2's readFileOrDie would have process.exited on B and C would never have run.
    // The findings must include B's missing-source report AND C's expected-text failure.
    const ids = new Set(findings.map(f => f.claimId));
    assert.ok(ids.has('B-broken'),  'broken claim must emit a finding, not crash');
    assert.ok(ids.has('C-ok-fail'), 'later claim must still evaluate after a broken one');
    assert.ok(!ids.has('A-ok'),     'clean claim should emit nothing');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------- CLI wiring
//
// The wrapper-test path a downstream repo actually uses: shell out to the engine, check the
// exit code AND that findings are printed one per line with the id/doc/line/message columns.

test('CLI: exits 0 and prints a clean summary when every claim passes', () => {
  const root = scratch();
  try {
    seed(root, {
      'README.md': 'The stable code path is `stable-mode`.',
      'src/mode.js': 'const MODE = "stable-mode";\n',
    }, [{
      id: 'CLI-pass', type: 'token-subset', doc: 'README.md', source: 'src/mode.js',
      pattern: '`([a-z-]+)`',
    }]);
    const { code, stdout } = runCli(root);
    assert.equal(code, 0);
    assert.match(stdout, /verified clean/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI: exits 1 and prints one line per finding (claimId, doc:line, message)', () => {
  const root = scratch();
  try {
    seed(root, {
      'README.md': 'The stable code path is `ghost-mode`.',
      'src/mode.js': 'const MODE = "stable-mode";\n',
    }, [{
      id: 'CLI-fail', type: 'token-subset', doc: 'README.md', source: 'src/mode.js',
      pattern: '`([a-z-]+)`',
    }]);
    const { code, stdout } = runCli(root);
    assert.equal(code, 1);
    const lines = stdout.trim().split('\n');
    // Format is "<claimId>\t<doc>:<line>\t<message>" - explicit tabs so downstream greps are
    // stable across renames of the message text.
    assert.ok(lines[0].startsWith('CLI-fail\t'));
    assert.match(lines[0], /README\.md:\d+/);
    assert.match(lines[0], /ghost-mode/);
    assert.match(stdout, /1 finding\(s\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI: exits 2 when the claims file itself is missing (configuration error)', () => {
  const root = scratch();
  try {
    // No docs/claims.json seeded.
    const { code, stderr } = runCli(root);
    assert.equal(code, 2);
    assert.match(stderr, /no claims file/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI: exits 2 when the claims file is malformed JSON (configuration error)', () => {
  const root = scratch();
  try {
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'claims.json'), '{ this is not json ');
    const { code, stderr } = runCli(root);
    assert.equal(code, 2);
    assert.match(stderr, /not valid JSON/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI: exits 1 (NOT 2) when a claim has an unknown type - matches the docstring contract', () => {
  const root = scratch();
  try {
    seed(root, {
      'README.md': 'anything\n',
    }, [{ id: 'U', type: 'not-a-real-type', doc: 'README.md' }]);
    const { code, stdout } = runCli(root);
    // This is the reviewer's finding-2 fix. Previously the docstring said exit 2 while the code
    // exited 1; the docstring is now explicit that unknown-type is a per-claim finding, and this
    // test pins the exit code so the drift cannot recur.
    assert.equal(code, 1);
    assert.match(stdout, /unknown claim type/);
    assert.match(stdout, /^U\t/m);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI: exits 1 (NOT 2) when a claim cites a missing source file', () => {
  const root = scratch();
  try {
    seed(root, {
      'README.md': 'The endpoints are `/api/foo`.',
      // src/routes.js not written.
    }, [{
      id: 'CLI-missing-src', type: 'token-subset', doc: 'README.md', source: 'src/routes.js',
      pattern: '`(/api/[a-z]+)`',
    }]);
    const { code, stdout } = runCli(root);
    assert.equal(code, 1, 'a missing source is per-claim, not audit-level');
    assert.match(stdout, /cannot read source/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('CLI: honors an explicit claims-file argument (path overridable)', () => {
  const root = scratch();
  try {
    fs.mkdirSync(path.join(root, 'audits'), { recursive: true });
    fs.writeFileSync(path.join(root, 'audits', 'my-claims.json'),
      JSON.stringify({ claims: [
        { id: 'A', type: 'expected-text', doc: 'note.md', expected: 'hello' },
      ] }));
    fs.writeFileSync(path.join(root, 'note.md'), 'hello world\n');
    const { code } = runCli(root, 'audits/my-claims.json');
    assert.equal(code, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---------------------------------------------------- misuse defenses
//
// A claim configuration error must not be silent; the whole point of a tripwire is that it goes
// off. These check the guards on the shape of claims.json itself.

test('reports unknown claim types as findings rather than crashing', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'README.md': 'anything\n',
    }, [{ id: 'U', type: 'not-a-real-type', doc: 'README.md' }]);
    const { findings } = auditClaims(claimsPath, root);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /unknown claim type/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports duplicate claim ids as findings (downstream repos rely on unique ids)', () => {
  const root = scratch();
  try {
    const claimsPath = seed(root, {
      'README.md': 'hello\n',
    }, [
      { id: 'DUP', type: 'expected-text', doc: 'README.md', expected: 'hello' },
      { id: 'DUP', type: 'expected-text', doc: 'README.md', expected: 'hello' },
    ]);
    const { findings } = auditClaims(claimsPath, root);
    assert.ok(findings.some(f => /duplicate claim id/.test(f.message)));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
