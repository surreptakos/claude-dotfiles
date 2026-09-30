---
name: ticket-fleet
description: >
  Run a ticket-fleet wave over the ready-for-agent queue. Use when the user asks to run the
  ticket fleet or clear a wave of tickets, or an orchestrator worker cycle launches the fleet.
metadata:
  modified: "2026-09-30T19:34:32Z"
  previous-modified: "2026-09-30T18:24:28Z"
  revision: "64"
  content-sha: "e8493d2beaf5"
---

# ticket-fleet

One Workflow script, `ticket-fleet.js` beside this file, runs a **wave**: a scout picks the
tickets, each ticket gets an implementer in an isolated worktree, a blind verifier that tries to
refute it, and a deliverer that opens the PR and merges it once CI is green. One report writer
files the wave's discoveries. The orchestrating session only launches the wave and reads its
result; every ticket is worked by subagents.

**One fleet at a time (Dan, 2026-09-26).** Wait for a running wave's result before launching
another in the same repo.

**A desktop session runs the `ready-for-local-agent` tickets itself (Dan, 2026-09-30).** The wave
serves one repo and skips a ticket labelled for a local agent, or one that changes another repo.
When this session is on the desktop that ticket names, it is that local agent: start each one
as a background agent in the right clone, in parallel with the wave, and never leave it out
because the fleet cannot take it. Run 6abd47d1 left #1069 out this way while its dependant #1072
waited on it.

## Launch a wave

1. **Pick the `scriptPath`** the current working directory can reach:
   - In a `claude-dotfiles` checkout: `aac-skills/ticket-fleet/ticket-fleet.js`, launched in
     place (a test forbids a `.claude/workflows/` copy here, issue 299).
   - On the desktop, from any cwd: the plugin cache copy,
     `~/.claude/plugins/cache/claude-dotfiles/aac-skills/<version>/skills/ticket-fleet/ticket-fleet.js`
     (`${CLAUDE_PLUGIN_ROOT}` is that `<version>` directory); the marketplace auto-updates at
     session start, so the newest `<version>` is the one to launch.
   - In any other repo: copy the script and its guard into the cwd once, then launch
     `.claude/workflows/ticket-fleet.js` (or `name: 'ticket-fleet'`):

     ```bash
     mkdir -p .claude/workflows
     cp "${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/ticket-fleet.js" .claude/workflows/ticket-fleet.js
     cp "${CLAUDE_PLUGIN_ROOT}/skills/ticket-fleet/editable-install-guard.js" .claude/workflows/editable-install-guard.js
     ```

     Each wave refreshes that copy itself ([INTERNALS.md](INTERNALS.md), "A copied script
     refreshes itself").

   From a cloud session, the session root must be the repo checkout. A resumed session can come
   back rooted at `/home/user`, beside the clones; every worktree agent then fails with `Cannot
   create agent worktree: not in a git repository`, and a `cd` does not help. The
   `worktree-canary` agent stops the run before Scout with that cause; start a new session on the
   repo (issue 892).

   Done when the path resolves to a file whose bytes are LF only - the Workflow tool refuses a
   script holding a CR (issue 233) - and, in a cloud session, `git rev-parse --show-toplevel`
   run from the session root prints that root.

2. **Mint the ids.** `runId` names the run and stays the same across a resume
   (`printf %x $(date +%s)`); `invocationId` is fresh on every launch, resume included, and must
   differ from `runId` (`printf %x%x $(date +%s) $$`). The runtime forbids `Date.now()`, so the
   caller mints both. Done when both are hex tokens and they differ.

3. **Set the args** (full list below). Always `contractVersion: 2`, `runId`, `invocationId`. Add:
   - `instrument: 'mcp'` from a cloud session. The `gh` instrument is desktop-only; a run that
     cannot measure its environment stops rather than guess (issue 322).
   - `deliver: false` on a repo's first wave, to read the scout, lane and verifier output before
     the fleet pushes anything.
   - `testCommand` when the repo's documented gate cannot run where the wave runs. In
     `claude-dotfiles` from a Linux container (the PowerShell restore test has no shell there):

     ```
     testCommand: "node --test tools/*.test.js tests/*.test.js && python3 tools/skill-stamps.test.py && python3 tests/build-cloud-plugin.test.py && python3 tools/skill-stamps.py check aac-skills --home 'C:\\Users\\Dan'"
     ```

   - The stamps check in `claude-dotfiles`: `regenCheckCommands` defaults to `[]` (issue 814), so
     every launch here adds it, or a Deliver stage that regenerates a skill's stamp pushes it
     unchecked:

     ```
     regenCheckCommands: ["python3 tools/skill-stamps.py check aac-skills --home 'C:\\Users\\Dan'"]
     ```

   ```
   Workflow({
     scriptPath: '<from step 1>',
     args: { contractVersion: 2, runId: '<hex>', invocationId: '<fresh hex>', tickets: [], deliver: true }
   })
   ```

   Done when the args carry the three required keys and every bullet above that fits this
   session.

4. **Record the run.** When the workflow returns, run `node tools/fleet-run-record.js --latest` in
   the served repo from this session, not a subagent: the journal dies with the container. Where
   the repo gitignores `state/`, post the record's digest on the repo's tracking issue. Done when
   `state/fleet-runs/<runId>.json` exists, plus the posted digest where `state/` is ignored.

5. **Account for every ticket.** The run log has one line per ticket, `MERGED <sha>` or
   `open, not merged: <prState>`, and the result sorts every candidate into one row below:

   | Result key | Meaning | Next |
   | --- | --- | --- |
   | `delivered` | PR or comment posted; a `mergeNote` means the PR still owes a merge of the default branch | merge the default branch into it, then the PR |
   | `failed` | no verified pass, or delivery blocked; `conflictPaths` names a real merge conflict | read `failures`, re-run the ticket |
   | `inconsistent` | verified and pushed, but the deliverer could not find the branch | deliver it by hand or via `finishRunId` |
   | `skippedBlocked` | an open blocker outside the wave | waits for the blocker |
   | `skippedChained` | chained behind an in-wave blocker that did not merge | next wave |
   | `notAttempted` | never started: `halt` names the quota or rate limit that ended the run and its reset time | relaunch after the reset; bullets are in `discoveryList` |
   | `skippedOpenPR` / `skippedParked` / `skippedAwaitingOwner` | already has a PR / in Maybe Someday / waiting on the owner after a handoff | nothing |

   Done when every ticket the scout listed sits in one row above.

## Args

Required: `contractVersion` (integer, must equal the script's, 2 today), `runId`, `invocationId`.

- `tickets` (issue numbers): exactly those, any label or state. Empty: open tickets carrying
  `label` (default `ready-for-agent`).
- `deliver` (default true): `false` stops after verify - no push, no PR, no comment.
- `maxAttempts` (default 3): implement-verify rounds per ticket, fresh context each.
- `instrument` (`auto` | `gh` | `mcp`) and `remote` (boolean): the tracker route. `auto` is
  measured by the first agent; `remote` is read only when that measurement returns nothing.
- `testCommand`: replaces the gate the scout read, for implementer and verifier alike.
- `scoutModel` / `implModel` / `verifyModel` / `deliverModel` / `reportModel`: per-stage pins.
  `implPins` (`{mechanical, multi-file, design}`) and `difficulty` (default true) pick the
  implementer model from a TypeSafe Jev difficulty Score per ticket; retries take the `design` pin.
  A score under 0.8 confidence is ignored and the ticket runs on `implModel` (Opus 5.5); the two
  lighter pins default to Sonnet 5.5. Haiku never implements: any pin or arg naming it becomes
  Opus 5.5 (Dan, 2026-09-28).
- `effort` (default `'high'`): the effort every agent() call runs at, all stages alike (Dan,
  2026-09-28).
- `verifierAgent`: leave unset. The run pins `fleet-verifier` only on a desktop that has the file;
  a cloud session cannot load custom agent types (issue 339). `''` forces unpinned.
- `followupsFile` (default `FOLLOW-UPS.md`): where discoveries are appended.
- `generatedPaths`, `regenCommands`, `regenCheckCommands`: what the pre-push merge may resolve by
  regeneration, and how. `regenCheckCommands` defaults to `[]`; step 3 has `claude-dotfiles`'
  value (issue 814).
- `priorImpl` / `priorProbe`, `finishRunId`: recovery - see [RECOVERY.md](RECOVERY.md).
- `treeGuard`, `treeGuardScript`, `treeGuardStateDir`, `orchestratorCwd`, `editableGuard`,
  `editableGuardScript`: isolation guards, on by default where the repo ships them.

## What a wave does

**Selection.** No cap: every runnable candidate enters the wave. Blocker state is read from
the tracker, not believed from the ticket body: only a plain `closed` clears an edge. A ticket whose every open blocker is a code ticket in the same wave
joins it, chained on its blocker's lane: it starts after the blocker's PR merges, from
`origin/<defaultBranch>` (issue 854). Dropped before selection: tickets with an open
`agent/issue-<N>-` PR, and, in a label-driven wave, tickets in the Maybe Someday milestone.
A ticket whose latest comment is an unanswered fleet handoff is parked.

**Lanes.** The scout gives each ticket a kind:
- **code** - implementer (pushes its branch on commit), blind refuting verifier per attempt, then
  deliver: merge `origin/<defaultBranch>` into the branch, push, open the PR, wait up to 20
  minutes for CI, squash-merge on a green head with no changes-requested review.
- **probe** - evidence in a comment, no repository change. Prober gathers, verifier re-runs the
  commands, deliverer posts one resolution comment.
- **human** - the container verifies what it can and hands the rest back under a **Remaining for
  a local session** heading, relabelling to `ready-for-local-agent`, or `ready-for-human` for a
  person's judgment, credential or sign-off. It never claims an owner step was done.

Discovery-triage chores share one lane so two cannot file the same finding.

**Delivery stops** on a merge conflict outside the four resolvable classes (generated files,
`SKILL.md` stamp blocks, harness upgrade rows, append-append hunks), a failing gate after the merge, red CI, or a
changes-requested review. A `git merge` the classifier refuses twice still delivers, with the
refusal noted on the PR.

**Discoveries** land on their own branch and PR, `agent/fleet-discoveries-wf_<runId>`, never on
the session's branch; the result's `discoveryReport` names branch, sha and PR.

## Go deeper

- A wave died before delivering, or its verifiers died: [RECOVERY.md](RECOVERY.md).
- A worker, or this session, hit a refused command: [REFUSED-SHAPES.md](REFUSED-SHAPES.md) -
  worktree guard, auto-mode classifier, GitHub proxy.
- Changing the script, its args or its schema; or why a rule above exists:
  [INTERNALS.md](INTERNALS.md). A contract change moves every copy in its ripple table in one
  commit.
