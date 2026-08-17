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
no worktree left over, no surfaced item uncaptured. The reply MUST end with the exact line
`Ready to archive` (no punctuation, no bold, no extra words) so the user can hit archive
immediately. Passive wrap-up wording ("wrap up", "handing off") is NOT a standing OK — confirm
before landing shared-state actions in that mode.

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
9. **Clean up the worktree** — if the session ran in a git worktree and the branch has landed:
   `git worktree remove` refuses to remove the current worktree, so use the `ExitWorktree` tool
   (deferred; load via `ToolSearch` with `select:ExitWorktree`) to exit and remove it in one
   step. If `ExitWorktree` is unavailable, print the exact command the user should run from the
   main checkout: `git worktree remove <path>` (add `--force` only if the tree is unclean and the
   user OKs discarding).
10. **Re-run the end check** — `node ~/.claude/hooks/session-gate.js report --end --refresh` — and
    report the fresh result. Every STOP line must be resolved before the `Ready to archive` line
    is emitted.

If any step in 1–9 fails or is blocked for a reason the assistant cannot resolve, name the
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

For every item found, exactly one of three outcomes, stated explicitly:

- **Already tracked** — name the ticket number.
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
- A project may have its own `docs/runbooks/session.md`
