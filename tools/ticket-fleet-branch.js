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
 * Decide whether the fleet may pin its `fleet-verifier` subagent type.
 *
 * Custom agent types are a desktop-only facility (issue 339). Claude Code reads
 * the agent registry before SessionStart hooks run, so the cloud bootstrap hook
 * cannot register `~/.claude/agents/fleet-verifier.md` for the session that
 * would use it - measured in a container on 2026-09-16, transcript in
 * docs/tickets/339-decision.md. Pinning the type there fails the launch with
 * "Agent type 'fleet-verifier' not found", which is how issue 316 surfaced.
 *
 * So: never pin in a remote session, and on a desktop session pin only when the
 * agent file was actually on disk (it is authored there, before session start,
 * so disk presence is a sound proxy for registration). The decision is keyed on
 * remoteness, NOT on the tracker instrument - conflating the two is what made a
 * container that picked `gh` try to launch a type it could never have.
 *
 * @param {boolean} remote - true in a cloud container session
 * @param {boolean} agentFilePresent - true when ~/.claude/agents/fleet-verifier.md exists
 * @returns {'fleet-verifier'|null} the agentType to pin, or null for none
 */
function pickVerifierAgent(remote, agentFilePresent) {
  if (remote) return null;
  return agentFilePresent ? 'fleet-verifier' : null;
}

module.exports = { generateRunId, buildBranchName, workerSuffix, pickInstrument, pickVerifierAgent };
