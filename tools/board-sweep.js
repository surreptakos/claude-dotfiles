#!/usr/bin/env node
/**
 * Runner for .github/workflows/board-sweep.yml (issue 216, spec #207).
 *
 *   node tools/board-sweep.js            # dry-run (prints what would move)
 *   node tools/board-sweep.js --apply    # write
 *
 * WHAT THIS IS NOT: a second copy of the sweep. The sweep is `sweep-closed-to-done.js`, the
 * script the session-end skill ships; this runner locates that script and spawns it. Forking the
 * board logic into tools/ would give the workflow and a local `/session-end` two implementations
 * that drift apart silently — the exact failure this ticket exists to remove.
 *
 * What the runner owns is the part a workflow would otherwise express as untested YAML bash:
 *
 *   1. PROJECT_TOKEN present, or the run fails loudly. ProjectsV2 is owner-scoped; the built-in
 *      GITHUB_TOKEN is repo-scoped and cannot read or write an owner-level board. Without a loud
 *      failure a token-less run is indistinguishable from a clean board — green, sweeping
 *      nothing, forever.
 *   2. The child sees GH_TOKEN=PROJECT_TOKEN and no GITHUB_TOKEN, so the repo-scoped job token
 *      cannot win the precedence fight inside `gh` and produce that same silent nothing.
 *   3. The sweep's stdout+stderr are mirrored to $GITHUB_STEP_SUMMARY, so the run log lands on
 *      the run page as quotable text instead of only inside a collapsed step.
 *
 * Exit codes are the sweep's own: 0 nothing-to-do / all writes ok, 1 a write failed, 2 hard
 * failure. 1 is also the missing-token refusal, 2 the missing-script refusal.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');

// The mirror of ~/.claude/skills first, the built plugin payload second. skill-stamps.yml fails
// any branch where those two disagree, so which one runs is not a behavioural choice.
const SCRIPT_CANDIDATES = [
  'agents/skills/session-end/sweep-closed-to-done.js',
  'marketplace/aac-skills/skills/session-end/sweep-closed-to-done.js',
];

const MISSING_TOKEN = '::error::PROJECT_TOKEN is not set. The board sweep reads and writes an '
  + 'owner-level ProjectsV2 board, which the repo-scoped GITHUB_TOKEN cannot reach. Store the '
  + 'token minted in issue 215 as the Actions secret PROJECT_TOKEN (Settings > Secrets and '
  + 'variables > Actions), then re-run this workflow. Refusing to run: a sweep with no token '
  + 'goes green having moved nothing, which looks exactly like a clean board.';

function resolveScript(root = REPO_ROOT) {
  for (const rel of SCRIPT_CANDIDATES) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function boardSweep(opts = {}) {
  const env = opts.env || process.env;
  const argv = opts.argv || process.argv.slice(2);
  const spawn = opts.spawn || ((cmd, args, o) => spawnSync(cmd, args, o));
  const out = [];
  const emit = opts.log || ((line) => console.log(line));
  const log = (line) => { out.push(line); emit(line); };
  const finish = (code, spawned) => {
    const summary = env.GITHUB_STEP_SUMMARY;
    if (summary) {
      fs.appendFileSync(summary, `### Board sweep\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`, 'utf8');
    }
    return { code, output: out.join('\n'), spawned };
  };

  const token = (env.PROJECT_TOKEN || '').trim();
  if (!token) {
    log(MISSING_TOKEN);
    return finish(1, false);
  }

  const script = resolveScript(opts.root || REPO_ROOT);
  if (!script) {
    log(`::error::no sweep script in this checkout — looked for ${SCRIPT_CANDIDATES.join(' and ')}.`);
    return finish(2, false);
  }

  const childEnv = { ...env, GH_TOKEN: token };
  delete childEnv.GITHUB_TOKEN;
  const args = [script];
  if (argv.includes('--apply')) args.push('--apply');

  const res = spawn(process.execPath, args, {
    cwd: opts.cwd || process.cwd(),
    env: childEnv,
    encoding: 'utf8',
  });
  for (const stream of [res.stdout, res.stderr]) {
    if (stream) for (const line of String(stream).split('\n')) if (line !== '') log(line);
  }
  const code = (res.status === null || res.status === undefined) ? 2 : res.status;
  if (code !== 0) log(`::error::board sweep exited ${code} — see the lines above.`);
  return finish(code, true);
}

module.exports = { boardSweep, resolveScript, MISSING_TOKEN, SCRIPT_CANDIDATES };

if (require.main === module) process.exit(boardSweep().code);
