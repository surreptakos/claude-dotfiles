#!/usr/bin/env node
/**
 * Concurrent-attempt-safe branch naming for the ticket-fleet workflow.
 *
 * Two ticket-fleet runs can pick up the same open ticket at the same time
 * (nothing on the tracker side prevents it). Without a per-run identifier
 * both runners would spawn implementers that try to create
 * `agent/issue-<N>-attempt1`, and the second git-branch or push collides.
 *
 * The scout template (agents/skills/project-harness/templates/ticket-fleet.js
 * and its live copy at .claude/workflows/ticket-fleet.js) mints a `runId` per
 * invocation and hands each spawned implementer a per-worker suffix
 * `wf_<runId>-w<workerN>` (workerN = the ticket's index in the wave). That
 * suffix is embedded in the branch name, so two concurrent scouts against the
 * same ticket produce distinct branches. Retries within the same worker still
 * add `-attempt<N>` so a re-implement after a failed verify does not overwrite
 * its own predecessor either.
 *
 * The alternative "query-and-increment" pattern the acceptance criteria list -
 *   gh api repos/<owner>/<repo>/branches --paginate --jq \
 *     '.[].name | select(startswith("agent/issue-N-attempt"))'
 * then increment - has a race between the query and the branch creation, so
 * this repo picks the runId path instead.
 *
 * This module holds the pure functions the workflow relies on, so the same
 * naming logic is exercised by `tools/ticket-fleet-branch.test.js` without
 * having to spin up the actual Workflow tool. The workflow file inlines the
 * same shape (`agent/issue-<N>-attempt<attempt>-wf_<runId>-w<workerN>`); the
 * test asserts the workflow file references the pattern so the two cannot
 * drift silently.
 */
'use strict';

/**
 * Generate a run identifier that is monotonically-ish increasing and hard to
 * collide across concurrent invocations. Not a UUID because the workflow
 * environment cannot `require('node:crypto')` reliably; a millisecond
 * timestamp plus 4 hex-ish chars of Math.random is enough - branch names are
 * short-lived and the workerN component adds another dimension of uniqueness.
 */
function generateRunId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 6);
  return t + r;
}

/**
 * Build the branch name a spawned implementer must use.
 *
 * @param {number|string} ticketNumber - GitHub issue number
 * @param {string} runId - identifier for this ticket-fleet invocation
 * @param {number} workerIndex - 0-based index of the ticket in the wave
 * @param {number} attempt - 1-based retry counter within this worker
 * @returns {string} branch name shaped agent/issue-N-attemptA-wf_<runId>-w<workerN>
 */
function buildBranchName(ticketNumber, runId, workerIndex, attempt) {
  if (ticketNumber == null) { throw new Error('buildBranchName: ticketNumber required'); }
  if (!runId) { throw new Error('buildBranchName: runId required'); }
  if (workerIndex == null) { throw new Error('buildBranchName: workerIndex required'); }
  if (attempt == null) { throw new Error('buildBranchName: attempt required'); }
  return `agent/issue-${ticketNumber}-attempt${attempt}-wf_${runId}-w${workerIndex}`;
}

/**
 * The per-worker suffix the scout template passes to each spawned agent as an
 * explicit part of the branch name. Exposed as its own function so a caller
 * that wants only the suffix (e.g. an agent label) can get it without having
 * to construct a full branch name.
 */
function workerSuffix(runId, workerIndex) {
  if (!runId) { throw new Error('workerSuffix: runId required'); }
  if (workerIndex == null) { throw new Error('workerSuffix: workerIndex required'); }
  return `wf_${runId}-w${workerIndex}`;
}

module.exports = { generateRunId, buildBranchName, workerSuffix };
