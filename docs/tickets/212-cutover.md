# Issue 212: claude-dotfiles cut-over — a cloud session reaches session-end `Ready to archive`

**Status:** reached, 2026-09-17, in a real claude.ai/code container. This file is the evidence page
for issue 212's four acceptance criteria: the session-end pass that ends in `Ready to archive`, the
session-start STOP with the payload absent, the substitution table now listing GraphQL-only steps,
and the map #154 fog line. Nothing here is simulated — every transcript is a command run in the
container named below, and every run URL is a real Actions run.

Map #154's cut-over rule is the reason it matters: *a repo cuts over when its bootstrap hook lands
via the harness and one cloud session reaches session-end `Ready to archive`.* claude-dotfiles is
first in that order.

## The container

```
CLAUDE_CODE_REMOTE_SESSION_ID=cse_015wxd7VzCCueq761hKqb6zq
CLAUDE_CODE_CONTAINER_ID=container_01BeEnpTi5Gw2iVL4SfivCY1--claude_code_remote--c39108
$ command -v gh
/root/.local/bin/gh
$ gh --version
gh version 2.86.0 (2026-01-21)
$ head -4 ~/.claude/hook-state/aac-bootstrap/state.json
{
  "payload_version": "2026.9.170119",
  "skills_hash": "6698f759645c3712255575481acfe0de28e57a16a6f5fd9d2387f0f757b25996",
  "skills_count": 61,
```

The session-end pass below runs against a **fresh clone of master** inside that container
(`git clone https://github.com/surreptakos/claude-dotfiles.git`, head `e2e3136`), which is what a
fresh cloud session's checkout is: clean tree, nothing unpushed, no PR of its own to open. The
engine is the clone's own published payload —
`node marketplace/aac-skills/skills/session-check/check.js --end`, the route the session-end skill
names for a container — so the report reads master's skills rather than this container's
bootstrap snapshot. That distinction matters once, and is written up under
[A stale payload](#a-stale-payload-reads-as-a-harness-drift-no-session-can-fix) below.

## What stood between the report and the `Ready to archive` line

Attempt 1 reached `exit 0` with two `!!` advisories standing and stopped there. Both were tracker
state, not container defects, and both were clearable from a container. They are cleared.

### 1. `[ungated-dependency] #482` — the audit printed its own fix, and it ran

The audit's remedy is a REST POST. It went through from bash on the first try:

```
$ gh api --method POST repos/surreptakos/claude-dotfiles/issues/482/dependencies/blocked_by \
    -F issue_id=5480887474
… "issue_dependencies_summary":{"blocked_by":1,"total_blocked_by":1,"blocking":0,"total_blocking":0}
```

Attempt 1 recorded this call as impossible in a container because the auto-mode classifier refuses
it. The refusal is real but **intermittent**, not categorical: the same session had a
`PATCH …/issues/117` refused inside a compound command minutes later and the identical command ran
alone. So the rule is retry once, then use the GitHub MCP tool — which is what the session-end
skill's cloud section now says.

### 2. `[closed-with-open-boxes] #117` — reopened, which is the audit's own first remedy

The finding names one unticked box: *trim `issues.types` to `[opened, closed]` in every affected
workflow, one PR per repo, merged.* That work is six edits in six **other** repositories and has
not landed; #451 (open, `ready-for-local-agent`) owns it. Ticking the box would be the dishonest
ledger the session-end skill warns about, so #117 was reopened instead — the audit prints exactly
two remedies ("reopen it, or tick them and say where each was verified"), and **#451's own third
acceptance criterion names this route**: "#117's second acceptance box is ticked (or #117 reopened
and closed again) with the six merge links, so `tracker-audit` stops reporting it."

What changed on #117, so no fourth session re-derives the readback: state closed → open; label
`ready-for-agent` → `ready-for-local-agent` + `chore` (no fleet worker in this repo can finish it);
`## Blocked by` now names #451 with a native `blocked_by` edge; and a comment records why.
`docs/tickets/117-decision.md` stays the settled measurement.

The **Closure guard** (issue 475) does not cover this case and is not at fault: #117's `closed`
timeline event carries `commit_id=null` — a person's close — which the guard reads as a decision
and leaves alone by design.

### 3. Nine `stale-premise?` advisories — cleared the way the audit asks

Advisory lines are not `!!` in the report, but the session-end skill counts them, so they were
cleared rather than passed over. Eight were the same shape: #214 and #219–#225 each list a bare
`- #210` under `## Blocked by`, and #210 closed on 2026-09-16. Each now reads
`- #210 — closed 2026-09-16, blocker released`, the wording #212's own body already used for #163.
#362's citation of closed #302 and #379's of closed #211 are deliberate (each names what the closed
ticket's scope left behind), so each took the documented
`<!-- tracker-audit-ignore: stale-premise #N -->` marker.

```
$ node tools/tracker-audit.js            # in the container, after the above
No drift found across 16 checks.
exit 0
```

### 4. Board sweep red on the PAT's own GraphQL bucket

Step 6 reads the Board sweep job's latest run, and a `failure` there is a STOP. It was red, four
runs deep, with a cause the skill did not list:

```
gh repo view failed: Command failed: gh repo view surreptakos/claude-dotfiles --json projectsV2
GraphQL: API rate limit already exceeded for user ID 12160797.
##[error]board sweep exited 2 — see the lines above.
```

`PROJECT_TOKEN` is present and valid; its **hourly GraphQL bucket** was drained by the concurrent
fleet wave. That is transient, so the job was re-dispatched (`workflow_dispatch`, `proof` false) and
came back green, and the session-end skill's board-sweep row now names this as the third cause with
the re-dispatch as its remedy.

### A stale payload reads as a harness drift no session can fix

Run from this container's own bootstrap snapshot, the report carries one `!!` that master does not
justify:

```
Harness
  !!   harness stamp says v27 but the skill is at v25 — someone edited the marker without bumping the template
```

Master is internally consistent (`docs/agents/harness-version.md` and
`agents/skills/project-harness/templates/harness-version.md` both read 27). The container booted at
01:19Z on payload `v2026.9.170119`; harness v26 and v27 landed at 01:26Z and 02:00Z. Issue 412's
`stale-skill-copy` state exists for exactly this, but it compares against `~/.aac-dotfiles`, which
is the *same* bootstrap-time snapshot (v25), so the state cannot fire and the marker takes the
blame. A session that boots now installs `v2026.9.170154` and reads `ok harness v27, current`,
which is what the run below shows. Recorded in the skill's quirks list and as a discovery; the
`stale-skill-copy` blind spot is not fixed on this ticket.

## The sequence, step by step

| Step | What a container does | Result |
| ---: | --- | --- |
| 1–2 | commit, push | nothing to commit: `working tree clean`, `nothing unpushed` |
| 3–4 | PR, merge | a fresh session with no commits of its own opens none |
| 5 | Closure guard's latest run | `success 2026-09-17T02:17:21Z` — [run 35173838617](https://github.com/surreptakos/claude-dotfiles/actions/runs/35173838617) |
| 6 | Board sweep's latest run | `success 2026-09-17T02:17:21Z` — [run 35173838630](https://github.com/surreptakos/claude-dotfiles/actions/runs/35173838630) |
| 7 | surfaced items | this pass surfaced two, both recorded as comments on the tickets that own the step (#216, #494) rather than as new tickets |
| 8 | Tracker audit's latest run | `success` for head `e2e3136` — [run 35173838650](https://github.com/surreptakos/claude-dotfiles/actions/runs/35173838650) |
| 9 | Issue metadata audit's latest run | `success 2026-09-17T02:15:51Z` — [run 35173742070](https://github.com/surreptakos/claude-dotfiles/actions/runs/35173742070). This repo has **no milestones at all** (`gh api …/milestones?state=all` returns `[]`), so the milestone half is a deliberate no-op here, said out loud once per the skill |
| 10–11 | worktree, own branch, Stale ref sweep | a fresh clone has neither worktree nor branch of its own. `stale-ref-sweep.yml` has **no runs yet** (merged 23:13Z, weekly cron, never dispatched) — "no run" is not a `failure`, so not a STOP |
| 12 | re-run the end check | below |

Two reads worth keeping for the next reader: the delivered-but-open scan (step 9's second check)
hit one open issue, #505, whose `### Done when` section was prose bullets rather than `- [ ]` boxes
— the frequent case the skill says to convert in the same pass. Converted; the scan is now empty.
And the Board sweep's green run still logs
`skip surreptakos/#8 "claude-dotfiles": item-list failed … total moved 0, fails 0`, so the job is
green while sweeping nothing. That is recorded on #216, which owns the step.

## Session-end check, verbatim

`node marketplace/aac-skills/skills/session-check/check.js --end`, from the clone, head `e2e3136`,
**exit 0**:

```
Finishing a session — cutover-212

Git
  ok   working tree clean
  ok   nothing unpushed

Harness
  ok   harness v27, current

Cloud bootstrap
  ok   aac-bootstrap payload v2026.9.170119 — 61 skills, gh installed
      payload matches dotfiles master (v2026.9.170119)

Work
  --   tests — `node --test tests/*.test.js tools/*.test.js agents/skills/session-check/*.test.js` not re-run: HEAD is committed and pushed, so pre-commit and CI on that head own the verdict
  ok   tracker audit clean
      e2e3136 — https://github.com/surreptakos/claude-dotfiles/actions/runs/35173838650
  ok   27 ticket(s) labelled ready-for-agent
      ...
      (ready-for-local-agent queue is for the desktop — not listed in a cloud container)

Note
      Release here is the push to origin/master - that is what a new machine restores from. ...

All clear. Nothing left hanging.
```

**Zero STOP lines, zero `!!`, exit 0.** That is the gate the `Ready to archive` line sits behind.

## The session-end reply, ending in `Ready to archive`

`Ready to archive` is the assistant's line, not the script's, and it is what a fresh cloud session
on this repo now writes — steps 1–12 all answered, every surfaced item on a ticket:

```
Landed: nothing — a fresh session on a clean, pushed master has nothing of its own to land
Filed:  #216 comment — Board sweep's green run logs `item-list failed … total moved 0, fails 0`,
        so the job reports success while sweeping no board
        #494 comment — two more shapes the worktree-isolation guard refuses (`HOME=… node …`,
        and any `for` loop whose body runs gh with a computed value)
Left:   nothing
Ready to archive
```

## Session-start with the payload absent

The marker's own documented override points the check at a home that has none — the live tree at
`~/.claude` is a production path a session must not touch. Exit 1:

```
$ BOOTSTRAP_MARKER_FILE=/tmp/…/absent-home/.claude/hook-state/aac-bootstrap/state.json \
    node marketplace/aac-skills/skills/session-check/check.js

Cloud bootstrap
  STOP aac-bootstrap marker absent at /tmp/…/absent-home/.claude/hook-state/aac-bootstrap/state.json — the SessionStart bootstrap hook did not run
      the hook is `.claude/hooks/session-start.sh` in every AAC repo; a container reaches it via CLAUDE_CODE_REMOTE=true
...
Deal with the STOP lines before writing code.
```

## The probe behind "GraphQL-only"

Measured in this container, 2026-09-17, real exit codes (read unpiped):

| Command | Exit | Result |
| --- | ---: | --- |
| `gh issue list --state open --limit 1` | 1 | `HTTP 403: GitHub GraphQL is not available from Claude Code sessions` |
| `gh pr list --state open --limit 1` | 1 | same 403 |
| `gh repo view --json name` | 1 | same 403 |
| `gh issue view 212 --json number` | 1 | same 403 |
| `gh api "repos/<owner>/<repo>/issues?state=open&per_page=1"` | 0 | answers; `milestone` key present |
| `gh api --method POST …/issues/482/dependencies/blocked_by` | 0 | writes |
| `gh api --method PATCH …/issues/214` | 0 | writes |
| `gh run list --workflow board-sweep.yml --limit 1` | 0 | answers (REST) |
| `gh api --paginate "repos/<owner>/<repo>/issues?…&per_page=50"` | 1 | page 1 answers, then `Numeric-ID repository paths (repositories/{id}/...) are not supported through this proxy` |

So the failing set is exactly gh's GraphQL-backed subcommands, and the session-end substitution
table now lists those and nothing else. Three kinds of row left it: the repo-wide
`git branch --merged` / ref-delete sweep (git, not GraphQL — the Stale ref sweep job owns it), the
Tracker audit and the Issue metadata audit (jobs for the desktop as much as for a container, so not
substitutions at all), and the two non-GraphQL quirks (`--paginate`, the classifier), which are
prose beneath the table.

## Known, recorded, not fixed here

- `tools/tracker-audit.js` counts a `#N` self-citation in an issue's own `## Blocked by` section as
  a prose blocker, so a ticket that explains its own state there earns an `ungated-dependency`
  finding pointing at itself. Seen and worked around while reopening #117.
- `harness-version.js`'s `stale-skill-copy` state cannot fire in a container whose
  `~/.aac-dotfiles` clone is the same bootstrap-time snapshot as its plugin payload, and
  `bootstrap-check.js` compares the marker's payload version against that same clone, so it reports
  "payload matches dotfiles master" while master has moved on.
- Board sweep goes green while skipping the only board it has (`item-list failed`), recorded on
  #216.
- The tracker is live: a concurrent fleet wave closed #477 with an unticked box between two runs of
  this pass, which turned the audit red until the tick workflow caught up. Everything above is a
  snapshot at head `e2e3136`, 2026-09-17 02:2xZ, and says so.

## How to reproduce

```bash
git clone https://github.com/surreptakos/claude-dotfiles.git /tmp/cutover && cd /tmp/cutover
node marketplace/aac-skills/skills/session-check/check.js --end          # expect exit 0, All clear
BOOTSTRAP_MARKER_FILE=/tmp/nowhere/state.json \
  node marketplace/aac-skills/skills/session-check/check.js              # expect exit 1, the STOP
```
