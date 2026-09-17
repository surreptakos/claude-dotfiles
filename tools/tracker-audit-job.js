#!/usr/bin/env node
/**
 * Runner for .github/workflows/tracker-audit.yml (issue 473).
 *
 *   node tools/tracker-audit-job.js
 *
 * WHAT THIS IS NOT: a second copy of the audit. `tools/tracker-audit.js` is the audit — its own
 * `--paginate`-free page loop (issue 171), its own sixteen checks, its own exit codes — and this
 * runner spawns it. Re-expressing any of that here would give the job and a local run two
 * implementations to drift apart, which is the failure the tracker audit itself exists to catch.
 *
 * What the runner owns is the part a workflow would otherwise express as untested YAML bash:
 *
 *   1. A token, or the run fails loudly. The audit reads the tracker through `gh api`; with no
 *      token `gh` is unauthenticated, every call 401s and the audit exits 2 — "could not audit"
 *      with a cause nobody reading the log would guess. GH_TOKEN wins over GITHUB_TOKEN, and the
 *      child is handed GH_TOKEN alone so gh's own precedence cannot pick the other one.
 *   2. The audit's stdout+stderr are mirrored to $GITHUB_STEP_SUMMARY, with every finding line
 *      listed above the quoted output — so the run page NAMES the drift instead of hiding it in a
 *      collapsed step that has to be expanded to read.
 *   3. The exit code is the audit's own, so drift is a red check: 0 clean, 1 drift found, 2 could
 *      not audit. 2 is not a pass — see tools/tracker-audit.js's header.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const AUDIT = 'tools/tracker-audit.js';

const MISSING_TOKEN = '::error::neither GH_TOKEN nor GITHUB_TOKEN is set. The audit reads the live '
  + 'tracker through `gh api`, which is unauthenticated without one: every call 401s and the audit '
  + 'exits 2 ("could not audit") for a reason the log never names. Pass the job token — '
  + 'env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} — and re-run.';

/** The audit's own finding lines, `[kind] #N title`, in the order it printed them. Pure, so the
 *  summary's list of what went wrong is testable without a tracker to drift. */
function findingLines(output) {
  return String(output || '').split('\n').filter((l) => /^\[[a-z-]+\??\] #\d+ /.test(l));
}

/** What exit code `code` means, in the words the audit's header uses. */
function verdict(code) {
  if (code === 0) return 'no drift';
  if (code === 1) return 'drift found';
  return 'could not audit — this is NOT a pass';
}

function trackerAuditJob(opts = {}) {
  const env = opts.env || process.env;
  const spawn = opts.spawn || ((cmd, args, o) => spawnSync(cmd, args, o));
  const out = [];
  const emit = opts.log || ((line) => console.log(line));
  const log = (line) => { out.push(line); emit(line); };
  const root = opts.root || REPO_ROOT;
  const finish = (code, spawned) => {
    const summary = env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const found = findingLines(out.join('\n'));
      const head = `### Tracker audit — exit ${code} (${verdict(code)})\n\n`;
      const list = found.length ? found.map((l) => `- \`${l}\``).join('\n') + '\n\n' : '';
      try {
        fs.appendFileSync(summary, `${head}${list}\`\`\`\n${out.join('\n')}\n\`\`\`\n`, 'utf8');
      } catch (e) {
        emit(`::warning::could not write the job summary: ${e.message}`);
      }
    }
    return { code, output: out.join('\n'), spawned };
  };

  const token = String(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
  if (!token) {
    log(MISSING_TOKEN);
    return finish(2, false);
  }

  const script = path.join(root, AUDIT);
  if (!fs.existsSync(script)) {
    log(`::error::no audit in this checkout — looked for ${AUDIT}.`);
    return finish(2, false);
  }

  const childEnv = Object.assign({}, env, { GH_TOKEN: token });
  delete childEnv.GITHUB_TOKEN;
  const res = spawn(process.execPath, [script], {
    cwd: opts.cwd || root,
    env: childEnv,
    encoding: 'utf8',
  });
  for (const stream of [res.stdout, res.stderr]) {
    if (stream) for (const line of String(stream).split('\n')) if (line !== '') log(line);
  }
  const code = (res.status === null || res.status === undefined) ? 2 : res.status;
  if (code !== 0) {
    const found = findingLines(out.join('\n'));
    log(`::error::tracker audit exited ${code} (${verdict(code)})`
      + (found.length ? ` — ${found[0]}${found.length > 1 ? ` (+${found.length - 1} more)` : ''}` : ''));
  }
  return finish(code, true);
}

module.exports = { trackerAuditJob, findingLines, verdict, MISSING_TOKEN, AUDIT };

if (require.main === module) process.exit(trackerAuditJob().code);
