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
  modified: "2026-09-16T00:29:06Z"
  previous-modified: "2026-09-15T22:39:49Z"
  revision: "9"
  content-sha: "3abb1b2322e1"
---

# ticket-fleet

One script, `ticket-fleet.js` alongside this SKILL.md, that serves every session shape:

- **Local session** (has `gh`): the fleet talks to the tracker through `gh api repos/{owner}/{repo}/...` REST paths (GraphQL-backed `gh` subcommands 403 through the cloud proxy, so REST only - issue 130).
- **Cloud container** (`CLAUDE_CODE_REMOTE_SESSION_ID` set, or no `gh` on PATH): the fleet talks to the tracker through the GitHub MCP tools (`mcp__github__list_issues`, `mcp__github__issue_read`, `mcp__github__add_issue_comment`, `mcp__github__create_pull_request`).

The switch is made by `pickInstrument(env, hasGh, override)` inside the script; the pure
counterpart lives at `tools/ticket-fleet-branch.js` in `claude-dotfiles`, exercised by
`tools/ticket-fleet-branch.test.js`.

## How to invoke

Call the Workflow tool with `scriptPath`. The tool reads the file behind `scriptPath`
byte-for-byte before showing the approval dialog, and it refuses the launch on two grounds:

- **A path it does not own.** Quoted verbatim from the first real-container run of the cloud
  bootstrap - a claude.ai/code session on this repo, container booted 2026-09-15T18:52Z on
  master `84c0764`, posted to issue #163 in the comment of 2026-09-15T18:59:52Z:

  > `Workflow({scriptPath: '${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js'})` is
  > refused in the container: the tool only accepts a path under the working directory or one
  > it returned. The identical copy at `aac-skills/ticket-fleet/ticket-fleet.js` in the
  > checkout launches.

- **A CR byte anywhere in the payload** - "script contains control characters that would be
  hidden in the approval dialog" (issue 233; this repo pins `* -text`, so a CRLF blob reaches
  every surface verbatim).

`args.runId` is required: the workflow runtime forbids `Date.now()` and `Math.random()` inside
scripts, so the caller mints the id.

**From a session rooted in a `claude-dotfiles` checkout** - the spelling the container above
recorded launching:

```
Workflow({
  scriptPath: 'aac-skills/ticket-fleet/ticket-fleet.js',
  args: { runId: '<hex from `printf %x $(date +%s)`>', tickets: [], deliver: false }
})
```

**From a session rooted on any other repo.** The quoted rule decides it: the path must sit
under that session's working directory, and no other repo has this one's `aac-skills/` tree
there. Put a shallow clone under the checkout and use the same relative path inside it - the
path shape the rule accepts, differing from the spelling above only by the clone directory:

```bash
git clone --depth 1 https://github.com/surreptakos/claude-dotfiles .aac-dotfiles
```

```
Workflow({
  scriptPath: '.aac-dotfiles/aac-skills/ticket-fleet/ticket-fleet.js',
  args: { runId: '<hex>', tickets: [], deliver: false }
})
```

Leave the clone uncommitted (`.aac-dotfiles/` in the repo's `.gitignore` or in
`.git/info/exclude`) and refresh it with a pull when the fleet bumps. The fleet itself stays
cwd-relative whatever holds the script - the scout's `gh api` calls, the implementer's
`isolation: 'worktree'` and the verifier's `git worktree add` all resolve against the session's
own repo, not against the clone.

`${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js` is a desktop-session alternative
only, and only where it works there; a container refuses it, as quoted above. The same goes for
a bare `name: 'ticket-fleet'`, which the Workflow tool resolves from the cwd's
`.claude/workflows/` and which serves the permission handler's session-start snapshot rather
than the file on disk.

## Never resume a run

**Never pass `resumeFromRunId` for a fleet run - not to retry a failed ticket, not to finish a
run that was interrupted.** A resume does not replay cached verdicts. On 2026-09-15 a completed
run was resumed that way: it re-ran the implementers and verifiers over the branches the first
run had already built, reached a different verdict on an attempt the first run had failed, and
delivered it as `surreptakos/claude-dotfiles#252` - a duplicate PR against a ticket that was
already closed by the merged `surreptakos/claude-dotfiles#246`.

Re-run instead: a fresh run, a new `runId`, and the failed tickets listed explicitly.

```
Workflow({
  scriptPath: 'aac-skills/ticket-fleet/ticket-fleet.js',
  args: { runId: '<new hex>', tickets: [241], deliver: true }
})
```

That is safe because the code lane opens with a pre-loop open-PR check: a ticket that already
carries an open `agent/issue-<N>-*` PR short-circuits to that PR instead of being implemented
again. It is the only resume the fleet supports.

## Args

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
