---
name: session-end
description: Re-print the end-of-session checks for a git project — whether anything is uncommitted or unpushed, whether tests and release gates pass, and whether the tracker is clean. The checks already run automatically when a turn reads as wrapping up; use this to see them again or to force a fresh run.
metadata:
  modified: "2026-09-17T02:05:05Z"
  previous-modified: "2026-09-17T01:24:21Z"
  revision: "10"
  content-sha: "e5959d0373d8"
---

# Finish a session

**The checks are a hook.** `~/.claude/hooks/session-gate.js prompt` watches for wrap-up wording
("wrap up", "done for now", "anything left", "handing off", `/session-end`) and runs the end checks
before the reply is written, so the result is already in context — read it there. It also runs on
`SessionEnd` and appends the outcome to `~/.claude/hook-state/session-gate/session-end.log`, so an
abrupt exit still leaves a record.

To see it again, or to re-run after committing or pushing:

```bash
node ~/.claude/hooks/session-gate.js report --end
```

Add `--refresh` to force a fresh run — do that after any commit or push, since the point of the
check is the state of the tree *now*. If that hook file does not exist (a cloud container with the
skills but not the hooks), run the engine directly — same report, always fresh:
`node ~/.claude/skills/session-check/check.js --end`. If that path is missing too, the plugin did
not load (claude-dotfiles#157): clone `surreptakos/claude-dotfiles` and run
`marketplace/aac-skills/skills/session-check/check.js --end` from that clone, and say so in the report.

## When the user types `/session-end`: auto-drive to archive-ready

Typing `/session-end` explicitly is the user's standing OK for every land-and-clean action below.
**Archive-ready** is the state to reach: every change committed and pushed, this session's PR
merged, the surviving worktrees and branches all carrying live work, every superseded fleet PR
closed, every open issue in a milestone and holding at least one unticked acceptance box, and
every surfaced item captured on a ticket. Reaching it ends the reply with the exact line
`Ready to archive` (bare text, no punctuation or bold) so the user can hit archive immediately.
Passive wrap-up wording ("wrap up", "handing off") asks for confirmation before each shared-state
action instead.

Sequence, run end to end when the user typed `/session-end` (a cloud container has `gh`; only the
GraphQL-backed spellings listed in the cloud section below need a substitute):

1. **Commit any uncommitted work** in a single commit that describes what changed and why.
   Never `--no-verify`. If pre-commit fails, fix the underlying issue and create a NEW commit.
2. **Push** the branch (`git push -u origin <branch>` if no upstream).
3. **Open a PR against main** if commits are ahead of `origin/main`, using
   `gh pr create --base main --head <branch>`. Include a "Closes #N" line for every issue the
   commits resolve.
4. **Merge the PR** with `gh pr merge <n> --squash --delete-branch`. If the merge fails because
   of branch protection, pending checks, or required reviewers, say so plainly and stop: the
   session stays short of archive-ready.
5. **Verify closures — read the Closure guard's latest run, do not re-check by hand.** The
   **Closure guard** job (`.github/workflows/closure-guard.yml`, issue 475) runs on every
   `issues: closed` event: an issue that a commit or a PR merge closed while an acceptance box was
   still unticked is reopened with a comment naming the box and the closing PR, so a `Fixes #N`
   that closed a ticket held open for a deploy or an owner ruling has already been undone by the
   time this step runs. Confirm and quote its latest run:
   ```bash
   curl -s https://api.github.com/repos/<owner>/<repo>/actions/workflows/closure-guard.yml/runs?per_page=1
   ```
   and read `.workflow_runs[0].conclusion` and `.html_url`. A `failure` there is a STOP like any
   other. A reopened issue is the guard working, not a fault: tick the box where it was verified
   and close again, or say on the ticket what it is waiting for. Two things the guard does not
   cover, so they stay here: it reads a close made by a *person* as a decision and leaves it
   alone, and it never fires for an issue a workflow's own `GITHUB_TOKEN` closed. So for each
   `Closes #N` in the commit confirm the issue closed, and for any other issue touched confirm it
   stayed open — reopening with a reason if a push closed one that should have stayed open.
6. **Move CLOSED items to Done on the project board** — issues/PRs closed off-board leave stale
   Todo/In-Progress cards that clog the board. Run:
   ```bash
   node ~/.claude/skills/session-end/sweep-closed-to-done.js --apply
   ```
   Zero configuration: auto-discovers every open ProjectsV2 board linked to the repo's `origin`
   remote and sweeps each. No-op if no linked board has a `Status` field with a `Done` option.
   Dry-run without `--apply` first when unsure. Requires `gh auth refresh -s project`. In a
   container that command has nowhere to run — but the step is not skipped there any more: the
   same script runs as a GitHub Actions job, so take the row for it in the cloud table below.
   Do not file a `ready-for-local-agent` ticket for a board sweep.
7. **Batch surfaced items through `/to-tickets`** (see ticket sweep below). `/to-tickets` handles
   its own breakdown/approval/publish flow — invoke it once with every NEEDS-A-TICKET item the
   sweep collected, and let that one invocation be the only route by which a ticket gets created. In a
   container where the plugin did not load and `/to-tickets` is uninvocable, read
   `marketplace/aac-skills/skills/to-tickets/SKILL.md` from a clone of `surreptakos/claude-dotfiles`
   and follow it by hand; the create call is then that skill's publish step, not ad hoc.
8. **Refresh tracker audit** — `node tools/tracker-audit.js` (or the project's equivalent). If the
   audit flags acceptance boxes on issues touched this session, tick them or record N/A with a
   justification before finishing.
9. **Audit issue metadata — every issue must live in a milestone, and no issue should sit
   open while all its acceptance boxes are ticked.** Two failure modes the tracker audit does
   not catch on its own; both surface with two `gh` queries the assistant runs here.

   **The two checks in THIS step — un-milestoned open issues, and open issues whose acceptance
   ledger has zero unticked boxes — resolve EVERY open issue that fails them, whichever session
   caused it.** `/session-end` is the housekeeping pass for the whole tracker, so a pre-existing
   hit is a blocker the assistant clears here: read the body, pick the best-fit milestone from the
   open list, or convert prose bullets to `- [ ]` boxes. Ruling 2026-08-31, after a `/session-end`
   reply routed five pre-existing hits back as questions ("which milestone for each?", "close, add
   box, or hold?"). Escalate only when the tracker will not yield the body, or two open milestones
   fit equally — and then still act: pick one and name the alternative in a comment.

   a. **Un-milestoned open issues.** Every open issue must be assigned to a milestone — the
      milestone is what maps a ticket to a scope decision, and an un-milestoned ticket is
      invisible to the milestone view the owner works from. Run:
      ```bash
      gh issue list --state open --limit 1000 --json number,title,milestone \
        --jq '[.[] | select(.milestone == null) | {n: .number, t: .title}]'
      ```
      For each result: list open milestones with
      `gh api repos/OWNER/REPO/milestones --jq '.[] | select(.state == "open") | {n: .number, t: .title}'`,
      read the issue body, and assign the best-fit milestone with
      `gh issue edit <n> --milestone "<Milestone N — Title>"`. Ambiguity between two open
      milestones is resolved by picking the one whose title's scope decision most directly
      names the issue's subject; leave a one-line comment on the ticket if the second choice
      is close. Skip this check for repos that deliberately do not use milestones (state so
      out loud the first time it comes up in a session).

   b. **Delivered-but-open issues.** An open issue whose `## Done when` / `## Acceptance` /
      `## Acceptance criteria` section has zero unticked boxes is either finished-and-forgotten
      or held open on a signal that is not written down. Run this expression against `gh issue
      list --json number,title,body --jq <expr>` (jq strings need `\\[` for a literal `[`, and
      `scan()` must be wrapped in `[...]` before `length` because it streams matches by default):
      ```jq
      .[]
      | select(.body != null and (.body | test("(?m)^##+ (Done when|Acceptance criteria|Acceptance)$")))
      | select((.body | [scan("(?m)^[- \t*]*\\[ \\][ \t]")] | length) == 0)
      | {n: .number, t: .title}
      ```
      For each hit, do one of exactly three things — no fourth. **The frequent case is a
      prose-bullet acceptance (`- foo` instead of `- [ ] foo`), which reads as "zero unticked
      boxes" to the scanner even though the work has not started.** That is not a real
      delivered-but-open — convert the prose bullets to unchecked boxes in the SAME `/session-end`
      pass. `gh issue view N --json body --jq .body > body.md`, rewrite the Acceptance section's
      `- ` bullets to `- [ ] ` (leave `## Non-goals` / `## Evidence` / `## References` sections
      alone — those are prose lists, not acceptance), then `gh issue edit N --body-file body.md`.
      Re-run the scan to confirm zero hits before `Ready to archive`.
      - **Close** with a comment naming what proved each box, if the work genuinely landed
        this session or earlier.
      - **Add the missing box** to the body if a live-run, deploy, or owner sign-off is still
        required, OR if the Acceptance section is prose bullets that need converting to `- [ ]`
        boxes (see paragraph above; the two cases share a fix). A ticked ledger without a
        real acceptance box is dishonest — that pattern closed real issues prematurely before
        the tracker audit was written.
      - **Leave open and say why** in one line to the user, if the hold-open reason is
        genuine but not captured on the issue AND the box conversion above does not apply.

10. **Clean up the worktree** — if the session ran in a git worktree and the branch has landed:
   `git worktree remove` refuses to remove the current worktree, so use the `ExitWorktree` tool
   (deferred; load via `ToolSearch` with `select:ExitWorktree`) to exit and remove it in one
   step. If `ExitWorktree` is unavailable, print the exact command the user should run from the
   main checkout: `git worktree remove <path>` (add `--force` only if the tree is unclean and the
   user OKs discarding) **and** file a `ready-for-human` ticket carrying that exact command, since
   a printed command the session cannot run is a step it cannot finish.
11. **Sweep this session's own branch and worktree — the repo-wide sweep is a job, not a step.**
    Fleet attempts, prior sessions and abandoned scratch trees accumulate silently, but a session is
    the wrong place to clear them: it runs *inside* a worktree, which cannot delete its own branch
    and makes `git branch --merged` lie, and a container's auto-mode classifier refuses
    `git push origin --delete` and `git branch -D` mid-sweep, so the cleanup used to end up as prose
    in a reply nobody reads. Issue 474 moved that half to the **Stale ref sweep** workflow
    (`.github/workflows/stale-ref-sweep.yml`, script `tools/stale-ref-sweep.js`): weekly plus
    `workflow_dispatch`, it deletes every `agent/*`, `worktree-*` and `claude/*` ref it can prove
    landed by patch-id, closes the PRs those refs superseded, and keeps ONE open `ready-for-human`
    issue holding whatever needs a ruling — closing that issue itself once a run finds nothing.

    So this step is three narrow things, all about **this session**:

    a. **This session's branch.** Once its PR is merged (step 4), delete the remote branch if the
       merge did not — `git push origin --delete <branch>` — and the local branch from the main
       checkout with `git branch -d <branch>`. Never `-D`: `-d` refusing is the answer, not an
       obstacle. If the classifier refuses the delete, the Stale ref sweep takes the ref on its next
       run, so say that in one line and file nothing.

    b. **This session's worktree.** Step 10 removed it; `git worktree prune -v` from the main
       checkout clears the leftover admin dir. Windows quirk: a PowerShell redirect can leave a
       `nul` file that blocks removal — `rm -rf <path>` clears it, then prune.

    c. **Read the sweep's verdict instead of repeating it.** Quote its latest run and the state of
       its issue:
       ```bash
       gh run list --workflow stale-ref-sweep.yml --limit 1
       gh issue list --state open --label ready-for-human --search 'Stale ref sweep in:title'
       ```
       A `failure` run is a STOP like any other. If that issue names a branch **this session**
       created or stranded, resolve it here — land the work, or delete the ref — and say which line
       of the issue is now dead. Branches and PRs from other sessions are the owner's queue on that
       one issue, not this step's work: do not delete them, and do not re-file them as new tickets.

    **Never force-delete a branch carrying genuinely stranded work**, here or by hand. The sweep
    never does — patch-id evidence or nothing — and neither does a session: stranded work belongs on
    the sweep's issue, by branch name, with its unique commits.

12. **Re-run the end check** — `node ~/.claude/hooks/session-gate.js report --end` — and report
    the result. Add `--refresh` only when steps 1–11 committed, pushed, or otherwise moved the
    tree; otherwise the report the hook ran on this prompt is still the state of the tree and is
    reused inside its five-minute cooldown. A refresh on a clean, pushed head costs git and
    tracker calls, not a test run: the engine skips the suite there, because pre-commit ran it
    on each commit and CI runs it on the pushed head. Every STOP line must be resolved before
    the `Ready to archive` line is emitted.

If any step in 1–11 fails or is blocked for a reason the assistant cannot resolve, name the
blocker, **file it as a ticket — `ready-for-agent` when another session can finish it,
`ready-for-human` when only the owner can — or as a comment on the ticket that already owns the
step** (rule below), list what IS done, and stop; `Ready to archive` is reserved for a state the
user can archive without checking, and an unfiled blocker is a step nobody will ever see again.

**A blocker is a narrow thing:** a CI failure, a protected-branch refusal, a credential the
assistant cannot mint, or a choice that needs an owner ruling (values, risk tolerance, priorities).
Tracker housekeeping that reading the body settles — an un-milestoned issue, a prose-bullet
acceptance, a delivered-but-open hit — is work this pass does, and step 9 says how.

### Every step the session cannot finish becomes a ticket

Owner ruling 2026-09-15: nothing said in a session reply is seen. A step of the sequence that
this session cannot complete — blocked, unavailable in this environment, or refused — has
exactly one durable landing place, chosen before the reply is written:

- **A comment on the ticket that already owns the step**, when one exists — a discovery an open
  ticket already tracks goes there, naming the repo and the date, and files no new ticket.
- **A `ready-for-agent` ticket**, when another cloud session can finish it — a rebuild, an audit
  re-run, a follow-up edit.
- **A `ready-for-local-agent` ticket**, when only a desktop session can — the skipped board sweep
  (step 6), a live-tree edit plus `sync.ps1 -Mode push`, a remote branch delete the session proxy
  refuses, a command the container's auto-mode classifier blocks. Never `ready-for-human` for
  these: a desktop session runs them without the owner.
- **A `ready-for-human` ticket**, when only the owner can: stranded work to judge, a credential
  to mint, a UI action no API covers, a superseded-or-not call the session cannot make. The
  owner's queue is a label query, so an unlabelled ticket is invisible to it.

File new tickets through `/to-tickets` in the step-7 batch (comments go through `gh issue
comment`, or MCP `add_issue_comment` in a container), then quote every number in the wrap-up.
"Named it for the user" and "needs a local session" are not outcomes.

**A classifier-denied cleanup is one of these cases, not an exception.** In auto mode the
destructive-action classifier can refuse `git push origin --delete <branch>`, `git branch -D
<branch>` or `git worktree remove --force <path>` mid-sweep. Do not retry it and do not leave
the refusal sitting in the reply: file a `ready-for-local-agent` ticket carrying the exact command,
the branch or path, and the evidence that its work already landed (the squash SHA on `main`,
the merged PR number), so running it is read-and-paste for the owner.

## In a cloud container: same duties, different instruments

A cloud session (claude.ai/code, Cowork) **has** `gh` — the bootstrap `SessionStart` hook installs
it into `~/.local/bin` on every AAC repo (issue 163; 2.86.0, measured 2026-09-17), and
`CLAUDE_CODE_REMOTE_SESSION_ID` in the environment is the tell you are in one. What a container
lacks is **GraphQL**: the egress proxy answers `api.github.com/graphql` with `HTTP 403: GitHub
GraphQL is not available from Claude Code sessions` whatever the token carries. `gh issue`, `gh pr`
and `gh repo view --json` all go through gh's GraphQL client, so each exits 1, while every
`gh api repos/<owner>/<repo>/…` REST spelling exits 0. **This table is that list and nothing
else** — a step whose command is not here runs verbatim, gh and all (issue 212):

| The GraphQL-backed spelling | In a container use |
| --- | --- |
| `gh pr create` | GitHub MCP `create_pull_request`, or REST `gh api --method POST repos/<owner>/<repo>/pulls -f head=<branch> -f base=main -f title=… -F body=@body.md` |
| `gh pr merge --squash --delete-branch` | MCP `merge_pull_request` (method squash). The branch delete is step 11a's business, with git |
| `gh issue list --json … --jq …` | REST `gh api "repos/<owner>/<repo>/issues?state=open&per_page=100&page=N"` — it carries `milestone`, so it drives step 9a; MCP `search_issues` also returns milestone, `list_issues` did not on 2026-09-14 (claude-dotfiles#154 evidence) |
| `gh issue view <n> --json body`, `gh issue edit <n> --body-file` (step 9b) | REST `gh api repos/<owner>/<repo>/issues/<n> --jq .body > body.md`, then `gh api --method PATCH repos/<owner>/<repo>/issues/<n> -F body=@body.md`; MCP `issue_write` (update) does the same and takes the body inline |
| `gh issue edit <n> --milestone` | MCP `issue_write` (update), or REST `gh api --method PATCH repos/<owner>/<repo>/issues/<n> -F milestone=<number>` |
| `gh pr list --state open` | REST `gh api "repos/<owner>/<repo>/pulls?state=open&per_page=30"`, or MCP `list_pull_requests` with `perPage` 30 or less — 100 overflows the tool-result limit and spills to a file |
| `gh pr close <n> --comment` | MCP `update_pull_request` (state closed) + `add_issue_comment` |
| `sweep-closed-to-done.js --apply` (step 6) | ProjectsV2 is GraphQL-only, so nothing runs by hand — the **Board sweep** job (`.github/workflows/board-sweep.yml`, issue 216) runs that same script on every issue and PR close plus a daily tick. Confirm and quote its latest run: `gh api "repos/<owner>/<repo>/actions/workflows/board-sweep.yml/runs?per_page=1"` and read `.workflow_runs[0].conclusion` and `.html_url`. A `failure` there is a STOP like any other, and the run log says which of three causes it is: `PROJECT_TOKEN` missing or expired; a board with no `Status`/`Done` option; or `GraphQL: API rate limit already exceeded for user ID <id>`, the PAT's own hourly bucket drained by a concurrent fleet wave — that one is transient, so re-dispatch the job (`workflow_dispatch`, `proof` false) after the bucket resets and read THAT run rather than passing over a red one |

Everything else answers through `gh api repos/<owner>/<repo>/…`; the session's egress proxy
authenticates api.github.com, private repos included, so no `curl` and no token of your own is
needed. `gh run list` and `gh api …/actions/…` are REST and work, which is how the job rows above
and in step 11c are read. Git itself (push, fetch) works normally through the same proxy.

Four container quirks that are NOT GraphQL, so they are not in the table above. Each is said out
loud **and filed** — a ticket, or a comment on the ticket that owns the step (rule above); a
container's missing instrument is the commonest way a step ends up living only in the reply:

- **`gh api --paginate` dies on page 2** with `Numeric-ID repository paths (repositories/{id}/...)
  are not supported through this proxy` (HTTP 403) — gh follows the Link header, which is spelled
  by id. Page explicitly instead: `&per_page=100&page=1`, `&page=2`, … until a short page comes back.
- **A bash `gh api --method POST|PATCH` is refused intermittently by the session's own auto-mode
  classifier** (`[External System Writes]`), not by GitHub. Measured 2026-09-17 in one container:
  the `dependencies/blocked_by` POST the tracker audit prints as its own fix ran first try, a
  `PATCH …/issues/<n>` in a compound command was refused and the identical command alone ran a
  moment later. Retry once; if it refuses again, every write the sequence needs has a GitHub MCP
  tool (`issue_write`, `add_issue_comment`, `merge_pull_request`) and those are not classified.
- **Step 6 (board sweep) and step 11 (the repo-wide `git branch --merged` / ref-delete sweep)** are
  not a container's problem any more: each is a GitHub Actions job — `board-sweep.yml` (issue 216)
  and the **Stale ref sweep**, `stale-ref-sweep.yml` (issue 474) — so read the job's verdict as its
  step says and file no `ready-for-local-agent` ticket for either. A session still deletes its own
  branch, with git, which works normally through the proxy. Neither is a table row: git is not
  GraphQL, and the board sweep's row is there for the ProjectsV2 read underneath it.
- **The cloud-plugin staleness check** is skipped in containers: the container IS the downstream
  copy. The tracker audit is NOT skipped — it shells out to gh and runs, exiting 0 or 1; only its
  ProjectsV2 board checks degrade, and they say so with a `NOTE` naming GraphQL rather than passing.

**Handing on** means one thing throughout: file or update a `ready-for-local-agent` ticket that
names the step and what is left of it. A desktop session can run all of it, so `ready-for-human`
stays for a person's judgment — and the ticket, rather than a reply line, is what outlives the
session.

MCP write calls (merge, close, edit) may raise a permission prompt; when the user typed
`/session-end`, that prompt is the confirmation — approve it and carry on.


## Then close the loop (report interpretation)

**`STOP N uncommitted files`** — the work exists on one machine and nowhere else. Show
`git status --short`, then commit it (per step 1 above) or say explicitly what is being left
behind and why.

**`!! N commits not pushed`** — same risk, plus two consequences worth naming: CI has not run, so
any generated file (a dashboard, a coverage badge) is reporting stale numbers; and any commit SHA
quoted in an issue comment points at something nobody else can reach. Push per step 2.

**`STOP release gate FAILS`** — hold the release, and say which gate failed and what it said.

**`!! tracker audit: N drift finding(s)`** — run it and fix every finding, whatever session caused
it (Dan, 2026-09-10, after a session left three pre-existing dangling references standing under the
older "yours versus theirs" reading). The audit prints the fix beside each finding: qualify a bare
cross-repo `#N` as `owner/repo#N`, tick or justify an open box on a closed issue, add the missing
triage label. A finding that needs an owner ruling gets a `ready-for-human` ticket.

**Scope.** Step 9's two checks and this rule together sweep the WHOLE tracker, origin irrelevant:
`/session-end` is the housekeeping pass, and a hit left for "the session that caused it" is a hit
the next session re-investigates from scratch. Advisories count too: a `landed-but-open?` line is
resolved by reading the named commit, then closing the issue or commenting on what is left (ruling
2026-09-02, after a session cleared only its own advisory and reported the other two as somebody
else's).

**`!! cloud plugin is STALE`** (or `no upload recorded`) — the skills on this machine changed since
the plugin was uploaded to claude.ai, so every cloud container is still loading the old ones. The
report names what was added, changed or removed. Fixing it is a rebuild and a re-upload: run
`/update-cloud-plugin`, which rebuilds the zip, asks before touching the account, drives the upload,
verifies the row, and stamps the sweep. Leaving it stale is a fine answer for a throwaway edit — say
so rather than passing over the line in silence.

A `could not check` note means the sweep could not read the tree or the stamp, so the plugin's
state is still unknown.

## The ticket sweep — nothing leaves the session uncaptured

The checks above audit the *tree*; this step audits the *conversation*. Context dies with the
session, and an item that lives only in a reply is gone the moment the window closes. Run it
before writing the wrap-up summary.

**Scour the whole conversation**, first turn to last, for work that was surfaced but
never captured. The categories that get lost, with the phrasings that mark them:

1. **Deferred by the user** — "later", "not now", "after X ships", "say the word and I..."
2. **Deferred by you** — "worth an issue?", "I can file that", options offered and never picked.
3. **Known limits you stated** — "known limit:", "weakness:", "does not handle", caveats in
   summaries. Each is either acceptable-forever or a ticket; say which.
4. **Undecided decisions** — questions asked (yours or AskUserQuestion) that never got an answer,
   or got "undecided". A decision nobody recorded will be re-litigated from scratch.
5. **Flagged-but-unfixed** — anything you called stale, harmful, drifted, or wrong and then did
   not fix. Includes findings in OTHER systems (Zoho data, hooks, another repo).
6. **Follow-ups promised in issue comments or DECISIONS.md** — "next person should", "before
   release", "needs a decision from".
7. **Human-action preconditions** — a step only the owner or another human can perform (a UI
   operation the API cannot do, a credential mint, a sign-off, a judgment call) that gates work
   this session produced or held. These hide better than the others because they feel "attached"
   to the PR or handoff they gate. Measured failure 2026-08-24: a PR's merge was gated on a
   49-choice Desk-UI rename that lived only in the PR's hold comment, the HANDOFF owner queue,
   and session replies — the owner found it only by asking "how would I have known?".

For every item found, exactly one of three outcomes, stated explicitly:

- **Already tracked** — name the ticket number. Tracked means an OPEN ISSUE ON THE TRACKER,
  nothing else: a PR body or comment, a HANDOFF/DECISIONS/FOLLOW-UPS line, or a session reply is
  where items go to be lost, and citing one is naming the burial site, not the ticket. A step
  a local session can perform must additionally carry the `ready-for-local-agent` label (or the
  project's equivalent); only a person's judgment, credential or sign-off carries `ready-for-human`.
  Each label drives a queue, and an unlabeled ticket is invisible to both.
- **Not worth tracking** — say so and why, in one line, so the judgement is on the record.
- **Needs a ticket** — collect these for the single **`/to-tickets`** batch in step 7; when the
  user typed `/session-end`, that IS the confirmation its approval gate asks for.

### The wrap-up template

The reply that ends a `/session-end` pass has these parts, in this order:

```
Landed: <PR or commit, one line each>
Filed:  #<n> <title> — ready-for-agent | ready-for-human      (one line per ticket filed this pass)
        #<n> comment — <what was recorded on the ticket that already owns the step>
Left:   <nothing, or one line per item, each carrying a #number from the Filed block>
Ready to archive
```

Every ticket `/to-tickets` published this pass appears under `Filed:` by number, and so does
every comment landed on an owning ticket. `Filed:` is never omitted when empty — write
`Filed: none`, so a clean pass reads differently from a forgotten one.

**A line saying work is left for someone else — "needs you", "needs a local session", "for the
owner", "could not delete X", "hand this to" — is malformed unless a `#number` sits in it.** If
you are about to write one without a number, the ticket has not been filed yet: file it, then
write the line. `Ready to archive` is not emitted while any surfaced item exists only in the
reply.

## Two things the script cannot check

**Did the push close an issue that should have stayed open?** A commit message containing `Fixes #N`
closes that issue the moment it reaches the default branch — including issues deliberately left open
because a box still needs a deploy or an owner's ruling. This has happened more than once, which is
why the Closure guard job now reopens those closures on the close event (step 5); what it cannot
judge — a close made by a person, or one made by a workflow's own token — is still verified here, by
reading the state of every issue the session touched.

**Are the acceptance boxes honest?** In a repo where closing means *verified*, a box needing a live
run stays unticked and the issue stays open, however finished the code is.

## If the session ends in a release

Order matters, and every step runs:

1. **Credential** — none for a self-deploying repo (`gas.json`: the script holds its own and a merge
   is the release). A repo still on clasp: `node tools/clasp-auth.js` (or the project's equivalent),
   alive *and* correctly scoped, not merely alive.
2. **Gates** — whatever `releaseGates` names, or the project's canary.
3. **Release** — from the main checkout; releasing from a worktree publishes that tree instead.
4. **Confirm** — read back what the deployed thing reports about itself, rather than assuming the
   push landed.

Then watch the first real piece of work through it.

## Related

- `/session-start`
- `/update-cloud-plugin` — closes a stale cloud plugin the sweep found
- `~/.claude/skills/session-check/cloud-plugin-sweep.js` — the sweep itself; `--stamp` after a
  verified upload, `--json` for tooling
- A project may have its own `docs/runbooks/session.md`
