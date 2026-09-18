'use strict';

/**
 * Shared fixtures for the tests in this directory (issue 300).
 *
 * Two of them asked "does THIS repo read current?" and answered it with
 * `path.resolve(__dirname, '..', '..', '..')`. That is the repo root only from the
 * `aac-skills/session-check` mirror; from the installed copy — `~/.claude/skills/session-check`,
 * the directory SKILL.md tells you to run the tests from — it names the home directory, which is
 * not harnessed, so both tests went red and stayed red. The assumption lives here once now, as a
 * search rather than a count, so the next copy of it cannot rot out of sight.
 *
 * Test-only. Nothing in check.js or its modules requires this file.
 */

const fs = require('node:fs');
const path = require('node:path');

// The two variables check.js reads for IS_CLOUD. A cloud agent container sets them for every
// process it spawns, including `node --test`, so tests inherit them unless they are stripped.
const CLOUD_ENV_KEYS = ['CLAUDE_CODE_REMOTE_SESSION_ID', 'CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE'];

/**
 * The nearest enclosing checkout that check.js would call harnessed: a `.git` (a directory in a
 * clone, a file in a worktree) plus one of the two signals harness-version.js reads — the
 * `docs/agents/harness-version.md` stamp, or `scripts/build-dashboard.js` for a pre-marker repo.
 * A checkout carrying neither is not the repo these tests mean; a checkout whose stamp has drifted
 * still matches, so drift stays a failure instead of falling back to a fixture that always passes.
 * Returns null when this copy of the skill is installed outside any such checkout.
 */
function findHarnessedRepoRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))
      && (fs.existsSync(path.join(dir, 'docs', 'agents', 'harness-version.md'))
        || fs.existsSync(path.join(dir, 'scripts', 'build-dashboard.js')))) {
      return dir;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * `process.env` with the cloud markers removed, then `extra` applied on top. Tests asserting the
 * LOCAL half of a cloud/local pair need this: inside a cloud agent container the inherited markers
 * turn the cloud branch on and those assertions fail for a reason that has nothing to do with the
 * code under test. The cloud tests pass their own marker in `extra`, which still wins.
 */
function localEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const key of CLOUD_ENV_KEYS) delete env[key];
  return Object.assign(env, extra || {});
}

module.exports = { CLOUD_ENV_KEYS, findHarnessedRepoRoot, localEnv };
