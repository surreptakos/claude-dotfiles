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

/**
 * Pick the tracker instrument at run time. Ticket-fleet runs from two shapes of
 * session and the tracker tools differ between them:
 *   - Local session with `gh` on PATH -> 'gh': `gh api repos/{owner}/{repo}/...`
 *     REST paths only (GraphQL-backed `gh` subcommands 403 through the cloud
 *     proxy, issue 130).
 *   - Cloud container (CLAUDE_CODE_REMOTE_SESSION_ID or
 *     CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE set, or no `gh` on PATH) -> 'mcp':
 *     the GitHub MCP tools.
 * `override` wins when it names either instrument, so a caller that already
 * knows the container shape can force it. This is the pure counterpart the
 * script inlines: same shape, same environment variables, exercised by
 * ticket-fleet-branch.test.js so the two cannot drift silently.
 *
 * @param {NodeJS.ProcessEnv|Record<string,string>|undefined} env
 * @param {boolean|undefined} hasGh - true if `gh` is on PATH; undefined lets
 *   the caller decline to detect it (defaults to `gh` in that case).
 * @param {'gh'|'mcp'|'auto'|null|undefined} override
 * @returns {'gh'|'mcp'}
 */
function pickInstrument(env, hasGh, override) {
  if (override === 'gh' || override === 'mcp') return override;
  const e = env || {};
  if (e.CLAUDE_CODE_REMOTE_SESSION_ID || e.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE) return 'mcp';
  if (hasGh === false) return 'mcp';
  return 'gh';
}

/**
 * Confine the scout's ticket list to the candidate set it was given (issue 298).
 *
 * The scout is asked for exactly one listing - the issues carrying `label`, or
 * the numbers named in `args.tickets`. When that listing comes back empty a
 * model is prone to treat it as a dead end to route around and returns every
 * open ticket it can find instead, so the fleet spawns pr-check and implementer
 * agents for work nobody asked for. The prompt now says an empty listing is a
 * valid answer; this is the mechanical half of the same guard: whatever the
 * scout reports, only tickets whose number appeared in the listing survive.
 *
 * @param {Array<{number:number|string}>|null|undefined} tickets - scout output
 * @param {Array<number|string>|null|undefined} candidateNumbers - the issue
 *   numbers the listing returned, before any filtering. A non-array (the scout
 *   did not report one) means there is nothing to confine against and the
 *   tickets pass through unchanged; an empty array confines to nothing, which
 *   is the whole point of the ticket.
 * @returns {Array} the surviving tickets, in the scout's order
 */
function confineToCandidates(tickets, candidateNumbers) {
  const list = Array.isArray(tickets) ? tickets : [];
  if (!Array.isArray(candidateNumbers)) return list;
  const allowed = new Set(
    candidateNumbers.map((n) => parseInt(n, 10)).filter((n) => n > 0)
  );
  return list.filter((t) => t && allowed.has(parseInt(t.number, 10)));
}

module.exports = { generateRunId, buildBranchName, workerSuffix, pickInstrument, confineToCandidates };
