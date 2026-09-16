---
name: ticket-fleet
description: 'Parallel ticket runner: scout, pinned implementer per ticket, blind refuting verifier, PR on pass, discovery collection. Drives open ready-for-agent tickets to verified PRs in parallel; also runs probe tickets (evidence in a comment) and ready-for-human tickets (verify what a container can, hand the rest to the owner). One script served by this plugin, invoked via the Workflow tool with `scriptPath` from local and cloud sessions alike; the script picks between the `gh` CLI and the GitHub MCP tools at run time. Use when the user asks to run the ticket fleet, clear a wave of `ready-for-agent` tickets, or invoke the fleet from an orchestrator worker cycle.

  '
metadata:
  modified: '2026-09-16T03:31:10Z'
  previous-modified: '2026-09-15T22:39:49Z'
  revision: '9'
  content-sha: 8bd675786532
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
`* -text`, so a CRLF blob reaches every surface verbatim). `args.runId` is required (the
workflow runtime forbids `Date.now()` and `Math.random()` inside scripts, so the caller
mints the id).

**Checkout-path invocation (works on desktop and in cloud sessions).** Once
`.claude/workflows/ticket-fleet.js` exists in the cwd, either spelling launches the fleet:

```
Workflow({
  scriptPath: '.claude/workflows/ticket-fleet.js',
  args: { runId: '<hex from `printf %x $(date +%s)`>', tickets: [], deliver: false }
})
```

```
Workflow({
  name: 'ticket-fleet',
  args: { runId: '<hex>', tickets: [], deliver: false }
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

- `runId` (required, string): caller-minted unique token. Any short unique string; the
  branch names embed it as `wf_<runId>-w<workerIndex>`.
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
- `testCommand` (string, optional): replaces the gate the scout read, for every lane, logged
  once. See **Overriding the test command** below.
- `priorImpl` / `priorProbe` (objects keyed by ticket number, optional): results from an
  earlier run's implementers and probers. See **Finishing a run whose verifiers died** below.

## Overriding the test command

The scout reports the gate the repo documents, and that gate can be one the fleet's container
cannot run. In `claude-dotfiles` the documented gate is the PowerShell restore test
(`powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1`), which no Linux container
has a shell for: every implementer reports exit 127 and every verifier refutes on its first
step. Pass the Linux half of CI instead:

```
testCommand: "node --test tools/*.test.js tests/*.test.js && python3 tools/skill-stamps.test.py && python3 tests/build-cloud-plugin.test.py && python3 tools/skill-stamps.py check aac-skills --home 'C:\\Users\\Dan'"
```

The override reaches both the implementer's done-condition and the verifier's step 1, so the
two stages never disagree about which gate counts. The run logs
`testCommand overridden by args: ...` once, next to the scout's own value.

## Finishing a run whose verifiers died

A run can lose every verifier after its implementers have already committed their branches.
The runtime's own resume does not recover that: the cache key of an `isolation: 'worktree'`
agent includes the worktree slot the runtime assigned, and a resumed run assigns new slots, so
the replay starts a fresh implementer inside another ticket's slot. Hand the finished results
back instead:

- `priorImpl`: `{<ticket number>: <IMPL-shaped result>}` - `{branch, committed, testExitCode,
  testTail, discoveries}`.
- `priorProbe`: `{<ticket number>: <PROBE-shaped result>}` - `{items, blocked, discoveries}`.

A ticket with an entry skips its **attempt-1** implementer or prober entirely - the recorded
result is used as-is and the reuse is logged (`reusing prior implementer result from
args.priorImpl (branch ...)`). Everything downstream is unchanged: the verifier still runs
blind against the branch, and attempt 2+ re-implements or re-probes normally, so a reused
branch the verifier refutes is retried exactly as a fresh one would be. The pre-loop open-PR
check still runs first, so a ticket already delivered is skipped before the entry is read.

The values come from the dead run's `journal.jsonl`, which carries one `result` line per
agent label - `impl:#<N>.1` for the code lane, `probe:#<N>.1` for the probe lane. Take the
attempt-1 line per ticket, key it by the ticket number in the label, and pass the structured
result as the value:

```json
{
  "priorImpl": {
    "274": { "branch": "agent/issue-274-attempt1-wf_dd0cf9a4091-w0", "committed": true,
             "testExitCode": 0, "testTail": "# pass 31\n# fail 0", "discoveries": [] }
  }
}
```

Pass the same `tickets` list as the dead run, a **new** `runId` (branch names for any ticket
that does re-implement must not collide with the dead run's), and the `testCommand` the dead
run should have used. An entry whose `committed` is false, or a probe entry with no items, is
treated as a failed attempt 1: attempt 2 runs the stage normally.

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
