#!/usr/bin/env node
/**
 * node --test tools/dotfiles-freshness-hook.test.js
 *
 * Covers all four non-trivial states plus the stamp round-trip. A Node stub
 * stands in for tools/dotfiles-freshness.ps1 so the tests do not need PowerShell
 * or a real git remote to run. The stub reports whatever fixture the individual
 * test wrote into a JSON file, and counts install-state1 invocations so we can
 * assert auto-install fires only where it should.
 */
'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const HOOK = path.join(__dirname, 'dotfiles-freshness-hook.js');
const REPO_ROOT = path.resolve(__dirname, '..');
const STUB_TOOL = path.join(__dirname, '__dotfiles-freshness-stub.js');

// The stub is a normal Node script; the driver treats it as JSON-emitting because
// its extension is not .ps1. It reads the current fixture JSON file (path in env
// var DOTFILES_STUB_FIXTURE), which each test writes fresh, and logs every call
// to the counter file. install-state1 mode returns a canned success unless the
// fixture explicitly names an installFailure.
function ensureStub() {
  const src = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "let mode = 'classify';",
    "for (let i = 0; i < args.length; i++) { if (args[i] === '--mode') mode = args[i + 1]; }",
    "const fixturePath = process.env.DOTFILES_STUB_FIXTURE;",
    "const counter = process.env.DOTFILES_STUB_COUNTER;",
    "if (counter) { fs.appendFileSync(counter, mode + '\\n'); }",
    "let fixture = {};",
    "try { fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')); } catch (e) { fixture = {}; }",
    "if (mode === 'classify') { process.stdout.write(JSON.stringify(fixture.classify || { state: 'unknown', summary: 'stub' })); process.exit(0); }",
    "if (mode === 'install-state1') {",
    "  const install = fixture.install || { ok: true, installed: ['abc123 first', 'def456 second'], newHead: 'def456' };",
    "  process.stdout.write(JSON.stringify(install));",
    "  process.exit(install.ok === false ? 1 : 0);",
    "}",
    "if (mode === 'push-state2') {",
    "  const push = fixture.pushState2 || { ok: true, pushed: 'stub-new-head', steps: [{ step: 'sync.ps1', exit: 0 }, { step: 'git push', exit: 0 }] };",
    "  process.stdout.write(JSON.stringify(push));",
    "  process.exit(push.ok === false ? 1 : 0);",
    "}",
    "if (mode === 'resolve-state3') {",
    "  const resolve = fixture.resolveState3 || { ok: true, resolved: 'stub-rebased-head', steps: [{ step: 'sync push', exit: 0 }, { step: 'git pull --rebase', exit: 0 }, { step: 'git push', exit: 0 }, { step: 'sync pull', exit: 0 }] };",
    "  process.stdout.write(JSON.stringify(resolve));",
    "  process.exit(resolve.ok === false ? 1 : 0);",
    "}",
    "if (mode === 'stamp') { process.stdout.write(JSON.stringify({ ok: true, stampPath: '/stub' })); process.exit(0); }",
    "process.stdout.write(JSON.stringify({ ok: false, error: 'unknown mode ' + mode })); process.exit(1);",
  ].join('\n');
  fs.writeFileSync(STUB_TOOL, src, 'utf8');
}

function sandbox() {
  ensureStub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotfiles-fresh-'));
  const fixture = path.join(dir, 'fixture.json');
  const counter = path.join(dir, 'runs.txt');
  fs.writeFileSync(fixture, '{}', 'utf8');
  return {
    dir,
    fixture,
    setClassify(report) {
      fs.writeFileSync(fixture, JSON.stringify({ classify: report }), 'utf8');
    },
    setClassifyAndInstall(report, install) {
      fs.writeFileSync(fixture, JSON.stringify({ classify: report, install }), 'utf8');
    },
    setClassifyAndPush(report, pushState2) {
      fs.writeFileSync(fixture, JSON.stringify({ classify: report, pushState2 }), 'utf8');
    },
    setClassifyAndResolve(report, resolveState3) {
      fs.writeFileSync(fixture, JSON.stringify({ classify: report, resolveState3 }), 'utf8');
    },
    runs() {
      if (!fs.existsSync(counter)) return [];
      return fs.readFileSync(counter, 'utf8').trim().split('\n').filter(Boolean);
    },
    env: {
      DOTFILES_FRESHNESS_TOOL: STUB_TOOL,
      DOTFILES_STUB_FIXTURE: fixture,
      DOTFILES_STUB_COUNTER: counter,
      DOTFILES_REPO_ROOT: REPO_ROOT,
      DOTFILES_USER_HOME: dir,
      DOTFILES_SKIP_FETCH: '1',
    },
  };
}

function callHook(box, mode, stdin) {
  const r = spawnSync(process.execPath, [HOOK, mode], {
    input: stdin || '',
    encoding: 'utf8',
    env: Object.assign({}, process.env, box.env),
    timeout: 30000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/* ------------------------------------------------------------------ states -- */

test('state synced: session-start stays silent, no install fires', () => {
  const box = sandbox();
  box.setClassify({ state: 'synced', summary: 'up to date', liveDrift: false, resolution: [] });
  const r = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '{}');
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state unknown (no stamp): session-start stays silent, no install fires', () => {
  const box = sandbox();
  box.setClassify({ state: 'unknown', summary: 'no stamp', liveDrift: false, resolution: [] });
  const r = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout, '{}');
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state1: session-start auto-installs and reports the commits landed', () => {
  const box = sandbox();
  box.setClassifyAndInstall(
    { state: 'state1', summary: '3 commits waiting', liveDrift: false,
      resolution: ['cd repo', 'git pull --ff-only', '.\\sync.ps1 -Mode pull'],
      incomingCommits: ['abc123 add-freshness', 'def456 fix-typo', '789ghi bump-version'] },
    { ok: true, installed: ['abc123 add-freshness', 'def456 fix-typo', '789ghi bump-version'], newHead: '789ghi' },
  );
  const r = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const context = out.hookSpecificOutput.additionalContext;
  assert.match(context, /auto-installed/);
  assert.match(context, /abc123 add-freshness/);
  assert.match(context, /789ghi bump-version/);
  assert.deepStrictEqual(box.runs(), ['classify', 'install-state1']);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
});

test('state1 with install failure: reports failure, does not lie about installing', () => {
  const box = sandbox();
  box.setClassifyAndInstall(
    { state: 'state1', summary: '2 commits waiting', liveDrift: false,
      resolution: ['cd repo', 'git pull --ff-only', '.\\sync.ps1 -Mode pull'],
      incomingCommits: [] },
    { ok: false, reason: 'git pull --ff-only failed' },
  );
  const r = callHook(box, 'session-start');
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /auto-install FAILED/);
  assert.match(out.hookSpecificOutput.additionalContext, /git pull --ff-only failed/);
});

test('state2 (live drift, no incoming): session-start auto-captures + pushes; classifier reports synced afterward (issue 19)', () => {
  const box = sandbox();
  box.setClassifyAndPush(
    { state: 'state2',
      summary: 'live copies edited since last sync (report only, never a block)',
      liveDrift: true,
      repo: { behind: 0, ahead: 0, isWorktree: false },
      resolution: [
        'cd C:/repo',
        '.\\sync.ps1 -Mode push -Commit "chore: sync"',
      ] },
    { ok: true, pushed: 'newhead-abc123',
      steps: [
        { step: 'sync.ps1 -Mode push -Commit', exit: 0, output: 'Stamped ...' },
        { step: 'git push', exit: 0, output: '' },
      ] },
  );
  const start = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(start.status, 0, start.stderr);
  const startOut = JSON.parse(start.stdout);
  const ctx = startOut.hookSpecificOutput.additionalContext;
  assert.match(ctx, /auto-captured and pushed/);
  assert.match(ctx, /session-start capture/);
  assert.match(ctx, /git push/);
  assert.match(ctx, /newhead-abc123/);
  assert.match(ctx, /synced/, 'must claim the state is now synced');
  assert.deepStrictEqual(box.runs(), ['classify', 'push-state2']);

  // Prompt remains silent - state2 is never a prompt-blocker even when auto-push is in play.
  const prompt = callHook(box, 'prompt', JSON.stringify({ prompt: 'do a thing' }));
  assert.strictEqual(prompt.status, 0, 'state2 must NOT block a prompt');
  assert.strictEqual(prompt.stdout, '{}');

  // After a real auto-push, sync.ps1 would have written a fresh stamp and origin would hold
  // the new HEAD, so the next classify returns synced. Flip the fixture and verify a fresh
  // session-start goes silent - this is the "classifier reports synced afterward" clause.
  box.setClassify({ state: 'synced', summary: 'up to date, live unchanged',
                    liveDrift: false, resolution: [] });
  const second = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(second.status, 0);
  assert.strictEqual(second.stdout, '{}');

  // install-state1 never fired anywhere.
  assert.strictEqual(box.runs().filter((r) => r === 'install-state1').length, 0);
});

test('state2 auto-push failure: prints state2 advisory with failure reason appended; session continues (issue 19)', () => {
  const box = sandbox();
  box.setClassifyAndPush(
    { state: 'state2',
      summary: 'live copies edited since last sync (report only, never a block)',
      liveDrift: true,
      repo: { behind: 0, ahead: 0, isWorktree: false },
      resolution: [
        'cd C:/repo',
        '.\\sync.ps1 -Mode push -Commit "chore: sync"',
      ] },
    { ok: false, reason: 'git push failed: fatal: unable to access remote (Could not resolve host)' },
  );
  const start = callHook(box, 'session-start');
  assert.strictEqual(start.status, 0, 'auto-push failure must not stop the session');
  const out = JSON.parse(start.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  // Base state2 advisory preserved so the resolution commands are visible.
  assert.match(ctx, /Live config on this machine has changed since the last sync stamp/);
  assert.match(ctx, /\.\\sync\.ps1 -Mode push -Commit "chore: sync"/);
  // Failure reason appended.
  assert.match(ctx, /AUTO-PUSH FAILED/);
  assert.match(ctx, /Could not resolve host/);
  assert.match(ctx, /Session continues/);
  assert.deepStrictEqual(box.runs(), ['classify', 'push-state2']);
});

test('state2 origin-ahead ineligible (liveDrift=false, behind>0): warn only, no auto-push runs', () => {
  // The classifier returns state2 in a second shape: origin is ahead but the local checkout
  // is not eligible for state1 (worktree, or local commits ahead), and live is clean. Pushing
  // does not help this shape - keep it as a manual-pull advisory, unchanged.
  const box = sandbox();
  box.setClassify({
    state: 'state2',
    summary: '3 commit(s) waiting on origin - manual pull required (ahead=1, worktree=false)',
    liveDrift: false,
    repo: { behind: 3, ahead: 1, isWorktree: false },
    resolution: ['cd C:/repo', 'git pull --ff-only', '.\\sync.ps1 -Mode pull'],
    incomingCommits: ['aaa incoming', 'bbb incoming', 'ccc incoming'],
  });
  const start = callHook(box, 'session-start');
  assert.strictEqual(start.status, 0);
  const out = JSON.parse(start.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /Origin also has 3 commit\(s\) waiting/);
  // No push-state2 fired - only the classify.
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state2 inside a worktree (liveDrift=true, isWorktree=true): warn only, no auto-push runs', () => {
  // Multi-worktree/multi-agent guard. This repo runs many concurrent agent worktrees, each
  // on its own feature branch. A SessionStart hook fired inside one of those must NEVER
  // auto-commit and push dotfiles-sync work onto the wrong branch - it would pollute the
  // ticket's diff. Matches install-state1's `-not $repo.isWorktree` clause. The Node driver
  // catches this case up-front so the PowerShell round-trip does not run at all.
  const box = sandbox();
  box.setClassifyAndPush(
    { state: 'state2',
      summary: 'live copies edited since last sync (report only, never a block)',
      liveDrift: true,
      repo: { behind: 0, ahead: 0, isWorktree: true },
      resolution: ['cd C:/repo', '.\\sync.ps1 -Mode push -Commit "chore: sync"'] },
    { ok: true, pushed: 'stub-would-have-pushed' },
  );
  const start = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(start.status, 0);
  const out = JSON.parse(start.stdout);
  // Falls back to the standard state2 advisory - no "auto-captured and pushed" note.
  assert.match(out.hookSpecificOutput.additionalContext, /live copies edited/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /auto-captured and pushed/);
  // Guard fires in the driver: push-state2 must NOT be invoked.
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state2 with local commits ahead (liveDrift=true, ahead>0): warn only, no auto-push runs', () => {
  // Same rationale as the worktree case: ahead>0 on a plain checkout means the caller has
  // unpushed local commits (typically mid-implementation on master). Pushing a "session-start
  // capture" here would move HEAD atop that work - refuse and let the operator push
  // deliberately.
  const box = sandbox();
  box.setClassifyAndPush(
    { state: 'state2',
      summary: 'live copies edited since last sync (report only, never a block)',
      liveDrift: true,
      repo: { behind: 0, ahead: 2, isWorktree: false },
      resolution: ['cd C:/repo', '.\\sync.ps1 -Mode push -Commit "chore: sync"'] },
    { ok: true, pushed: 'stub-would-have-pushed' },
  );
  const start = callHook(box, 'session-start', JSON.stringify({ source: 'startup' }));
  assert.strictEqual(start.status, 0);
  const out = JSON.parse(start.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /live copies edited/);
  assert.doesNotMatch(out.hookSpecificOutput.additionalContext, /auto-captured and pushed/);
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state3 with clean rebase (issue 18): prompt auto-resolves + proceeds; session-start still warns', () => {
  // Eligible state3 (liveDrift=true, behind>0, ahead=0, isWorktree=false). The .ps1's
  // resolve-state3 mode ran sync push + git pull --rebase + git push + sync pull cleanly.
  // The prompt hook injects a note and exits 0 - Claude Code allows the prompt through.
  const box = sandbox();
  box.setClassifyAndResolve(
    { state: 'state3', summary: 'both diverged (rebasable)', liveDrift: true,
      repo: { behind: 2, ahead: 0, isWorktree: false },
      resolution: [
        'cd C:/repo',
        '.\\sync.ps1 -Mode push -Commit "chore: capture live edits before pulling"',
        'git pull --rebase',
        'git push',
        '.\\sync.ps1 -Mode pull',
      ],
      incomingCommits: ['abc first', 'def second'] },
    { ok: true, resolved: 'newhead-fed789',
      steps: [
        { step: 'sync.ps1 -Mode push -Commit (capture)', exit: 0, output: 'Committed ...' },
        { step: 'git pull --rebase', exit: 0, output: 'Successfully rebased and updated refs/heads/master.' },
        { step: 'git push', exit: 0, output: '' },
        { step: 'sync.ps1 -Mode pull', exit: 0, output: 'PULL done' },
      ] },
  );
  const prompt = callHook(box, 'prompt', JSON.stringify({ prompt: 'proceed' }));
  assert.strictEqual(prompt.status, 0, 'clean-rebase state3 MUST proceed (not exit 2)');
  const promptOut = JSON.parse(prompt.stdout);
  const ctx = promptOut.hookSpecificOutput.additionalContext;
  assert.match(ctx, /state3 auto-resolved/);
  assert.match(ctx, /newhead-fed789/);
  assert.match(ctx, /synced/, 'must claim the state is now synced');
  assert.match(ctx, /Proceeding with your prompt/);
  assert.strictEqual(promptOut.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  // Fired: classify then resolve-state3. Nothing else.
  assert.deepStrictEqual(box.runs(), ['classify', 'resolve-state3']);

  // Session-start (fires before the prompt) still warns - the prompt is where the resolve
  // happens, not session-start (previous verification failed on running resolve at both).
  const start = callHook(box, 'session-start');
  assert.strictEqual(start.status, 0, 'session-start injects a warn, does not block');
  const startOut = JSON.parse(start.stdout);
  assert.match(startOut.hookSpecificOutput.additionalContext, /BOTH DIVERGED/);
  // Critical: session-start MUST NOT invoke resolve-state3. Only the classify from this
  // call should have fired (the prompt call above already ran classify+resolve).
  const startRuns = box.runs().slice(2); // trim the prompt call's runs
  assert.deepStrictEqual(startRuns, ['classify'],
    'session-start must NOT auto-resolve state3 (that runs at UserPromptSubmit only)');

  // Install-state1 never fires for state3 (auto-pull must not run with live drift).
  assert.strictEqual(box.runs().filter((r) => r === 'install-state1').length, 0);
});

test('state3 with rebase conflict (issue 18): prompt blocks, message names conflicted files', () => {
  // Same eligible shape as the success case, but the .ps1 hit a merge conflict during
  // git pull --rebase, aborted the rebase, and returned the conflicted paths. The prompt
  // hook MUST block (exit 2) and surface those paths so the operator can see them.
  const box = sandbox();
  box.setClassifyAndResolve(
    { state: 'state3', summary: 'both diverged', liveDrift: true,
      repo: { behind: 1, ahead: 0, isWorktree: false },
      resolution: [
        'cd C:/repo',
        '.\\sync.ps1 -Mode push -Commit "chore: capture live edits before pulling"',
        'git pull --rebase',
        'git push',
        '.\\sync.ps1 -Mode pull',
      ],
      incomingCommits: ['abc conflicting'] },
    { ok: false,
      reason: 'rebase produced merge conflicts in 2 file(s)',
      conflictedPaths: ['claude/CLAUDE.md', 'memory/MEMORY.md'],
      aborted: true },
  );
  const prompt = callHook(box, 'prompt', JSON.stringify({ prompt: 'proceed' }));
  assert.strictEqual(prompt.status, 2, 'conflict MUST block via exit 2');
  assert.match(prompt.stderr, /HIT MERGE CONFLICTS/);
  assert.match(prompt.stderr, /Rebase aborted/);
  assert.match(prompt.stderr, /Conflicted files \(2\)/);
  assert.match(prompt.stderr, /claude\/CLAUDE\.md/);
  assert.match(prompt.stderr, /memory\/MEMORY\.md/);
  // Manual sequence is still surfaced so the operator has a runnable path.
  assert.match(prompt.stderr, /sync\.ps1 -Mode push -Commit/);
  assert.match(prompt.stderr, /git pull --rebase/);
  assert.deepStrictEqual(box.runs(), ['classify', 'resolve-state3']);
});

test('state3 inside a worktree (issue 18): prompt blocks WITHOUT running resolve-state3', () => {
  // The multi-agent guard that failed the previous verification. Every ticket runs in its own
  // worktree on its own feature branch; a hook that auto-resolved here would commit and push
  // "chore: capture live edits before pulling" onto that feature branch's origin, polluting
  // the ticket's diff. The .ps1 also refuses this shape, but the Node-side pre-filter is what
  // spares the PowerShell round-trip AND makes the guard visible in the hook's own tests.
  const box = sandbox();
  box.setClassifyAndResolve(
    { state: 'state3', summary: 'both diverged - worktree', liveDrift: true,
      repo: { behind: 1, ahead: 0, isWorktree: true },
      resolution: [
        'cd C:/worktree',
        '.\\sync.ps1 -Mode push -Commit "chore: capture live edits before pulling"',
        'git pull --rebase',
        'git push',
        '.\\sync.ps1 -Mode pull',
      ],
      incomingCommits: ['abc incoming'] },
    { ok: true, resolved: 'stub-would-have-resolved' },
  );
  const prompt = callHook(box, 'prompt', JSON.stringify({ prompt: 'proceed' }));
  assert.strictEqual(prompt.status, 2, 'state3 in a worktree MUST still block');
  assert.match(prompt.stderr, /BOTH DIVERGED/);
  // Guard fires in the driver: resolve-state3 must NOT be invoked - the stub would have
  // reported success and let the prompt through. If it fired, the driver bypassed the
  // worktree guard and we would have polluted the ticket branch in a real run.
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state3 with local commits ahead (issue 18): prompt blocks WITHOUT running resolve-state3', () => {
  // Sibling of the worktree case. ahead>0 on a plain checkout means the caller has unpushed
  // local commits (typically mid-implementation on master). Pushing a "capture live" commit
  // and rebasing here would rewrite that in-progress history. Refuse.
  const box = sandbox();
  box.setClassifyAndResolve(
    { state: 'state3', summary: 'both diverged - ahead=1', liveDrift: true,
      repo: { behind: 1, ahead: 1, isWorktree: false },
      resolution: ['cd C:/repo', '.\\sync.ps1 -Mode push -Commit "chore: capture"', 'git pull --rebase', 'git push', '.\\sync.ps1 -Mode pull'],
      incomingCommits: ['abc incoming'] },
    { ok: true, resolved: 'stub-would-have-resolved' },
  );
  const prompt = callHook(box, 'prompt', JSON.stringify({ prompt: 'proceed' }));
  assert.strictEqual(prompt.status, 2, 'state3 with ahead>0 MUST still block');
  assert.match(prompt.stderr, /BOTH DIVERGED/);
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('state3 auto-resolve disabled (DOTFILES_AUTO_RESOLVE_STATE3=0): prompt blocks with pre-issue-18 message', () => {
  const box = sandbox();
  box.env.DOTFILES_AUTO_RESOLVE_STATE3 = '0';
  box.setClassifyAndResolve(
    { state: 'state3', summary: 'both diverged - resolve disabled', liveDrift: true,
      repo: { behind: 2, ahead: 0, isWorktree: false },
      resolution: ['cd C:/repo', '.\\sync.ps1 -Mode push -Commit "chore: capture"', 'git pull --rebase', 'git push', '.\\sync.ps1 -Mode pull'],
      incomingCommits: ['abc incoming'] },
    { ok: true, resolved: 'stub-would-have-resolved' },
  );
  const prompt = callHook(box, 'prompt', JSON.stringify({ prompt: 'proceed' }));
  assert.strictEqual(prompt.status, 2);
  assert.match(prompt.stderr, /BOTH DIVERGED/);
  // The escape hatch matters: nothing auto-runs when the operator disabled it.
  assert.deepStrictEqual(box.runs(), ['classify']);
});

test('compact resume neither runs nor injects', () => {
  const box = sandbox();
  box.setClassify({ state: 'state1', summary: 'ignored', liveDrift: false });
  const r = callHook(box, 'session-start', JSON.stringify({ source: 'compact' }));
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '{}');
  assert.deepStrictEqual(box.runs(), []);
});

test('a broken classifier reports but never blocks', () => {
  const box = sandbox();
  // Point at a nonexistent tool: driver returns { ok: false } with an error.
  const env = Object.assign({}, box.env, { DOTFILES_FRESHNESS_TOOL: STUB_TOOL + '.missing.js' });
  const r = spawnSync(process.execPath, [HOOK, 'session-start'], {
    input: '', encoding: 'utf8', env: Object.assign({}, process.env, env), timeout: 30000,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /could not classify/);
});
