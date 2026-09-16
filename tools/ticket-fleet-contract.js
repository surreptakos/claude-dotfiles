#!/usr/bin/env node
/**
 * The ticket-fleet launch contract: what a caller must pass, what the scout
 * must return, and which repos hold a copy that has to move when either changes.
 *
 * The fleet script is served by the aac-skills plugin, but two other repos keep
 * an edited fork under `.claude/workflows/ticket-fleet.js`, and four documents
 * here spell out the launch args. Every time the arg list moved, those forks broke at
 * launch on a bare "args.X is required" and nobody could tell from the message
 * that the copy - not the call - was out of date (issue 333).
 *
 * So the contract is versioned. The script inlines the same version behind the
 * `[FLEET-CONTRACT-VERSION N]` marker and refuses a launch whose `contractVersion`
 * is absent or different, with a message that names both sides and the ripple
 * list. `contractVersionOf` reads that marker out of any fork copy, so
 * `node tools/ticket-fleet-contract.js <fork.js>...` says which forks are stale
 * before a run does.
 *
 * Bumping the contract means: change CONTRACT_VERSION here and the inline marker
 * in aac-skills/ticket-fleet/ticket-fleet.js, update the ripple table in
 * aac-skills/ticket-fleet/SKILL.md, and refresh every fork in FORKS.
 * tools/ticket-fleet-contract.test.js fails the branch when those disagree.
 */
'use strict';

const fs = require('node:fs');

/** Contract version the plugin-served script implements. */
const CONTRACT_VERSION = 2;

/** Args every launch must pass. v1 was runId only; v2 added the other two. */
const REQUIRED_ARGS = ['contractVersion', 'runId', 'invocationId'];

/** Top-level fields the SCOUT schema requires. */
const SCOUT_REQUIRED = ['candidateNumbers', 'tickets', 'repoMap', 'testCommand', 'defaultBranch'];

/** Fields the SCOUT schema requires of every ticket it returns. */
const TICKET_REQUIRED = ['number', 'title', 'criteria', 'blockedBy', 'keepOpen', 'kind', 'kindReason', 'discoveryTriage'];

/**
 * Every copy of the script that is NOT refreshed by this repo's packager, and
 * every document that spells out the launch args. A contract bump has to reach
 * all of them; the SKILL.md ripple table repeats this list for a human reader
 * and the test pins the two together.
 */
const FORKS = [
  { repo: 'surreptakos/aac-routines', path: '.claude/workflows/ticket-fleet.js', keeps: 'Setup phase (sub-session auth, issue 83) and the no-cleanup history' },
  { repo: 'surreptakos/aac-cockpit', path: '.claude/workflows/ticket-fleet.js', keeps: 'PROMPT_CONTRACT' },
];

const RUNBOOKS = [
  'claude-dotfiles orchestrator/RUNBOOK.md',
  'claude-dotfiles orchestrator/LOCAL-RUNBOOK.md',
  'claude-dotfiles aac-skills/ticket-fleet/SKILL.md',
  'claude-dotfiles agents/skills/project-harness/SKILL.md',
];

/** The sentence every contract failure ends with: where the other copies are. */
function rippleNote() {
  return 'Forks and runbooks that must move with the contract: '
    + FORKS.map((f) => `${f.repo} ${f.path}`).join(', ')
    + ', ' + RUNBOOKS.join(', ')
    + '. Refresh a fork by re-copying the plugin script over it (keeping that fork\'s own edits) - see the ripple table in aac-skills/ticket-fleet/SKILL.md.';
}

/**
 * Validate the args a caller launched with against this contract.
 *
 * @param {object|null|undefined} args
 * @returns {{ok: true}|{ok: false, error: string}} error names the contract
 *   version on both sides, never a bare missing-argument complaint.
 */
function checkLaunchArgs(args) {
  const a = args || {};
  const head = `ticket-fleet contract mismatch: this script implements contract v${CONTRACT_VERSION}`;
  const tail = ` Contract v${CONTRACT_VERSION} requires args {${REQUIRED_ARGS.join(', ')}}; its scout must return {${SCOUT_REQUIRED.join(', ')}} with per-ticket {${TICKET_REQUIRED.join(', ')}}. ${rippleNote()}`;
  const declared = a.contractVersion;
  if (declared === undefined || declared === null || declared === '') {
    return { ok: false, error: `${head} and the launcher declared no args.contractVersion, so it was written for an older contract (v1 passed runId alone). Pass contractVersion: ${CONTRACT_VERSION}.${tail}` };
  }
  if (parseInt(declared, 10) !== CONTRACT_VERSION) {
    return { ok: false, error: `${head}, but the launcher declared contractVersion ${declared}. One of the two is stale: refresh the fork copy of the script, or the runbook that launches it, whichever is older.${tail}` };
  }
  for (const name of REQUIRED_ARGS) {
    if (name === 'contractVersion') continue;
    if (!a[name]) {
      return { ok: false, error: `${head}, but the launcher declared v${CONTRACT_VERSION} and passed no args.${name}. The launch is not at the contract it claims.${tail}` };
    }
  }
  if (String(a.runId) === String(a.invocationId)) {
    return { ok: false, error: `${head}: args.invocationId must differ from args.runId. runId stays fixed across a resume (the branch names embed it) while invocationId is re-minted on every launch, which is what makes the open-PR guard re-ask the tracker instead of replaying a cached answer (issue 291).${tail}` };
  }
  return { ok: true };
}

/**
 * The contract version a copy of the fleet script implements, read from the
 * `[FLEET-CONTRACT-VERSION N]` marker.
 *
 * @param {string} source - the script's text
 * @returns {number|null} null when the marker is absent: a pre-contract fork.
 */
function contractVersionOf(source) {
  const m = /\[FLEET-CONTRACT-VERSION (\d+)\]/.exec(String(source || ''));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Audit fork copies on disk against this contract.
 *
 * @param {string[]} paths
 * @returns {Array<{path: string, version: number|null, stale: boolean}>}
 */
function auditForkFiles(paths) {
  return (paths || []).map((p) => {
    const version = fs.existsSync(p) ? contractVersionOf(fs.readFileSync(p, 'utf8')) : null;
    return { path: p, version, stale: version !== CONTRACT_VERSION };
  });
}

module.exports = {
  CONTRACT_VERSION, REQUIRED_ARGS, SCOUT_REQUIRED, TICKET_REQUIRED, FORKS, RUNBOOKS,
  rippleNote, checkLaunchArgs, contractVersionOf, auditForkFiles,
};

if (require.main === module) {
  const paths = process.argv.slice(2);
  if (!paths.length) {
    console.log(`ticket-fleet contract v${CONTRACT_VERSION}: args {${REQUIRED_ARGS.join(', ')}}`);
    console.log(rippleNote());
    console.log('Usage: node tools/ticket-fleet-contract.js <path to a fork copy>...');
    process.exit(0);
  }
  const rows = auditForkFiles(paths);
  for (const r of rows) {
    console.log(`${r.stale ? 'STALE' : 'ok   '} ${r.path}: contract ${r.version === null ? 'unmarked (pre-v2 fork)' : 'v' + r.version} vs plugin v${CONTRACT_VERSION}`);
  }
  process.exit(rows.some((r) => r.stale) ? 1 : 0);
}
