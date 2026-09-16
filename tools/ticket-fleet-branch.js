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
  // Unknown environment (issue 316): a null/undefined `env` means the caller had no `process`
  // binding to read. The workflow runtime hides `process`, so the remote-session sniff below
  // never fires and a claude.ai/code container is indistinguishable from a desktop session.
  // The fallback stays 'gh' because its REST paths work in both; a container caller passes
  // `instrument: 'mcp'` or `'gh'` explicitly instead of relying on a sniff that cannot run.
  // What must NOT be inferred from an unknown environment is the verifier's agent type - the
  // registry that backs it is session-local; see resolveVerifierAgent.
  if (env === undefined || env === null) return hasGh === false ? 'mcp' : 'gh';
  const e = env;
  if (e.CLAUDE_CODE_REMOTE_SESSION_ID || e.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE) return 'mcp';
  if (hasGh === false) return 'mcp';
  return 'gh';
}

/**
 * Resolve the agent type the blind verifier launches under.
 *
 * Agent types are registered once at session start from `~/.claude/agents/`. On the desktop
 * that registry holds `fleet-verifier.md`, whose frontmatter caps the verifier's tools at
 * Read, Grep, Glob, Bash (issue 86). A cloud container has no such entry - the bootstrap hook
 * copies the definition into a clone the registry never reads, and the registry is not re-read
 * mid-session - so pinning the type there fails every verifier launch with
 * `agent type 'fleet-verifier' not found` (issue 316).
 *
 * @param {'gh'|'mcp'} instrument
 * @param {string|null|undefined} override - args.verifierAgent. undefined/null takes the
 *   default (`fleet-verifier` under gh, unpinned under mcp); an empty or whitespace string
 *   clears the pin so the verifier runs under the session's default agent type; any other
 *   string pins that agent on either instrument.
 * @returns {string|undefined} the agentType to pass, or undefined for an unpinned verifier.
 */
function resolveVerifierAgent(instrument, override) {
  if (override === undefined || override === null) {
    return instrument === 'gh' ? 'fleet-verifier' : undefined;
  }
  const name = String(override).trim();
  return name || undefined;
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

/**
 * Resume-stable projections of a previous agent's structured result (issue 271).
 *
 * The Workflow runtime replays an agent() call from cache only while its cache
 * key - which covers the prompt text - is unchanged. A ticket-fleet prompt built
 * out of an earlier agent's result therefore has to render the same bytes whether
 * that result arrived live from the tool call or was re-read from the run journal
 * on resume. The two differ exactly as a JSON round trip differs: key order,
 * absent vs null vs undefined members, values a live run held as numbers or
 * booleans, and CR bytes inside quoted output. A `deliver: false` run resumed
 * with `deliver: true` missed the cache on `impl:#N.2` and `verify:#N.2` for that
 * reason, re-implementing tickets whose verified branches already existed.
 *
 * `stableText` and `stableList` are the only doors a prior result may pass
 * through on its way into a prompt, and `priorFindingsBlock` is the one place
 * that renders a failed verdict into the next attempt's prompt. The fleet script
 * inlines the same three between its FLEET-RESUME-STABLE markers (the workflow
 * runtime cannot require from tools/); ticket-fleet-branch.test.js extracts that
 * block and compares it against these, so the two copies cannot drift.
 */

/** Deterministic JSON: object keys sorted, undefined rendered as null. */
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  }
  if (value === undefined) return 'null';
  return JSON.stringify(value);
}

/** Any prior-result value as prompt text: absent/null collapse to '', CRLF folds to LF. */
function stableText(value) {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value
    : (typeof value === 'number' || typeof value === 'boolean') ? String(value)
      : stableJson(value);
  return raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Any prior-result list as prompt lines: non-arrays wrap, empty entries drop. */
function stableList(value) {
  const items = Array.isArray(value) ? value : (value === null || value === undefined) ? [] : [value];
  return items.map(stableText).filter((s) => s.length > 0);
}

/**
 * The block the next attempt's implementer/prober prompt carries after a failed
 * verdict. `howToFix` is the lane's wording; everything else comes from the
 * verdict through stableList.
 */
function priorFindingsBlock(verdict, howToFix) {
  return verdict
    ? `\nPrevious attempt FAILED verification. Independent reviewer findings (${howToFix}):\n- ${stableList(verdict.failures).join('\n- ')}`
    : '';
}

module.exports = {
  generateRunId, buildBranchName, workerSuffix, pickInstrument, confineToCandidates, resolveVerifierAgent,
  stableJson, stableText, stableList, priorFindingsBlock,
};
