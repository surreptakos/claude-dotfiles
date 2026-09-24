#!/usr/bin/env node
/**
 * node --test tools/harness-bootstrap-delivery.test.js
 *
 * Harness v27 (issue 218): the project-harness skill delivers the cloud bootstrap hook and the
 * auto-mode posture to any repo, through `templates/add-cloud-plugin.js`. Three things can break
 * that delivery silently, so each gets one case:
 *
 *   1. the skill's `templates/session-start.sh` drifting from the `.claude/hooks/session-start.sh`
 *      this repo actually runs — the copy nobody diffs (the issue 336 lesson);
 *   2. a fresh repo not getting the hook, the SessionStart entry or the posture;
 *   3. a second run changing something — an acceptance criterion of the ticket, and the reason a
 *      repo that already carries an untagged entry (claude-dotfiles) must gain no duplicate.
 *
 * Harness v29 (issue 543) adds a fourth: the rewrite re-emitting a CRLF settings file as LF. The
 * one repo this script runs against itself pins that file as a CRLF blob (issue 87).
 *
 * Harness v30 (issue 614) adds three more: the entry is `bash "<path>"`, so the executable bit
 * no longer decides whether the bootstrap runs; a git work tree with core.fileMode=false (every
 * Windows checkout) still ends with the hook staged as 100755; and a repo carrying the v27-v29
 * bare-path entry has it rewritten in place, once, with a second run changing nothing.
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKILL_TEMPLATES = path.join(REPO_ROOT, 'aac-skills', 'project-harness', 'templates');
const DELIVER = path.join(SKILL_TEMPLATES, 'add-cloud-plugin.js');
const { renderTemplate, SOURCE, TARGET } = require('./build-harness-bootstrap-hook.js');

function scratchRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-v27-'));
}

function deliver(root) {
  const r = spawnSync(process.execPath, [DELIVER, root], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `add-cloud-plugin.js exited ${r.status}: ${r.stderr}`);
  return r.stdout;
}

function snapshot(root) {
  const out = {};
  for (const rel of ['.claude/settings.json', '.claude/hooks/session-start.sh',
                     '.claude/hooks/session-start-bootstrap.sh']) {
    const p = path.join(root, rel);
    out[rel] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  return out;
}

test('the skill template is the generated copy of .claude/hooks/session-start.sh, byte for byte', () => {
  assert.strictEqual(
    fs.readFileSync(TARGET, 'utf8'),
    renderTemplate(fs.readFileSync(SOURCE, 'utf8')),
    'template is stale — run: node tools/build-harness-bootstrap-hook.js'
  );
});

test('a fresh repo gets the bootstrap hook, its SessionStart entry and the posture', () => {
  const root = scratchRepo();
  const stdout = deliver(root);
  assert.match(stdout, /bootstrap hook installed:/);

  const hook = path.join(root, '.claude', 'hooks', 'session-start.sh');
  assert.strictEqual(fs.readFileSync(hook, 'utf8'), fs.readFileSync(TARGET, 'utf8'));
  if (process.platform !== 'win32') {
    assert.ok(fs.statSync(hook).mode & 0o111, 'hook must be executable');
  }

  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const entries = s.hooks.SessionStart;
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].hooks[0].command,
                     'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"');
  assert.strictEqual(s.permissions.defaultMode, 'auto');
  // The last four are harness v32 (issue 651): an unattended Routine master parks on any tool
  // the list does not name, because acceptEdits asks before the classifier is ever reached.
  assert.deepStrictEqual(s.permissions.allow, [
    'Bash(*)', 'Edit', 'Write', 'mcp__github__*',
    'Workflow', 'Agent', 'Task', 'mcp__Claude_Code_Remote__*',
  ]);
  assert.match(s.autoMode.allow[0], /issue 543/);
  assert.strictEqual(s.enabledPlugins['aac-skills@claude-dotfiles'], true);
});

test('a second run changes nothing and says so', () => {
  const root = scratchRepo();
  deliver(root);
  const before = snapshot(root);
  const stdout = deliver(root);
  assert.match(stdout, /already delivered/);
  assert.deepStrictEqual(snapshot(root), before);
});

test('a repo whose settings file is a CRLF blob keeps its line endings (issue 87)', () => {
  const root = scratchRepo();
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  const file = path.join(root, '.claude', 'settings.json');
  fs.writeFileSync(file, '{\r\n  "permissions": {\r\n    "defaultMode": "auto"\r\n  }\r\n}\r\n');
  deliver(root);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!/(^|[^\r])\n/.test(text),
    'the rewrite emitted a bare LF into a CRLF blob — on claude-dotfiles that reopens the ' +
    'phantom " M" the .gitattributes -text pin exists to close');
  assert.match(JSON.parse(text).autoMode.allow[0], /issue 543/);
});

test('a repo that already wired the hook untagged keeps its entry, its mode and its other hooks', () => {
  const root = scratchRepo();
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
    permissions: { defaultMode: 'bypassPermissions', allow: ['Bash(git *)'] },
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh', timeout: 120 }] },
        { hooks: [{ type: 'command', command: 'node "tools/freshness.js"' }] },
      ],
    },
  }, null, 2) + '\n');
  deliver(root);

  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const commands = s.hooks.SessionStart
    .flatMap((g) => g.hooks.map((h) => h.command))
    .filter((c) => c.includes('.claude/hooks/session-start.sh'));
  assert.strictEqual(commands.length, 1, 'the untagged entry must not be duplicated');
  assert.strictEqual(s.hooks.SessionStart.length, 2, 'other SessionStart hooks survive');
  assert.strictEqual(s.permissions.defaultMode, 'bypassPermissions', 'never downgrade an explicit mode');
  assert.ok(s.permissions.allow.includes('Bash(git *)'), 'never shrink an existing allow list');
  assert.ok(s.permissions.allow.includes('mcp__github__*'));
});

test('a foreign session-start.sh survives byte-for-byte; the bootstrap lands beside it (issue 542)', () => {
  const root = scratchRepo();
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  const foreign = '#!/bin/sh\n# test-deps hook: pip install -e ".[dev]"; git config core.hooksPath .githooks\n';
  fs.writeFileSync(path.join(root, '.claude', 'hooks', 'session-start.sh'), foreign);
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [
      { hooks: [{ type: 'command', command: 'sh "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"' }] },
    ] },
  }, null, 2) + '\n');
  const stdout = deliver(root);
  assert.match(stdout, /installed alongside \.claude\/hooks\/session-start\.sh \(kept/);

  assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'hooks', 'session-start.sh'), 'utf8'), foreign,
    'the foreign hook must be untouched');
  const sidecar = path.join(root, '.claude', 'hooks', 'session-start-bootstrap.sh');
  assert.strictEqual(fs.readFileSync(sidecar, 'utf8'), fs.readFileSync(TARGET, 'utf8'));
  if (process.platform !== 'win32') assert.ok(fs.statSync(sidecar).mode & 0o111, 'sidecar must be executable');

  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const commands = s.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.strictEqual(commands.length, 2, 'both hooks are wired');
  assert.strictEqual(commands[0], 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start-bootstrap.sh"', 'bootstrap first');
  assert.match(commands[1], /session-start\.sh"$/, 'the foreign entry survives, after it');

  // A second run is idempotent on the sidecar and never grows a second copy.
  const before = snapshot(root);
  assert.match(deliver(root), /already delivered/);
  assert.deepStrictEqual(snapshot(root), before);
});

test('an older copy of the template under session-start.sh is overwritten in place, not sidecar-installed', () => {
  const root = scratchRepo();
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  const older = fs.readFileSync(TARGET, 'utf8').replace(/\n/, '\n# older copy of the template\n');
  assert.ok(older.includes('aac-bootstrap') && older.includes('CLAUDE_CODE_REMOTE'), 'fixture keeps the markers');
  fs.writeFileSync(path.join(root, '.claude', 'hooks', 'session-start.sh'), older);
  const stdout = deliver(root);
  assert.match(stdout, /bootstrap hook updated:/);
  assert.strictEqual(fs.readFileSync(path.join(root, '.claude', 'hooks', 'session-start.sh'), 'utf8'),
                     fs.readFileSync(TARGET, 'utf8'));
  assert.ok(!fs.existsSync(path.join(root, '.claude', 'hooks', 'session-start-bootstrap.sh')), 'no sidecar');
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.strictEqual(s.hooks.SessionStart[0].hooks[0].command, 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"');
});

// ---------------------------------------------------------------------------------- v30 ---------
function gitRepo(root, fileMode) {
  const r = spawnSync('git', ['-C', root, 'init', '-q'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'git init: ' + r.stderr);
  spawnSync('git', ['-C', root, 'config', 'core.fileMode', fileMode ? 'true' : 'false']);
}
function indexMode(root, rel) {
  return (spawnSync('git', ['-C', root, 'ls-files', '-s', '--', rel], { encoding: 'utf8' }).stdout || '')
    .split(' ')[0];
}

test('in a git work tree with core.fileMode=false the hook is staged as 100755 (issue 614)', () => {
  // The Windows shape: fs.chmod is invisible to git, so without update-index the sweep commits
  // 100644 and every cloud session exits 126 before the hook's first line.
  const root = scratchRepo();
  gitRepo(root, false);
  const stdout = deliver(root);
  assert.match(stdout, /staged \.claude\/hooks\/session-start\.sh as 100755/);
  assert.strictEqual(indexMode(root, '.claude/hooks/session-start.sh'), '100755');
  // Idempotent: the index already says 100755, so nothing is restaged and nothing is reported.
  assert.match(deliver(root), /already delivered/);
});

test('a repo at v27-v29 has its bare-path entry rewritten to the bash form in place, once', () => {
  const root = scratchRepo();
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'hooks', 'session-start.sh'), fs.readFileSync(TARGET, 'utf8'));
  fs.writeFileSync(path.join(root, '.claude', 'settings.json'), JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: 'command', command: 'node "tools/first.js"' }] },
        { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh', timeout: 120,
                    statusMessage: 'Cloud container: installing the aac-skills payload...' }] },
      ],
    },
  }, null, 2) + '\n');
  deliver(root);
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const commands = s.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
  assert.deepStrictEqual(commands, ['node "tools/first.js"', 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"'],
    'rewritten in place: same position, no duplicate');
  assert.strictEqual(s.hooks.SessionStart[1].hooks[0].timeout, 120, 'the rest of the entry survives');
  const before = snapshot(root);
  assert.match(deliver(root), /already delivered/);
  assert.deepStrictEqual(snapshot(root), before);
});

test('the wired command never depends on the executable bit', () => {
  const root = scratchRepo();
  deliver(root);
  const hook = path.join(root, '.claude', 'hooks', 'session-start.sh');
  fs.chmodSync(hook, 0o644);
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  const command = s.hooks.SessionStart[0].hooks[0].command;
  // A local session (no CLAUDE_CODE_REMOTE) exits 0 at once; the bare-path form exits 126 here.
  const r = spawnSync('sh', ['-c', command], { encoding: 'utf8', env: { PATH: process.env.PATH, CLAUDE_PROJECT_DIR: root } });
  assert.strictEqual(r.status, 0, 'a 644 hook must still run through the wired command: ' + r.stderr);
});

test("this repo's own settings already carry the delivery, Workflow allow included (issue 705)", () => {
  // A scriptPath Workflow call (the fleet) asks with no "don't ask again" option, and in auto mode
  // an ask on Workflow becomes the usage-consent prompt before the classifier sees it. Only a
  // permissions.allow entry skips both; claude-dotfiles never re-ran v32's delivery on itself.
  const root = scratchRepo();
  fs.mkdirSync(path.join(root, '.claude', 'hooks'), { recursive: true });
  for (const rel of ['.claude/settings.json', '.claude/hooks/session-start.sh']) {
    fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(root, rel));
  }
  const s = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.permissions.allow.includes('Workflow'), 'Workflow missing from .claude/settings.json permissions.allow');
  assert.match(deliver(root), /already delivered/,
    'run: node aac-skills/project-harness/templates/add-cloud-plugin.js . and commit .claude/settings.json');
});
