#!/usr/bin/env node
/**
 * node --test tools/session-start-hook.test.js
 *
 * The cloud-container bootstrap hook (.claude/hooks/session-start.sh) emits ONE
 * SessionStart `additionalContext` line on prompt 1 (spec #207 step 6). Issue 242
 * discovered that a model reading that line has a coin-flip between the plugin's
 * `/aac-skills:<skill>` namespaced slash form and the bare `/<skill>` form, and
 * only the bare form resolves in a bootstrapped container because the bootstrap
 * copies each skill dir to `~/.claude/skills/<bare-name>/` and never registers
 * the plugin. The evidence recap is at docs/tickets/242-decision.md.
 *
 * This test pins the fix: run the hook against a fixture and assert that the
 * additionalContext sentence explicitly names the working spelling AND flags the
 * non-resolving one. Deleting or paraphrasing that clause fails here before it
 * reaches a container.
 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const HOOK = path.join(REPO_ROOT, '.claude', 'hooks', 'session-start.sh');

function runHook() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-bootstrap-hook-'));
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
  const envFile = path.join(home, 'env-file');
  fs.writeFileSync(envFile, '');
  const result = spawnSync('bash', [HOOK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CODE_REMOTE: 'true',
      BOOTSTRAP_HOME: home,
      BOOTSTRAP_SOURCE: REPO_ROOT,
      BOOTSTRAP_SKIP_GH: '1',
      CLAUDE_ENV_FILE: envFile,
    },
  });
  return { result, home };
}

test('SessionStart additionalContext names the bare /<skill> spelling and flags /aac-skills:<skill> as non-resolving (issue 242)', () => {
  const { result } = runHook();
  assert.equal(result.status, 0, `hook exited ${result.status}\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`);
  const payload = JSON.parse(result.stdout);
  const ctx = payload.hookSpecificOutput.additionalContext;
  // The working spelling is spelled out with the bare-name marker.
  assert.match(ctx, /invoke skills as \/<skill> \(bare name\)/,
    `additionalContext missing the working-spelling clause:\n${ctx}`);
  // The non-resolving spelling is named contrastively so a reader does not try it.
  assert.match(ctx, /\/aac-skills:<skill> form does not resolve/,
    `additionalContext missing the non-resolving-spelling flag:\n${ctx}`);
  // The clause references issue 242 so the coupling to the decision doc is visible.
  assert.match(ctx, /issue 242/, `additionalContext missing the issue-242 back-reference:\n${ctx}`);
});

test('SessionStart additionalContext states that custom agent types do not resolve here (issue 339)', () => {
  const { result } = runHook();
  assert.equal(result.status, 0, `hook exited ${result.status}\nstderr:\n${result.stderr}`);
  const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  // The bootstrap cannot register a dotfiles agent for the session that runs it: the agent
  // registry is read before SessionStart hooks (experiment in docs/tickets/339-decision.md).
  // A script that pins one fails with "Agent type '<name>' not found", an error that names the
  // type and not the cause - so the line has to name the cause.
  assert.match(ctx, /no custom agent types here/,
    `additionalContext missing the agent-type clause:\n${ctx}`);
  assert.match(ctx, /agent registry is read before this hook runs/,
    `additionalContext missing the cause of the agent-type limitation:\n${ctx}`);
  assert.match(ctx, /issue 339/, `additionalContext missing the issue-339 back-reference:\n${ctx}`);
});

test('SessionStart additionalContext stays under the 2 KB platform cap (probe #175)', () => {
  const { result } = runHook();
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  const ctx = payload.hookSpecificOutput.additionalContext;
  assert.ok(ctx.length <= 2000,
    `additionalContext is ${ctx.length} bytes; the platform cap is 2000. The invoke-as clause added for issue 242 must not push the sentence past it. Full sentence:\n${ctx}`);
});
