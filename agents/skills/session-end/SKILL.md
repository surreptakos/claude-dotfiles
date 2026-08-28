---
name: session-end
description: Re-print the end-of-session checks for a git project — whether anything is uncommitted or unpushed, whether tests and release gates pass, and whether the tracker is clean. The checks already run automatically when a turn reads as wrapping up; use this to see them again or to force a fresh run.
---

# Finish a session

**The checks are a hook now, not a decision.** `~/.claude/hooks/session-gate.js prompt` watches for
wrap-up wording ("wrap up", "done for now", "anything left", "handing off", `/session-end`) and runs
the end checks before the reply is written, so the result is already in context. It also runs on
`SessionEnd` and appends the outcome to `~/.claude/hook-state/session-gate/session-end.log`, so an
abrupt exit still leaves a record. Do not re-run it and do not paste the report back.

To see it again, or to re-run after committing or pushing:

```bash
node ~/.claude/hooks/session-gate.js report --end
```

Add `--refresh` to force a fresh run — do that after any commit or push, since the point of the
check is the state of the tree *now*.

## When the user types `/session-end`: auto-drive to archive-ready

Typing `/session-end` explicitly is the user's standing OK for every land-and-clean action below.
The final state must be: nothing uncommitted, nothing unpushed, no unmerged PR from this session,
no orphan worktree, no stale local or remote branch whose work already landed on main, no
open fleet PR that has been superseded, no open issue without a milestone, no open issue
whose acceptance ledger is fully ticked — and no surfaced item uncaptured. The reply MUST end
with the exact line `Ready to archive` (no punctuation, no bold, no extra words) so the user
can hit archive immediately. Passive wrap-up wording ("wrap up", "handing off") is NOT a
standing OK — confirm before landing shared-state actions in that mode.

Sequence, none skippable when the user typed `/session-end`:

1. **Commit any uncommitted work** in a single commit that describes what changed and why.
   Never `--no-verify`. If pre-commit fails, fix the underlying issue and create a NEW commit.
2. **Push** the branch (`git push -u origin <branch>` if no upstream).
3. **Open a PR against main** if commits are ahead of `origin/main`, using
   `gh pr create --base main --head <branch>`. Include a "Closes #N" line for every issue the
   commits resolve.
4. **Merge the PR** with `gh pr merge <n> --squash --delete-branch`. If the merge fails because
   of branch protection, pending checks, or required reviewers, say so plainly and stop — the
   session is NOT archive-ready; do NOT emit the `Ready to archive` line.
5. **Verify closures** — for each `Closes #N` in the commit, confirm the issue closed; for any
   other issue touched, confirm it stayed open. Reopen with a reason if a push closed one that
   should have stayed open.
6. **Move CLOSED items to Done on the project board** — issues/PRs closed off-board leave stale
   Todo/In-Progress cards that clog the board. Run:
   ```bash
   node ~/.claude/skills/session-end/sweep-closed-to-done.js --apply
   ```
   Zero configuration: auto-discovers every open ProjectsV2 board linked to the repo's `origin`
   remote and sweeps each. No-op if no linked board has a `Status` field with a `Done` option.
   Dry-run without `--apply` first when unsure. Requires `gh auth refresh -s project`.
7. **Batch surfaced items through `/to-tickets`** (see ticket sweep below). This is required, not
   optional. `/to-tickets` handles its own breakdown/approval/publish flow — invoke it once with
   all NEEDS-A-TICKET items collected during the sweep. Never `gh issue create` ad hoc.
8. **Refresh tracker audit** — `node tools/tracker-audit.js` (or the project's equivalent). If the
   audit flags acceptance boxes on issues touched this session, tick them or record N/A with a
   justification before finishing.
9. **Audit issue metadata — every issue must live in a milestone, and no issue should sit
   open while all its acceptance boxes are ticked.** Two failure modes the tracker audit does
   not catch on its own; both surface with two `gh` queries the assistant runs here.

   a. **Un-milestoned open issues.** Every open issue must be assigned to a milestone — the
      milestone is what maps a ticket to a scope decision, and an un-milestoned ticket is
      invisible to the milestone view the owner works from. Run:
      ```bash
      gh issue list --state open --limit 1000 --json number,title,milestone \
        --jq '[.[] | select(.milestone == null) | {n: .number, t: .title}]'
      ```
      For each result, assign the correct milestone with
      `gh issue edit <n> --milestone "<Milestone N — Title>"`. If the assistant cannot tell
      which milestone applies, name the issue and ask; do not leave any open issue unassigned.
      Skip this check for repos that deliberately do not use milestones (state so out loud
      the first time it comes up in a session).

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
      For each hit, do one of exactly three things — no fourth:
      - **Close** with a comment naming what proved each box, if the work genuinely landed
        this session or earlier.
      - **Add the missing box** to the body if a live-run, deploy, or owner sign-off is still
        required (a ticked ledger without that box is dishonest — it is the pattern that
        closed real issues prematurely before the tracker audit was written).
      - **Leave open and say why** in one line to the user, if the hold-open reason is
        genuine but not captured on the issue.

10. **Clean up the worktree** — if the session ran in a git worktree and the branch has landed:
   `git worktree remove` refuses to remove the current worktree, so use the `ExitWorktree` tool
   (deferred; load via `ToolSearch` with `select:ExitWorktree`) to exit and remove it in one
   step. If `ExitWorktree` is unavailable, print the exact command the user should run from the
   main checkout: `git worktree remove <path>` (add `--force` only if the tree is unclean and the
   user OKs discarding).
11. **Sweep the repo's stale branches, worktrees, and PRs** — session cleanup runs beyond this
    session's own branch, because fleet attempts, prior sessions, and abandoned scratch trees
    accumulate silently and no built-in check surfaces them. The state to reach is: only `main`
    plus branches with active unmerged work; only worktrees currently in use; no open PR that has
    been superseded by later work.

    Do it in this order (all commands run from the main checkout — a worktree cannot delete its
    own branch and confuses `git branch --merged`):

    a. **List foreign worktrees.** `git worktree list` shows every worktree; anything except
       `main` and the current session's tree is a candidate for removal. For each, run
       `git -C <path> status --short` first; a clean tree is safe to `git worktree remove --force`,
       a dirty tree gets its diff shown to the user before removal. Windows quirk: PowerShell
       redirects can leave a `nul` file that blocks removal — `rm -rf <path>` clears it, then
       `git worktree prune -v` cleans up the metadata.

    b. **Fetch --prune** — `git fetch --prune origin` deletes local remote-tracking refs whose
       upstream is gone, so the merged-branch scan reflects reality.

    c. **Delete merged local branches** — `git branch --merged main | grep -vE '^\*| main$' |
       xargs -r git branch -d`. Safe: `-d` refuses if a branch has unmerged work, which is what
       you want.

    d. **Audit unmerged local branches** — for each remaining non-main branch, `git log --oneline
       main..<branch> | wc -l` says whether it has unique commits, and searching `main` for the
       same commit messages says whether those commits were squash-landed under a different SHA
       (common with `gh pr merge --squash`). Force-delete (`git branch -D`) any branch whose
       commits are all present on main under different SHAs, or whose PR was closed as
       superseded. Never force-delete a branch with genuinely stranded work — hand it to the user.

    e. **Prune remote branches** — `git branch -r` after the fetch. Any remote branch whose PR
       merged or closed but that survived (auto-delete off, or a manual push after merge) gets
       `git push origin --delete <branch>`.

    f. **Audit open PRs the assistant did not open this session** — `gh pr list --state open`.
       Any fleet-attempt PR older than the ADRs, spec revisions, or scope decisions made this
       session should be closed with a comment naming what superseded it, then its branch
       deleted (`gh pr close <n> --delete-branch --comment "..."`). If the assistant cannot
       tell whether an open PR is superseded, leave it and name it for the user.

12. **Re-run the end check** — `node ~/.claude/hooks/session-gate.js report --end --refresh` — and
    report the fresh result. Every STOP line must be resolved before the `Ready to archive` line
    is emitted.

If any step in 1–11 fails or is blocked for a reason the assistant cannot resolve, name the
blocker, list what IS done, and stop. Do NOT emit `Ready to archive` — the whole point of the
line is that seeing it means the user can archive without checking.

## Then close the loop (report interpretation)

**`STOP N uncommitted files`** — the work exists on one machine and nowhere else. Show
`git status --short`, then commit it (per step 1 above) or say explicitly what is being left
behind and why.

**`!! N commits not pushed`** — same risk, plus two consequences worth naming: CI has not run, so
any generated file (a dashboard, a coverage badge) is reporting stale numbers; and any commit SHA
quoted in an issue comment points at something nobody else can reach. Push per step 2.

**`STOP release gate FAILS`** — do not release. Say which gate and what it said.

**`!! tracker audit: N drift finding(s)`** — run it and check whether any are from this session.
Pre-existing findings are somebody else's; new ones are not. Fix your own before finishing.

**`!! cloud plugin is STALE`** (or `no upload recorded`) — the skills on this machine changed since
the plugin was uploaded to claude.ai, so every cloud container is still loading the old ones. The
report names what was added, changed or removed. Fixing it is a rebuild and a re-upload: run
`/update-cloud-plugin`, which rebuilds the zip, asks before touching the account, drives the upload,
verifies the row, and stamps the sweep. Leaving it stale is a fine answer for a throwaway edit — say
so rather than passing over the line in silence.

A `could not check` note is not a pass; it means the sweep could not read the tree or the stamp.

## The ticket sweep — nothing leaves the session uncaptured

The checks above audit the *tree*. This step audits the *conversation*, and it is not optional:
context dies with the session, and an item that lives only in a reply is gone the moment the
window closes. Do this before writing the wrap-up summary, not as part of it.

**Scour the whole conversation** — not just the last few turns — for work that was surfaced but
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
  where items go to be lost, and citing one is naming the burial site, not the ticket. A
  human-action item must additionally carry the `ready-for-human` label (or the project's
  equivalent) — the owner's queue is a label query, and an unlabeled ticket is invisible to it.
- **Not worth tracking** — say so and why, in one line. Silence is not this option.
- **Needs a ticket** — collect these and invoke **`/to-tickets`** in one batch, no confirmation
  needed when the user typed `/session-end` (that IS the confirmation). `/to-tickets` runs its
  own breakdown → approval → publish flow; let it handle the approval gate. Do not `gh issue
  create` ad hoc.

The wrap-up summary lists every new ticket by number (from `/to-tickets` output) so nothing is
named as "remaining" without a number next to it.

## Two things the script cannot check

**Did the push close an issue that should have stayed open?** A commit message containing `Fixes #N`
closes that issue the moment it reaches the default branch — including issues deliberately left open
because a box still needs a deploy or an owner's ruling. Verify the state of every issue the session
touched, and reopen with a reason. This has happened more than once.

**Are the acceptance boxes honest?** In a repo where closing means *verified*, a box needing a live
run stays unticked and the issue stays open, however finished the code is.

## If the session ends in a release

Order matters, and no step is skippable:

1. **Credential** — `node tools/clasp-auth.js` (or the project's equivalent). Alive *and* correctly
   scoped, not merely alive.
2. **Gates** — whatever `releaseGates` names, or the project's canary.
3. **Release** — from the main checkout only, never a worktree.
4. **Confirm** — read back what the deployed thing reports about itself, rather than assuming the
   push landed.

Then watch the first real piece of work through it.

## Related

- `/session-start`
- `/update-cloud-plugin` — closes a stale cloud plugin the sweep found
- `~/.claude/skills/session-check/cloud-plugin-sweep.js` — the sweep itself; `--stamp` after a
  verified upload, `--json` for tooling
- A project may have its own `docs/runbooks/session.md`
