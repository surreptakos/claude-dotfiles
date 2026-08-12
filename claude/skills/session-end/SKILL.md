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

## Then close the loop

**`STOP N uncommitted files`** — the work exists on one machine and nowhere else. Show
`git status --short`, then commit it or say explicitly what is being left behind and why.

**`!! N commits not pushed`** — same risk, plus two consequences worth naming: CI has not run, so
any generated file (a dashboard, a coverage badge) is reporting stale numbers; and any commit SHA
quoted in an issue comment points at something nobody else can reach. Offer to push.

**`STOP release gate FAILS`** — do not release. Say which gate and what it said.

**`!! tracker audit: N drift finding(s)`** — run it and check whether any are from this session.
Pre-existing findings are somebody else's; new ones are not.

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
- **Needs a ticket** — collect these and run them through **`/to-tickets`** as one batch:
  present the breakdown with blocking edges, get approval, publish. Do not `gh issue create`
  ad hoc — the publish gate will (correctly) block a second issue without an approval step,
  and one-off issues skip the edge-declaration that makes the frontier query work.

Only after the sweep is empty may the wrap-up summary be written. A summary that names
"remaining items" without ticket numbers next to them is the failure this section exists
to prevent.

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
