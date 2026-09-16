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
  modified: "2026-09-16T19:07:35Z"
  previous-modified: "2026-09-16T18:01:25Z"
  revision: "13"
  content-sha: "5605bb4772fe"
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
pins `* -text`, so a CRLF blob reaches every surface verbatim). Three args are required and
they are the contract: `contractVersion`, `runId` and `invocationId` (the workflow runtime
forbids `Date.now()` and `Math.random()` inside scripts, so the caller mints both ids). A launch
that omits any of them fails with a contract-mismatch error naming the version on both sides and
the ripple list - see **Contract and ripple list** below.

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
- `followupsFile` (string, default `FOLLOW-UPS.md`): the file the report writer appends to. See
  Discoveries below for where that file is written.
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
- `finishRunId` (string, optional): an earlier run's id. The launch then runs **delivery only** -
  it reads that run's journal and opens a PR for every verified-but-undelivered branch. See
  **Finishing a run whose Deliver step died** below.

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

- `priorImpl`: `{<ticket number>: <IMPL-shaped result>}` - `{branch, committed, pushed,
  testExitCode, testTail, discoveries}`. An entry from a journal written before `pushed` existed
  simply reads as not-pushed, and the run pushes that branch itself before verifying it.
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

## Finishing a run whose Deliver step died

The other half of the same problem (issue 405). A verified branch used to exist nowhere but the
container that made it: the Deliver step was the first thing to push it, so a container restart
mid-Deliver, a deliverer that reported the branch "does not exist" without ever pushing, or an
interrupt during Verify each ended with committed, verified work nobody could reach. Two things
close that:

- **The branch is pushed at implement time.** The implementer runs `git push -u origin <branch>`
  as soon as the commit lands and reports `pushed`; when it did not (or could not), the run
  starts a one-command `push:#<N>.<attempt>` agent of its own - before the verifier, so the
  branch is on origin for every stage after it. The Deliver step still pushes, and is told to
  fail loudly with the git output rather than conclude the branch is missing.
- **`finishRunId` replays a dead run's journal.** The launch runs delivery only:

```
Workflow({
  scriptPath: 'aac-skills/ticket-fleet/ticket-fleet.js',
  args: { contractVersion: 2, runId: '<hex>', invocationId: '<fresh hex>', finishRunId: 'wf_6aaacc32-c84' }
})
```

`finishRunId` takes either spelling of the dead run's id: the harness workflow id its journal
directory is named for (`wf_...`), or the caller-minted `runId` its branch names embed. A
`journal-read` agent finds `~/.claude/projects/<project>/<session>/subagents/workflows/<run>/journal.jsonl`,
pairs each `started` label with its `result` by `agentId`, and reports per ticket whether a
verifier passed, on which branch, and whether a `deliver:#<N>` result recorded a PR or comment
URL. Then, per ticket: **delivered** ones are skipped naming the PR they already have,
**unverified** ones are left alone (a finish pass never delivers what no verifier passed - re-run
the fleet on those), and **verified-but-undelivered** ones go through the ordinary Deliver
prompt, with one extra instruction: reuse an open PR for that branch if one exists rather than
open a second, which makes a finish pass safe to repeat. Finally the report writer runs over the
journal's discoveries, so a dead run's follow-ups still land.

The run must happen where the dead run ran: the journal is machine-local and dies with its
container. It starts no scout, no implementer, no prober and no verifier, so a finish pass costs
one journal read plus one deliverer per undelivered branch.

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

- **code** - repository change. Implementer in an isolated worktree, which pushes its branch as
  soon as it commits (issue 405), then a blind refuting verifier per attempt; the deliver stage
  merges the default branch (see **Pre-push merge**), then pushes and opens a PR, only on a
  verified pass.
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

## Blocker state is read, not believed

The scout reports every number a ticket's "Blocked by" section names, whatever state it thinks
those issues are in. A `blocker-state` agent then reads each distinct number through the
instrument (`gh api repos/{owner}/{repo}/issues/N --jq .state`, or `mcp__github__issue_read`)
and the closed ones are dropped from that ticket's `blockedBy` and logged as cleared, so a
ticket whose blocker landed an hour ago runs without anyone editing its body. Anything that is
not a plain `closed` - `open`, `unknown`, a number the read never came back with, a failed
agent - keeps blocking: the gate opens only on positive evidence. The run result's
`skippedBlocked` names each skipped ticket with the blocker numbers still open (issue 403).

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

## Discoveries

Every lane returns out-of-scope findings. The Report phase is one writer, and it does not append
into the session's own checkout: it cuts `agent/fleet-discoveries-wf_<runId>` from
`origin/<defaultBranch>` in a scratch worktree, appends the bullets to `followupsFile` under a
`## Run (ticket-fleet <runId>)` heading, commits that file alone, and — when `deliver` is true —
pushes the branch and opens a discoveries-only PR against the default branch.

Before issue 360 the writer appended in place and committed nothing, so the bullets rode whatever
branch the session was on. Run `6aa9c56e` left 136 bullets on an unrelated PR's branch, and the
`6aa46942` / issue-120 block still on master cites four commits that were never landed — both
triage chores filed against those bullets found nothing on the default branch.

The run's return value carries `discoveryReport` (`{ branch, sha, prUrl, bullets }`), so a triage
chore filed for the bullets can name the commit sha and branch even before the PR merges. The
discoveries PR carries no verifier evidence because there is no ticket behind it; the orchestrator
merge pass has its own rule for it (`orchestrator/RUNBOOK.md`, Merge).

`tools/ticket-fleet-branch.test.js` pins the mechanism: the Report block is bracketed by
`[FLEET-REPORT-START]` / `[FLEET-REPORT-END]` markers and driven with a mocked `agent`.


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

## Where a verdict is allowed to come from

A verifier that skips its scratch worktree tests the orchestrator's own checkout, which sits on
whatever branch the session is on - on 2026-09-16 that tree predated the code under review and the
#361 probe was refuted as "fabricated" for flags `origin/main` carried and that branch did not. So
the `VERDICT` schema requires `worktree: {path, head}`, and the lane cross-checks the reported
`head` against the tip it expects: the branch under review in the code lane,
`origin/<defaultBranch>` in the probe lane, each read by its own one-command `rev-parse` agent so
no agent certifies itself. A mismatch re-runs the verifier ONCE with the mismatch named - "for
where it was produced and not for what it concluded", so the re-run is not read as pressure to
change its answer. A second mismatch is recorded as a failed attempt carrying only that mismatch,
and nothing is delivered on it. When the tip cannot be read at all the verdict stands and the run
log says the cross-check was skipped: a guess is not a rejection.

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

## Python packages: one editable install, shared by every worktree

A container has one interpreter and one site-packages, so `pip install -e` from a fleet worktree
repoints the whole container's editable install at that scratch checkout. Removing the worktree at
the end of the wave then orphans it, and every later `python -c 'import <pkg>'` dies with
ModuleNotFoundError while the code on disk is fine (issue 413: the 2026-09-16 aac-routines waves
left the pointer naming a deleted `/tmp/verify-306`, and three subprocess-spawning tests read as
broken code because of it).

Two halves:

- **Prevention.** The implementer, prober and verifier prompts share one rail (`PYTHON_RAIL` in
  the script): never `pip install -e` from a worktree, and never run a bootstrap or SessionStart
  script that does. The worktree's own code is what pytest reads; a test that *spawns* a
  subprocess gets it from `PYTHONPATH=<worktree>/src` in that command's environment.
- **Repair.** Once the wave has drained, the run executes `editable-install-guard.js check --main
  . --repair` (the file alongside this SKILL.md, exercised by
  `tools/editable-install-guard.test.js` in `claude-dotfiles`, which adds a worktree, repoints the
  pointer, deletes the worktree and shows the import break and come back). It rewrites a pointer
  naming a scratch checkout back to the main checkout - pointer text only, never pip, because
  `pip install -e` writes `.egg-info` into the orchestrator tree the isolation checkpoint just
  cleared. A repo with no `pyproject.toml` is a quiet no-op.

The guard is looked for at `tools/editable-install-guard.js` in the served repo first, then at
this repo's own `aac-skills/ticket-fleet/editable-install-guard.js`, then at
`~/.claude/skills/ticket-fleet/editable-install-guard.js`, where the cloud bootstrap copies this
skill (literal paths only - a `$VAR` in the command is refused as an operand computed at run
time). A served repo adopts the guard by copying it into its own `tools/`, or by passing the path
as `editableGuardScript`. Where none of them exists the run logs that it skipped the repair;
`editableGuard: true` makes that absence fail the run instead, and `editableGuard: false` turns
the guard off.

Prevention cannot cover a repo whose own hook installs before any prompt is read.
`aac-routines` `.claude/hooks/session-start.sh` cds to `CLAUDE_PROJECT_DIR` and runs
`python -m pip install --editable ".[dev]"` whenever its dependency check fails - and in a fleet
sub-session that directory IS the worktree (the same hook already rewrites `core.hooksPath` for
linked worktrees a few lines above, so it demonstrably fires there). Guarding that line to the
main checkout is an aac-routines change, recorded with the evidence in
`docs/tickets/413-decision.md`; until it lands, the post-wave repair is what undoes it.

## History

Before v18 of the `project-harness` skill (2026-09-14) the fleet lived in three drifted
copies: `.claude/workflows/ticket-fleet.js` in `claude-dotfiles`, `orchestrator/ticket-fleet-cloud.js`
alongside it (the cloud port), and `agents/skills/project-harness/templates/ticket-fleet.js`
(the copy the harness installed into every other repo). Each copy carried one of `runId`
from args, `defaultBranch`, `keepOpen`, or the MCP/gh instrument branch and none carried
all four. The harness upgrade table's v18 row records the consolidation.
