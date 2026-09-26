# ticket-fleet: internals

Reached from SKILL.md when changing the fleet script or its contract, or when a run result needs explaining past what SKILL.md says. Everything here is enforced by the script and pinned by `tools/ticket-fleet-branch.test.js` and its siblings; the prose says why.

## Where the code lives

The pure helpers - instrument switch (`pickInstrument`), verifier pin (`resolveVerifierAgent`,
`pickVerifierAgent`), wave selection (`selectWave`, `buildLanes`, `chainGate`) and the rest - are
written once, in `tools/ticket-fleet-branch.js`, and tested by `tools/ticket-fleet-branch.test.js`.
The Workflow runtime cannot `require()`, so `node tools/build-fleet-inline.js` copies them into the
script between `[FLEET-GENERATED-START]` / `[FLEET-GENERATED-END]`. Edit the module, run the
generator, commit both; `tools/fleet-inline-template.test.js` fails while the block is stale
(issue 440). The script's other marked blocks (`FLEET-CODE-LANE`, `FLEET-LANES`, `FLEET-REPORT`,
...) are extracted verbatim by the tests and driven with a mocked `agent`.

The first agent of every run, `env-probe`, reads the remote env vars, `gh` on PATH and the
verifier agent file; the instrument resolves from what it reports, because the runtime does not
reliably expose `process.env` (issue 322). With no measurement and no `instrument` or `remote`
arg, the run stops rather than fall back to `gh`: a cloud run on `gh` lost all twelve verifiers
to `agent type 'fleet-verifier' not found` on 2026-09-15.

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
| `surreptakos/aac-sales-cockpit` | `.claude/workflows/ticket-fleet.js` | `PROMPT_CONTRACT` |
| `claude-dotfiles` | `orchestrator/RUNBOOK.md` | launch args |
| `claude-dotfiles` | `orchestrator/LOCAL-RUNBOOK.md` | launch args |
| `claude-dotfiles` | `aac-skills/ticket-fleet/SKILL.md` | the args list and launch example |
| `claude-dotfiles` | `aac-skills/project-harness/SKILL.md` | step 15, the harness's own launch instruction |

Changing the arg list or the SCOUT schema means, in one commit: bump `CONTRACT_VERSION` in
`tools/ticket-fleet-contract.js` and the marker in the script, update this table and the args list
in SKILL.md, then refresh each fork - re-copy the plugin script over it and re-apply that fork's edits.
To see which forks are behind before a run does:

```bash
node tools/ticket-fleet-contract.js ../aac-routines/.claude/workflows/ticket-fleet.js
```

It prints each copy's contract version against the plugin's and exits 1 when any is stale; a copy
with no marker at all is a pre-v2 fork.

## Custom agent types are desktop-only

**Pinning a dotfiles-defined `agentType` does not work in a cloud session.** Claude Code reads
the agent registry before `SessionStart` hooks run, so the cloud bootstrap hook cannot install
`profile/claude/agents/` in time for the session that would use it; the launch fails with
`Agent type '<name>' not found`, an error that names the type and not the cause. Measured in a
container on 2026-09-16 - control, hook-write and second-session arms - in issue 339; the
transcript is at `docs/tickets/339-decision.md` in `claude-dotfiles`.

The fleet therefore pins its `fleet-verifier` subagent (`~/.claude/agents/fleet-verifier.md`,
issue 86) only on a desktop session that has the file on disk; `pickVerifierAgent(remote,
agentFilePresent)` makes that call from the env probe's facts. In a cloud session the verifier
runs unpinned and its restraint is the container sandbox plus the detached scratch worktree. No
plugin-served script may pin a dotfiles-defined `agentType`.

## Pre-push merge

A wave's branches all fork from the same commit. By the time the last one is verified the
default branch has moved, and every branch that touched a skill carries a rotated stamp block
and a rebuilt marketplace payload — so the PRs open conflicted and the session hand-resolves
the same conflict once per PR (run `wf_37f38305-f2e`, PRs #304-#314).

So the deliver stage merges `origin/<defaultBranch>` into the verified branch **before** it
pushes. A clean merge pushes as before. A conflicting merge has exactly three resolvable classes:

- **Generated files** — a path matching `generatedPaths` (`.claude-plugin/marketplace.json`,
  `marketplace/**`). Resolved with `git checkout --theirs`: the default branch's copy is what
  is already published, and the packager rewrites it in the next step anyway.
- **A `SKILL.md` metadata stamp block** — a conflict confined to the four keys `modified`,
  `previous-modified`, `revision`, `content-sha`. Resolved by
  `node tools/resolve-stamp-conflict.js <path>`, never by eye and never by taking the default
  branch's whole file: PR #306 did that and dropped the branch's edits to the skill's prose.
  The resolver rewrites only hunks whose every line is one of the four keys and exits non-zero
  on any other hunk, which reclassifies that file as a real merge.
- **A harness upgrade row** — `aac-skills/project-harness/UPGRADES.md`, where two tickets in
  one wave that both bump the harness version both wrote the next `| N |` row (run `6aab1eac`:
  #453 and #218 both took v26, and the number was moved by hand in nine places). Resolved by
  `node tools/renumber-harness-upgrade.js`: the branch's row keeps its text and takes the next
  free number, every other place the branch wrote that number moves with it, and the generated
  bootstrap template is rebuilt. It exits non-zero when the branch changed that file by more
  than adding rows, which reclassifies it as a real merge. The same script runs after a CLEAN
  merge too — two rows appended far enough apart merge silently and still collide.

After resolving, the stage re-runs the repo's stamp-and-rebuild commands (`regenCommands`, or
the ones CLAUDE.md names), then passes a two-part gate before anything is pushed: the
`regenCheckCommands` stamps check, and the test command. It commits the merge after both; the PR
body says which paths the merge resolved.

**The stamps check is what proves the regenerate took** (issue 553). Run `6aac4a53` delivered
#550 and #552 with every stamp hashed against the container's home instead of the owner's: the
payload rebuilt, the tests passed, and the `pull_request` run of `skill-stamps.yml` — which tests
the merge ref — was green, while the push-event run of the same `check` job was red the moment
each PR opened. A failing check sends the stage back to re-run the regenerate commands
byte-identical, never to a hand-edited stamp; a second failure blocks the delivery with the
skills the check named. It runs on the clean-merge path too, where a branch's skill edit and the
default branch's fold together with no conflict to resolve and no regenerate behind them.

**Anything else is a real merge and stops delivery for that ticket.** The stage aborts the
merge, pushes nothing and opens no PR; the ticket appears in the run result's `failed` list
with `conflictPaths` naming every path still in conflict. A test command that fails after an
otherwise-resolved merge blocks the same way. Re-run the fleet on that ticket, or merge the
branch by hand.

**A merge the classifier refuses is not a blocked merge.** In a container the auto-mode
classifier sometimes refuses `git merge` on the shape of the command rather than on what it
would do, and the refusals are not deterministic — a byte-identical retry usually goes through.
Run `6aac3d3b` ended with no PR for #489 or #493 over one refused merge each, both branches
verified and complete, and the session redid the two deliveries by hand as PRs #540 and #541.
So the stage retries the identical merge once, and if that is refused too it **delivers
anyway**: the verified branch is pushed as it stands, the PR is opened (through
`mcp__github__create_pull_request` when the Bash route is refused as well), and the result is
`mergeStatus: "unmerged-by-classifier"` with `pushed: true`, `conflictPaths: []` and the
refusal text verbatim in `blockedReason` — and in the PR body, under "Not merged with
`<defaultBranch>`: classifier refusal". Whoever merges that PR merges the default branch into
the branch first; nothing needs re-implementing. A verified branch never ends a run with
`pushed: false`, and the refusal text is a note on the PR, not a substitute for it.

## Where a verdict is allowed to come from

A verifier that skips its scratch worktree tests the orchestrator's own checkout, which sits on
whatever branch the session is on - on 2026-09-16 that tree predated the code under review and the
#361 probe was refuted as "fabricated" for flags `origin/main` carried and that branch did not. So
the `VERDICT` schema requires `worktree: {path, head}`, and the lane cross-checks the reported
`head` against the tip it expects: the branch under review in the code lane,
`origin/<defaultBranch>` in the probe lane, each read by its own one-command tip agent so no agent
certifies itself. That command is a `||` fallback chain, not a bare `rev-parse`: the ref as given,
then `origin/<ref>`, then `git ls-remote --heads origin <ref>` - a branch handed in from an earlier
run's `priorImpl`, or pushed by an implementer in another container, exists only as `origin/<ref>`
in the orchestrator's own checkout, and a bare `rev-parse` there used to exit 128 and skip the
cross-check for the whole ticket (issue 561). The run log names which spelling answered. A mismatch
re-runs the verifier ONCE with the mismatch named - "for where it was produced and not for what it
concluded", so the re-run is not read as pressure to change its answer. A second mismatch is
recorded as a failed attempt carrying only that mismatch, and nothing is delivered on it. When none
of the three spellings resolve the ref the verdict stands and the run log says the cross-check was
skipped: a guess is not a rejection.

That `rev-parse` agent, the tree-guard baseline and every later checkpoint, and the editable-install
guard all spawn a FRESH sub-agent, and a fresh sub-agent's shell starts wherever the orchestrating
session's shell cwd happens to be the moment it is launched - not wherever it was when the run
started. Passing each of them the relative `cfg.orchestratorCwd` default (`.`) is only correct until
the parent session's shell `cd`s to another repository mid-run, which was silently misdirecting the
tree guard (a missing guard script there turns `treeGuard:'auto'` off with no error) and sending the
tip agent a ref it resolved against the wrong tree (claude-dotfiles issue 562). The fix measures the
orchestrator's absolute checkout path exactly once, with a one-command `pwd` agent at Setup, right
after the fleet-refresh step and before anything needs it, and bakes that literal string into every
later guard, tip and scratch-worktree command; a `cd` by the parent afterwards cannot touch a string
already written into a prompt. A caller that already knows the absolute path - or wants the guard to
audit a different tree on purpose - can still pass `orchestratorCwd` itself; only the `.` default
triggers the measurement.

## The scratchpad is one per run, not one per worker

Every sub-agent is told its scratchpad directory is "session-specific, isolated from the project".
It is keyed by project and parent session, not by sub-session, so every worker of one wave is
handed the same path. In run `6aaacc32` one worker wrote its commit message to
`<scratchpad>/msg.txt` and a concurrent worker overwrote it mid-task (issue 439). Nothing errors -
the reader simply gets the other worker's bytes - so a swapped commit message lands in history and
a swapped issue body lands on the tracker, silently. The files fleet prompts ask for are exactly
the collision-prone ones: a commit message for `git commit -F`, a comment or PR body for
`gh api -F body=@…`, a fixture.

The working rule: **a path two workers could name the same way is a path they will overwrite.**
Write scratch inside your own worktree where you have one - the implementer and the prober always
do - and otherwise under `/tmp/fleet-<runId>/`, with the ticket number in the name. In the script
that is `scratchFile(...)`, and every prompt that asks for a file names the path itself instead of
leaving the choice to the worker: the comment and PR bodies behind `-F body=@…`, the verifier,
deliver and discoveries worktrees. `SCRATCH_RAIL` carries the rule itself to the implementer and
the prober, the two agents that write files nobody named for them.
`tools/ticket-fleet-branch.test.js` fails the script if a prompt goes back to `<file>` or
`<scratch dir>`, or if a per-ticket scratch path drops the ticket number.

## Python packages: one editable install, shared by every worktree

A container has one interpreter and one site-packages, so `pip install -e` from a fleet worktree
repoints the whole container's editable install at that scratch checkout. Removing the worktree at
the end of the wave then orphans it, and every later `python -c 'import <pkg>'` dies with
ModuleNotFoundError while the code on disk is fine (issue 413: the 2026-09-16 aac-routines waves
left the pointer naming a deleted `/tmp/verify-306`, and three subprocess-spawning tests read as
broken code because of it).

Two halves:

- **Prevention: seed, don't repair (issue 624).** The implementer, prober and both verifier
  prompts share one rail (`PYTHON_RAIL` in the script): before any Python command, run
  `editable-install-guard.js seed` from inside the worktree. The idea is `max-sixty/worktrunk`'s
  (a new worktree is handed a copy of the build cache rather than building into a shared one),
  not its binary: the seed makes `<worktree>/.venv` with `--system-site-packages` and copies the
  shared install's pointer files and dist-info into it, rewritten to name the worktree. The code
  then imports from the worktree with no `PYTHONPATH`, and an install through `.venv/bin/python`
  lands in that venv and goes with the worktree. A `.gitignore` of `*` inside the venv keeps the
  tree clean. `tools/editable-install-guard.test.js` reproduces the capture with a real `pip
  install -e` from a real worktree first, then shows the same install from a seeded worktree
  leaves the shared pointer alone. Bare-interpreter `pip install -e` from a worktree stays
  forbidden; where no seed tool exists, the old `PYTHONPATH=<worktree>/src` rule applies. The probe
  lane's verifier carries it too (issue 435) and carries more besides: it is the one agent that is
  *not* worktree-isolated, so a probe criterion naming `pip install -e` is re-run as a read - it
  quotes what the prober got rather than installing into the orchestrator's own checkout.
- **Repair, now only the backstop for the SessionStart-hook path below.** Once the wave has drained, the run executes `editable-install-guard.js check --main
  . --repair` (the file alongside SKILL.md, exercised by
  `tools/editable-install-guard.test.js` in `claude-dotfiles`, which adds a worktree, repoints the
  pointer, deletes the worktree and shows the import break and come back). It rewrites a pointer
  naming a scratch checkout back to the main checkout - pointer text only, never pip, because
  `pip install -e` writes `.egg-info` into the orchestrator tree the isolation checkpoint just
  cleared. A repo with no `pyproject.toml` is a quiet no-op.

The guard is looked for at `tools/editable-install-guard.js` in the served repo first, then at
`.claude/workflows/editable-install-guard.js` (beside the fleet script a fork copies out of the
plugin to launch a run), then at this repo's own `aac-skills/ticket-fleet/editable-install-guard.js`,
then at `~/.claude/skills/ticket-fleet/editable-install-guard.js`, where a cloud bootstrap that
installs this skill leaves it (literal paths only - a `$VAR` in the command is refused as an
operand computed at run time, so `${CLAUDE_PLUGIN_ROOT}` cannot be probed and the plugin's own copy
is reachable only once somebody has copied it in). A served repo adopts the guard by copying it to
either of the first two paths, or by passing the path as `editableGuardScript`. Where none of them
exists the run logs the skip **naming each path and the `cp` that creates one** (issue 435: the old
message said only "copy it into the served repo's `tools/`", and on the repo the incident happened
in nothing was ever copied); `editableGuard: true` makes that absence fail the run instead, and
`editableGuard: false` turns the guard off.

Prevention cannot cover a repo whose own hook installs before any prompt is read.
`aac-routines` `.claude/hooks/session-start.sh` cds to `CLAUDE_PROJECT_DIR` and runs
`python -m pip install --editable ".[dev]"` whenever its dependency check fails - and in a fleet
sub-session that directory IS the worktree (the same hook already rewrites `core.hooksPath` for
linked worktrees a few lines above, so it demonstrably fires there). Guarding that line to the
main checkout is an aac-routines change, recorded with the evidence in
`docs/tickets/413-decision.md` and filed there as
[aac-routines#434](https://github.com/surreptakos/aac-routines/issues/434); until it lands, the
post-wave repair is what undoes it.

## Discoveries

Every lane returns out-of-scope findings. The Report phase is one writer, and it does not append
into the session's own checkout: it cuts `agent/fleet-discoveries-wf_<runId>` from
`origin/<defaultBranch>` in a scratch worktree, appends the bullets to `followupsFile` under a
`## Run <YYYY-MM-DD> (ticket-fleet <runId>)` heading — the UTC date from `date -u +%F`, so two
runs are tellable apart without `git log -p` (issue 322) — commits that file alone, and — when
`deliver` is true —
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

## Blocker state is read, not believed

The scout reports every number a ticket's "Blocked by" section names, whatever state it thinks
those issues are in. A `blocker-state` agent then reads each distinct number through the
instrument (`gh api repos/{owner}/{repo}/issues/N --jq .state`, or `mcp__github__issue_read`)
and the closed ones are dropped from that ticket's `blockedBy` and logged as cleared, so a
ticket whose blocker landed an hour ago runs without anyone editing its body. Anything that is
not a plain `closed` - `open`, `unknown`, a number the read never came back with, a failed
agent - keeps blocking: the gate opens only on positive evidence. The run result's
`skippedBlocked` names each skipped ticket with the blocker numbers still open (issue 403).

## A ticket that already has a PR never enters the wave

One `open-pr-scan@<invocationId>` agent runs in the **Scout** phase, after blocker state and before
wave selection. It lists the repo's open PRs once through the instrument and reports which
candidate numbers have one whose head ref starts with `agent/issue-<N>-`; those candidates are
dropped, so the `maxTickets` cap fills with tickets that will actually run and the drops are named
in the run result under `skippedOpenPR` with their PR urls. It used to be the first agent of every
code lane instead: twelve tickets meant twelve agents asking for the same list, and the ticket with
a PR was selected and then skipped inside its lane, burning a wave slot while a runnable candidate
sat unselected (issue 430). An unusable answer - retry cap, empty output - is read as "no candidate
has an open PR" for the whole wave and logged once; the worst case is a duplicate PR a human
closes, which is the trade the per-lane check made too.

## A ticket parked in Maybe Someday never enters a label-driven wave

The ticket reaper (`ticket-reaper`) parks a ticket by moving it into the Maybe Someday milestone
without touching its labels - its own rule - so a parked ticket still carries `ready-for-agent`
and a label-driven scout listing still returns it. The scout reports each ticket's milestone
title (`milestone.title` from `gh api` or the MCP tracker tools), and any candidate whose
milestone is Maybe Someday is dropped before wave selection, whatever its labels, and named in
the run result under `skippedParked`. This only gates a label-driven listing: a ticket named
explicitly in `args.tickets` still runs - the caller asked for it by number, same as the human-lane
tickets that stay in the wave despite the label rule. On aac-sales-commissions on 2026-09-24 the
reaper's first sweep parked #4 #5 #22 #38 #41 and a label-driven run would have implemented all
five against the owner's speed-over-robustness ruling had the caller not passed `tickets: [...]`
explicitly (issue 786).

## Branch names

`agent/issue-<N>-attempt<A>-wf_<runId>-w<workerN>` (see the block comment at the top of the
script and the drift guards in `tools/ticket-fleet-branch.test.js`). Two concurrent scouts
against the same ticket therefore produce distinct branches; two runs of the same worker
still add `-attempt<A>` so a re-implement after a failed verify does not overwrite its own
predecessor.
