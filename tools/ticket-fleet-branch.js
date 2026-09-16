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
 * Every branch prefix the fleet creates (issue 377).
 *
 * Two shapes exist: the per-ticket implementer branches
 * (`agent/issue-<N>-attempt<A>-wf_<runId>-w<workerN>`) and the one discoveries
 * branch a run's Report phase cuts for its `FOLLOW-UPS.md` bullets
 * (`agent/fleet-discoveries-wf_<runId>`, issue 360). The second was added after
 * the enumerations were written, so everything that lists "the fleet's
 * branches" - the orchestrator RUNBOOK's merge pass, the worktree cleanup in
 * tools/backfill-worktree-configs.js - has to name both or the discoveries PR
 * goes unmerged and the bullets are stranded, which is the failure issue 360
 * exists to end. This is the single list those enumerations widen against.
 */
const ISSUE_BRANCH_PREFIX = 'agent/issue-';
const DISCOVERIES_BRANCH_PREFIX = 'agent/fleet-discoveries-';
const FLEET_BRANCH_PREFIXES = Object.freeze([ISSUE_BRANCH_PREFIX, DISCOVERIES_BRANCH_PREFIX]);

/**
 * The branch the Report phase commits a run's discovery bullets to. The fleet
 * script inlines the same shape; the test asserts the two cannot drift.
 *
 * @param {string} runId - identifier for this ticket-fleet invocation
 * @returns {string} branch name shaped agent/fleet-discoveries-wf_<runId>
 */
function buildDiscoveriesBranchName(runId) {
  if (!runId) { throw new Error('buildDiscoveriesBranchName: runId required'); }
  return `${DISCOVERIES_BRANCH_PREFIX}wf_${runId}`;
}

/**
 * Is this branch one the fleet created? Accepts a plain branch name or a
 * `refs/heads/...` ref. A bare prefix with nothing after it is not a fleet
 * branch - the fleet always appends a ticket number or a runId.
 *
 * @param {string|null|undefined} name
 * @returns {boolean}
 */
function isFleetBranch(name) {
  if (!name) { return false; }
  const branch = String(name).trim().replace(/^refs\/heads\//, '');
  return FLEET_BRANCH_PREFIXES.some((p) => branch.startsWith(p) && branch.length > p.length);
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
 * @param {NodeJS.ProcessEnv|Record<string,string>|null|undefined} env - null or
 *   undefined means nothing read the environment at all (the workflow runtime
 *   hides `process`), which is an UNKNOWN session, not a desktop one.
 * @param {boolean|undefined} hasGh - true if `gh` is on PATH; undefined lets
 *   the caller decline to detect it.
 * @param {'gh'|'mcp'|'auto'|null|undefined} override
 * @returns {'gh'|'mcp'|null} null when the environment is unknown and no
 *   override names an instrument - the caller must then ask for one.
 */
function pickInstrument(env, hasGh, override) {
  if (override === 'gh' || override === 'mcp') return override;
  // Unknown environment (issues 316, 322): a null/undefined `env` means nothing read the
  // environment - the workflow runtime hides `process`, so the remote-session sniff below
  // never fires and a claude.ai/code container is indistinguishable from a desktop session.
  // It used to fall through to 'gh', and that is the issue 322 failure: under `gh` the cloud
  // run pinned an agent type its registry did not hold and its deliver prompt reached for a
  // GraphQL-backed `gh pr create`, so twelve verifiers died and nothing shipped. An unknown
  // environment therefore resolves to nothing at all and the caller must name the instrument
  // (or pass what it knows about remoteness). Only `hasGh === false` is positive evidence a
  // measurement did reach: no `gh` on PATH means mcp whatever the env said.
  if (env === undefined || env === null) return hasGh === false ? 'mcp' : null;
  const e = env;
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
 * @param {{remote:boolean, verifierAgentFile:boolean}} [facts] - the env probe's facts;
 *   when given they decide the default through pickVerifierAgent (issue 339).
 * @param {string|null|undefined} override - args.verifierAgent. undefined/null takes the
 *   default, which is a pin ONLY when `facts` prove the agent is registered: the instrument
 *   never decides it (issue 322 - a container that picked `gh` had no registry and every
 *   verifier launch died with `agent type 'fleet-verifier' not found`). An empty or
 *   whitespace string clears the pin so the verifier runs under the session's default agent
 *   type; any other string pins that agent on either instrument.
 * @returns {string|undefined} the agentType to pass, or undefined for an unpinned verifier.
 */
function resolveVerifierAgent(instrument, override, facts) {
  if (override === undefined || override === null) {
    // The env probe's facts decide the default (issue 339). Without them nothing has said the
    // agent file is on disk, so there is no pin: an unregistered type fails every launch, while
    // an unpinned verifier merely runs under the session's default type (issue 322).
    if (facts) return pickVerifierAgent(!!facts.remote, !!facts.verifierAgentFile) || undefined;
    return undefined;
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
 * open ticket it can find instead, so the fleet spawns open-PR scans and
 * implementer agents for work nobody asked for. The prompt now says an empty listing is a
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
 * Drop blockers that have already closed (issue 403).
 *
 * The scout lifts "Blocked by #N" numbers out of a ticket body, and at
 * `effort: 'low'` it never reads those issues, so a ticket whose blocker landed
 * hours ago is skipped wave after wave until somebody rewrites the body by hand.
 * The fleet therefore reads each named blocker's state through the tracker
 * instrument and passes the answers here: a blocker whose state comes back
 * `closed` is dropped from the ticket's `blockedBy`, while everything else -
 * `open`, `unknown`, a number the reader never reported - keeps blocking,
 * because the gate may only be opened by positive evidence that it has landed.
 *
 * Tickets are not mutated: one whose blockers all still hold is returned as-is,
 * one that loses a blocker is returned as a copy with the shorter `blockedBy`.
 *
 * @param {Array<{number:number, blockedBy:Array<number|string>}>|null|undefined} tickets
 * @param {Array<{number:number|string, state:string}>|null|undefined} blockers - one
 *   entry per blocker number read, carrying the tracker's state verbatim
 * @returns {{tickets:Array, cleared:Array<{ticket:number, blocker:number}>}} the
 *   tickets with closed blockers removed, and the (ticket, blocker) pairs cleared
 *   so the run can log them
 */
function applyBlockerStates(tickets, blockers) {
  const states = new Map();
  for (const b of (Array.isArray(blockers) ? blockers : [])) {
    const n = parseInt(b && b.number, 10);
    if (n > 0) states.set(n, String((b && b.state) || '').trim().toLowerCase());
  }
  const cleared = [];
  const resolved = (Array.isArray(tickets) ? tickets : []).map((t) => {
    const named = Array.isArray(t && t.blockedBy) ? t.blockedBy : [];
    const open = named.filter((n) => {
      const num = parseInt(n, 10);
      if (states.get(num) !== 'closed') return true;
      cleared.push({ ticket: t.number, blocker: num });
      return false;
    });
    return open.length === named.length ? t : Object.assign({}, t, { blockedBy: open });
  });
  return { tickets: resolved, cleared };
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
  generateRunId, buildBranchName, workerSuffix, pickInstrument,
  ISSUE_BRANCH_PREFIX, DISCOVERIES_BRANCH_PREFIX, FLEET_BRANCH_PREFIXES, buildDiscoveriesBranchName, isFleetBranch, confineToCandidates, resolveVerifierAgent, pickVerifierAgent,
  applyBlockerStates,
  stableJson, stableText, stableList, priorFindingsBlock,
};
