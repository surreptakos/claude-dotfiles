---
name: ticket-fleet
description: >
  Parallel ticket runner: scout, pinned implementer per ticket, blind refuting verifier, PR
  on pass, discovery collection. Drives open ready-for-agent tickets to verified PRs in
  parallel; also runs probe tickets (evidence in a comment) and ready-for-human tickets
  (verify what a container can, hand the rest to the owner). One script served by this plugin,
  invoked via the Workflow tool with `scriptPath` from local and cloud sessions alike; the
  script picks between the `gh` CLI and the GitHub MCP tools at run time. Use when the user
  asks to run the ticket fleet, clear a wave of `ready-for-agent` tickets, or invoke the
  fleet from an orchestrator worker cycle.
metadata:
  modified: "2026-09-16T06:35:49Z"
  previous-modified: "2026-09-16T06:33:46Z"
  revision: "10"
  content-sha: "5b0ae39e0eae"
---

# ticket-fleet

One script, `ticket-fleet.js` alongside this SKILL.md, that serves every session shape:

- **Local session** (has `gh`): the fleet talks to the tracker through `gh api repos/{owner}/{repo}/...` REST paths (GraphQL-backed `gh` subcommands 403 through the cloud proxy, so REST only - issue 130).
- **Cloud container** (`CLAUDE_CODE_REMOTE_SESSION_ID` set, or no `gh` on PATH): the fleet talks to the tracker through the GitHub MCP tools (`mcp__github__list_issues`, `mcp__github__issue_read`, `mcp__github__add_issue_comment`, `mcp__github__create_pull_request`).

The switch is made by `pickInstrument(env, hasGh, override)` inside the script; the pure
counterpart lives at `tools/ticket-fleet-branch.js` in `claude-dotfiles`, exercised by
`tools/ticket-fleet-branch.test.js`.

## How to invoke

Call the Workflow tool with `scriptPath` set to a copy of this file inside the current
checkout's `.claude/workflows/`. The Workflow tool resolves a bare `name:` from that same
directory, and it reads the file behind `scriptPath` byte-for-byte before showing the approval
dialog - a CR anywhere in the payload trips "script contains control characters that would be
hidden in the approval dialog" and the launch is refused (issue 233 - and this repo pins
`* -text`, so a CRLF blob reaches every surface verbatim). Three args are required and they are the
contract: `contractVersion`, `runId` and `invocationId` (the workflow runtime forbids `Date.now()`
and `Math.random()` inside scripts, so the caller mints both ids). A launch that omits any of them
fails with a contract-mismatch error naming the version on both sides and the ripple list - see
**Contract and ripple list** below.

**Checkout-path invocation (works on desktop and in cloud sessions).** Once
`.claude/workflows/ticket-fleet.js` exists in the cwd, either spelling launches the fleet:

```
Workflow({
  scriptPath: '.claude/workflows/ticket-fleet.js',
  args: {
    contractVersion: 2,
    runId: '<hex from `printf %x $(date +%s)`>',
    invocationId: '<fresh hex from `printf %x%x $(date +%s) $$`, re-minted on every launch>',
    tickets: [], deliver: false,
  }
})
```

```
Workflow({
  name: 'ticket-fleet',
  args: { contractVersion: 2, runId: '<hex>', invocationId: '<fresh hex>', tickets: [], deliver: false }
})
```

**Copy-into-cwd step (for any repo, including `claude-dotfiles` itself).** This plugin path
holds the source of truth, but a bare `name:` and a checkout-relative `scriptPath` both need
the script to live under `.claude/workflows/` in the current working directory. Copy it there
before the first invocation:

```bash
mkdir -p .claude/workflows
cp "${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js" .claude/workflows/ticket-fleet.js
```

On a fork (aac-routines' auth/cleanup phases, aac-cockpit's `PROMPT_CONTRACT`) the copy is
edited in place; on every other repo the copy stays a byte-identical mirror of the plugin
source and is refreshed by re-running the `cp` above whenever the plugin bumps.

On a repo's first run, always pass `deliver: false` - verify the Scout, lane and verifier
prompts before letting the fleet push branches and open PRs. Full args list:

- `contractVersion` (required, integer): the contract the caller was written for. It must equal
  the version the script implements (2 today) or the launch is refused - that is what makes a
  stale fork or a stale runbook say so instead of dying on the first arg it does not know.
- `runId` (required, string): caller-minted unique token, kept the SAME across a resume. Any
  short unique string; the branch names embed it as `wf_<runId>-w<workerIndex>`.
- `invocationId` (required, string): a DIFFERENT fresh token per launch, resume included. It is
  spliced into the open-PR guard's prompt and label so a resumed run re-asks the tracker instead
  of replaying a cached "no PR" answer (issue 291); the script refuses it when it equals `runId`.
- `tickets` (array of integers, optional): explicit issue numbers. When given, the scout
  takes exactly those tickets regardless of label or state; otherwise it lists open tickets
  with `args.label`.
- `label` (string, default `ready-for-agent`): label the scout lists when `tickets` is empty.
- `maxTickets` (integer, default 3): wave cap; keeps the run near the 15-agent guideline.
- `scoutModel` / `implModel` / `verifyModel` / `deliverModel` / `reportModel`: per-stage
  model pins. Defaults: Sonnet 5 for scout and verify, Opus 5 for implement, Haiku 4.5
  for deliver and report.
- `maxAttempts` (integer, default 3): Ralph-style bounded retry, fresh context each attempt.
- `deliver` (boolean, default true): `false` stops after verify - no push, no PR, no
  resolution comment.
- `followupsFile` (string, default `FOLLOW-UPS.md`): the file the report writer appends to.
- `instrument` (`auto` | `gh` | `mcp`, default `auto`): tracker instrument. `auto` returns
  `mcp` when `CLAUDE_CODE_REMOTE_SESSION_ID` or `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE` is set;
  otherwise `gh`. Pass `mcp` explicitly on a machine where `gh` is missing.

## Contract and ripple list

The launch contract is versioned. `tools/ticket-fleet-contract.js` in `claude-dotfiles` holds it as
data (version, required args, the SCOUT fields, this ripple list); the script inlines the same
version behind a `[FLEET-CONTRACT-VERSION N]` marker, and `tools/ticket-fleet-contract.test.js`
fails the branch when the two, or this table, disagree.

**contract v2** - args `{contractVersion, runId, invocationId}`; SCOUT returns
`{candidateNumbers, tickets, repoMap, testCommand, defaultBranch}`, each ticket carrying
`{number, title, criteria, blockedBy, keepOpen, kind, kindReason, discoveryTriage}`.
(v1 was `runId` alone, with no `candidateNumbers` and no `discoveryTriage`.)

Copies this repo does not rebuild, all of which move when the contract does:

| Where | What | Keeps its own edits |
| --- | --- | --- |
| `surreptakos/aac-routines` | `.claude/workflows/ticket-fleet.js` | Setup phase (sub-session auth, issue 83) and the no-cleanup history |
| `surreptakos/aac-cockpit` | `.claude/workflows/ticket-fleet.js` | `PROMPT_CONTRACT` |
| `claude-dotfiles` | `orchestrator/RUNBOOK.md` | launch args |
| `claude-dotfiles` | `orchestrator/LOCAL-RUNBOOK.md` | launch args |
| `claude-dotfiles` | `aac-skills/ticket-fleet/SKILL.md` | this page |
| `claude-dotfiles` | `agents/skills/project-harness/SKILL.md` | step 15, the harness's own launch instruction |

Changing the arg list or the SCOUT schema means, in one commit: bump `CONTRACT_VERSION` in
`tools/ticket-fleet-contract.js` and the marker in the script, update this table and the args list
above, then refresh each fork - re-copy the plugin script over it and re-apply that fork's edits.
To see which forks are behind before a run does:

```bash
node tools/ticket-fleet-contract.js ../aac-routines/.claude/workflows/ticket-fleet.js
```

It prints each copy's contract version against the plugin's and exits 1 when any is stale; a copy
with no marker at all is a pre-v2 fork.

## Lanes

The scout classifies each ticket into one of three lanes; the wave runs them in parallel:

- **code** - repository change. Implementer in an isolated worktree, then a blind refuting
  verifier per attempt; the deliver stage pushes and opens a PR only on a verified pass.
- **probe** - resolves by quoting command output / research / evidence in a comment, no
  repository change asked for. Prober gathers, blind verifier re-runs the commands; the
  deliver stage posts one resolution comment.
- **human** - labelled `ready-for-human` or `ready-for-local-agent`, or the body says a
  person or a desktop session performs the steps. The agent verifies only what the
  container can do and hands the rest back in one comment under a **Remaining for a local
  session** heading; the delivery moves the label to `ready-for-local-agent` unless the
  remaining steps are genuinely a person's judgment, credential or sign-off, in which
  case the label is `ready-for-human`. It never claims an owner step was done.

## Branch names

`agent/issue-<N>-attempt<A>-wf_<runId>-w<workerN>` (see the block comment at the top of the
script and the drift guards in `tools/ticket-fleet-branch.test.js`). Two concurrent scouts
against the same ticket therefore produce distinct branches; two runs of the same worker
still add `-attempt<A>` so a re-implement after a failed verify does not overwrite its own
predecessor.

## History

Before v18 of the `project-harness` skill (2026-09-14) the fleet lived in three drifted
copies: `.claude/workflows/ticket-fleet.js` in `claude-dotfiles`, `orchestrator/ticket-fleet-cloud.js`
alongside it (the cloud port), and `agents/skills/project-harness/templates/ticket-fleet.js`
(the copy the harness installed into every other repo). Each copy carried one of `runId`
from args, `defaultBranch`, `keepOpen`, or the MCP/gh instrument branch and none carried
all four. The harness upgrade table's v18 row records the consolidation.
