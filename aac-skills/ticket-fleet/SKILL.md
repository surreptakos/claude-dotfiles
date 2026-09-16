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
  modified: "2026-09-16T15:05:04Z"
  previous-modified: "2026-09-15T22:39:49Z"
  revision: "9"
  content-sha: "b08132967ec6"
---

# ticket-fleet

One script, `ticket-fleet.js` alongside this SKILL.md, that serves every session shape:

- **Local session** (has `gh`): the fleet talks to the tracker through `gh api repos/{owner}/{repo}/...` REST paths (GraphQL-backed `gh` subcommands 403 through the cloud proxy, so REST only - issue 130).
- **Cloud container** (`CLAUDE_CODE_REMOTE_SESSION_ID` set, or no `gh` on PATH): the fleet talks to the tracker through the GitHub MCP tools (`mcp__github__list_issues`, `mcp__github__issue_read`, `mcp__github__add_issue_comment`, `mcp__github__create_pull_request`).

The switch is made by `pickInstrument(env, hasGh, override)` inside the script, and the
verifier's agent type by `resolveVerifierAgent(instrument, args.verifierAgent)`; the pure
counterparts live at `tools/ticket-fleet-branch.js` in `claude-dotfiles`, exercised by
`tools/ticket-fleet-branch.test.js`.

The script does not guess which shape it is in. The first agent of every run is a cheap
`env-probe` that reads the remote env vars, `gh` on PATH and the verifier agent file, and the
switch resolves from what it reports - the workflow runtime does not reliably expose
`process.env` (issue 322), and a cloud caller who has to remember `instrument: 'mcp'` is a
workaround, not a switch (issue 339). Pass `instrument` only to override the measurement.

## Custom agent types are desktop-only

**Pinning a dotfiles-defined `agentType` does not work in a cloud session.** Claude Code reads
the agent registry before `SessionStart` hooks run, so the cloud bootstrap hook cannot install
`claude/agents/` in time for the session that would use it; the launch fails with
`Agent type '<name>' not found`, an error that names the type and not the cause. Measured in a
container on 2026-09-16 - control, hook-write and second-session arms - in issue 339; the
transcript is at `docs/tickets/339-decision.md` in `claude-dotfiles`.

The fleet therefore pins its `fleet-verifier` subagent (`~/.claude/agents/fleet-verifier.md`,
issue 86) only on a desktop session that has the file on disk; `pickVerifierAgent(remote,
agentFilePresent)` makes that call from the env probe's facts. In a cloud session the verifier
runs unpinned and its restraint is the container sandbox plus the detached scratch worktree. No
plugin-served script may pin a dotfiles-defined `agentType`.

## How to invoke

Call the Workflow tool with `scriptPath` set to a copy of the script the current working
directory can reach; the Workflow tool also resolves a bare `name:` from the cwd's
`.claude/workflows/`. It reads the file behind `scriptPath` byte-for-byte before showing the
approval dialog - a CR anywhere in the payload trips "script contains control characters that
would be hidden in the approval dialog" and the launch is refused (issue 233 - and this repo
pins `* -text`, so a CRLF blob reaches every surface verbatim). `args.runId` and
`args.invocationId` are both required (the workflow runtime forbids `Date.now()` and
`Math.random()` inside scripts, so the caller mints them).

**In a `claude-dotfiles` checkout, name the checkout copy - do not copy anything.** The
source file is already in the tree, so point `scriptPath` straight at it (verified from a
cloud session in this repo, run `6aa99cb8`):

```
Workflow({
  scriptPath: 'aac-skills/ticket-fleet/ticket-fleet.js',
  args: { runId: '<hex from `printf %x $(date +%s)`>', tickets: [], deliver: false }
})
```

The reason is a test: `tools/ticket-fleet-branch.test.js` asserts `.claude/workflows/ticket-fleet.js`
does not exist ("superseded by aac-skills/ticket-fleet/ticket-fleet.js in issue 138 and must
not come back"), so copying the script into `.claude/workflows/` here turns the repo's own
gate red - seen twice on 2026-09-15, and the reason for issue 299. `name: 'ticket-fleet'`
does not resolve in this repo either, for the same missing-copy reason.

**Second desktop spelling: the installed plugin's own copy.** On the desktop the cache file
is launchable from any cwd, including inside `claude-dotfiles` (verified, run `wf_61834c04-e11`):

```
Workflow({
  scriptPath: 'C:\\Users\\<you>\\.claude\\plugins\\cache\\claude-dotfiles\\aac-skills\\<version>\\skills\\ticket-fleet\\ticket-fleet.js',
  args: { runId: '<hex>', tickets: [], deliver: false }
})
```

The cache path shape is `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/ticket-fleet/ticket-fleet.js`
- marketplace `claude-dotfiles`, plugin `aac-skills`, `<version>` the `2026.9.<ddhhmm>` stamp in
`marketplace/aac-skills/.claude-plugin/plugin.json`. Inside a session that has the plugin
loaded, `${CLAUDE_PLUGIN_ROOT}` expands to that `<version>` directory. Prerequisite: refresh
the cache first -

```bash
claude plugin marketplace update claude-dotfiles && claude plugin update aac-skills
```

A cache older than the relayout that gave the fleet its own skill folder has no
`skills/ticket-fleet/` at all, and the launch fails on a missing file rather than on anything
the fleet did.

**Copy-into-cwd step (every repo except `claude-dotfiles`).** Elsewhere the plugin path holds
the source of truth but the repo has no copy of it, and both a bare `name:` and a
checkout-relative `scriptPath` need the script under `.claude/workflows/` in the current
working directory. Copy it there before the first invocation:

```bash
mkdir -p .claude/workflows
cp "${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js" .claude/workflows/ticket-fleet.js
```

Then either spelling launches the fleet:

```
Workflow({
  scriptPath: '.claude/workflows/ticket-fleet.js',
  args: { runId: '<hex>', invocationId: '<fresh hex>', tickets: [], deliver: false }
})
```

```
Workflow({
  name: 'ticket-fleet',
  args: { runId: '<hex>', invocationId: '<fresh hex>', tickets: [], deliver: false }
})
```

On a fork (aac-routines' auth/cleanup phases, aac-cockpit's `PROMPT_CONTRACT`) the copy is
edited in place; on every other repo the copy stays a byte-identical mirror of the plugin
source and is refreshed by re-running the `cp` above whenever the plugin bumps.

On a repo's first run, always pass `deliver: false` - verify the Scout, lane and verifier
prompts before letting the fleet push branches and open PRs. Full args list:

- `runId` (required, string): caller-minted unique token. Any short unique string; the
  branch names embed it as `wf_<runId>-w<workerIndex>`. A resume (`resumeFromRunId`) passes
  the SAME `runId`, so the resumed attempts land on the branches they already own.
- `invocationId` (required, string): a second caller-minted token, re-minted on EVERY launch
  including every resume, and rejected if it equals `runId`. It is spliced into the open-PR
  guard's prompt and label and nowhere else. The guard asks an agent whether this ticket
  already has an open PR, and the runtime replays cached agent answers on resume; without a
  key that moves per invocation the guard replays the `{found:false}` it recorded before any
  PR existed and the ticket is implemented, verified and delivered twice (issue 291). Mint
  both with `printf %x%x $(date +%s) $$`.
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
- `instrument` (`auto` | `gh` | `mcp`, default `auto`): tracker instrument. `auto` measures
  the session with the `env-probe` agent and returns `mcp` when
  `CLAUDE_CODE_REMOTE_SESSION_ID` or `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE` is set or `gh` is
  missing, `gh` otherwise. A cloud session needs no argument. Pass a value only to override
  the measurement; on `auto`, a probe that returns nothing stops the run rather than guessing.
- `generatedPaths` (array of globs, default `['.claude-plugin/marketplace.json', 'marketplace/**']`):
  the paths the pre-push merge may resolve by taking the default branch's side.
- `regenCommands` (array of shell commands, default `null`): what re-stamps and rebuilds those
  paths after such a merge. `null` tells the deliver stage to read the commands out of CLAUDE.md.
- `verifierAgent` (string, default `null`): the agent type the blind verifier launches under.
  `null` takes the default the env probe decides - `fleet-verifier` on a desktop session whose
  `~/.claude/agents/fleet-verifier.md` is on disk, unpinned in a cloud session (custom agent
  types are desktop-only, see above). `''` forces unpinned; any other string pins that agent.
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
  verifier per attempt; the deliver stage merges the default branch (see **Pre-push merge**),
  then pushes and opens a PR, only on a verified pass.
- **probe** - resolves by quoting command output / research / evidence in a comment, no
  repository change asked for. Prober gathers, blind verifier re-runs the commands; the
  deliver stage posts one resolution comment.
- **human** - labelled `ready-for-human` or `ready-for-local-agent`, or the body says a
  person or a desktop session performs the steps. The agent verifies only what the
  container can do and hands the rest back in one comment under a **Remaining for a local
  session** heading; the delivery moves the label to `ready-for-local-agent` unless the
  remaining steps are genuinely a person's judgment, credential or sign-off, in which
  case the label is `ready-for-human`. It never claims an owner step was done.

The scout also sets `handoffPending` per ticket: true when the ticket's latest comment is a
fleet handoff (a "Remaining for a local session" or "Remaining for a person" section and the
Claude Code footer) with no owner comment after it. Such a ticket is parked, not run - no lane
starts for it and nothing is posted - and the run result names it under `skippedAwaitingOwner`.
Together with the relabel that is what stops a second wave repeating a handoff nobody has
answered yet (issue 266).

## Discovery-triage chores run in a chain, not side by side

The scout also sets `discoveryTriage` per ticket: true when the ticket asks for a list of findings
(`FOLLOW-UPS.md` discoveries, a fleet run's follow-ups, a review list) to be turned into tracker
items. Those chores write to the tracker rather than to the repository, so two of them running side
by side cannot see each other's tickets: in run `wf_37f38305-f2e`, #261 and #264 filed the same
`tools/tracker-audit.js` short-fetch as #285 and #281 two minutes apart (issue 319). The wave puts
every such chore in one lane and runs them one after the other, so the second reads a tracker the
first has already added to; everything else still runs in parallel. Each chore's implementer or
prober brief also carries a dedupe rail - search the open issues for the same file, symbol or
failure immediately before filing, and comment on a match instead of creating a second ticket -
which covers a wave that holds only one chore. A caller that would rather not rely on either can
put the chores in separate waves.

## Pre-push merge

A wave's branches all fork from the same commit. By the time the last one is verified the
default branch has moved, and every branch that touched a skill carries a rotated stamp block
and a rebuilt marketplace payload — so the PRs open conflicted and the session hand-resolves
the same conflict once per PR (run `wf_37f38305-f2e`, PRs #304-#314).

So the deliver stage merges `origin/<defaultBranch>` into the verified branch **before** it
pushes. A clean merge pushes as before. A conflicting merge has exactly two resolvable classes:

- **Generated files** — a path matching `generatedPaths` (`.claude-plugin/marketplace.json`,
  `marketplace/**`). Resolved with `git checkout --theirs`: the default branch's copy is what
  is already published, and the packager rewrites it in the next step anyway.
- **A `SKILL.md` metadata stamp block** — a conflict confined to the four keys `modified`,
  `previous-modified`, `revision`, `content-sha`. Resolved by
  `node tools/resolve-stamp-conflict.js <path>`, never by eye and never by taking the default
  branch's whole file: PR #306 did that and dropped the branch's edits to the skill's prose.
  The resolver rewrites only hunks whose every line is one of the four keys and exits non-zero
  on any other hunk, which reclassifies that file as a real merge.

After resolving, the stage re-runs the repo's stamp-and-rebuild commands (`regenCommands`, or
the ones CLAUDE.md names), re-runs the test command, and commits the merge; the PR body says
which paths the merge resolved.

**Anything else is a real merge and stops delivery for that ticket.** The stage aborts the
merge, pushes nothing and opens no PR; the ticket appears in the run result's `failed` list
with `conflictPaths` naming every path still in conflict. A test command that fails after an
otherwise-resolved merge blocks the same way. Re-run the fleet on that ticket, or merge the
branch by hand.

## Branch names

`agent/issue-<N>-attempt<A>-wf_<runId>-w<workerN>` (see the block comment at the top of the
script and the drift guards in `tools/ticket-fleet-branch.test.js`). Two concurrent scouts
against the same ticket therefore produce distinct branches; two runs of the same worker
still add `-attempt<A>` so a re-implement after a failed verify does not overwrite its own
predecessor.

## Shell shapes the worktree guard refuses

An implementer or verifier works inside an isolated worktree, and there the Bash tool refuses any
command whose text it cannot prove is not git: "... inside a construct too complex to verify, so
what it runs cannot be shown not to be git. Refusing to run it". Each refusal costs a turn, so
reach for the working spelling first. Observed in the waves 4/5 triage (issue 358) and again in
waves 6/7 (issue 373):

| Refused shape | Working spelling |
| --- | --- |
| `for n in 12 34; do gh api repos/O/R/issues/$n; done` - a loop calling `gh` with a loop variable | one plain command per item, each number written out |
| `gh api '…/issues?page=1'; gh api '…/issues?page=2'` - two calls joined with `;`, URL text interpolated | one command per page, each its own Bash call |
| `cat > notes.md <<'EOF' … EOF` - a heredoc writing a scratch file | the Write tool |
| `tail -c 60 file \| od -c` - a pipeline for byte-level work | `python3 -c "print(open('file','rb').read()[-60:])"` |

One rule covers all four: one plain command, no loop body, no `;`-joined pair, no heredoc, no
pipeline - nothing the guard has to evaluate before it can see what actually runs. The guard is
strictest around text that could reach `git` or `gh`, and it is the shape that is refused, not the
command, so re-running the same work as separate single commands goes through.

## History

Before v18 of the `project-harness` skill (2026-09-14) the fleet lived in three drifted
copies: `.claude/workflows/ticket-fleet.js` in `claude-dotfiles`, `orchestrator/ticket-fleet-cloud.js`
alongside it (the cloud port), and `agents/skills/project-harness/templates/ticket-fleet.js`
(the copy the harness installed into every other repo). Each copy carried one of `runId`
from args, `defaultBranch`, `keepOpen`, or the MCP/gh instrument branch and none carried
all four. The harness upgrade table's v18 row records the consolidation.
