---
name: session-end
description: End-of-session checks for any git project — confirm nothing is uncommitted or unpushed, tests and release gates pass, and the tracker is clean. Use when finishing work, when the user says "wrap up", "done for now", "anything left", or before handing off.
---

# Finish a session

```bash
node "$HOME/.agents/skills/session-check/check.js" --end
```

## Then close the loop

**`STOP N uncommitted files`** — the work exists on one machine and nowhere else. Show
`git status --short`, then commit it or say explicitly what is being left behind and why.

**`!! N commits not pushed`** — same risk, plus two consequences worth naming: CI has not run, so
any generated file (a dashboard, a coverage badge) is reporting stale numbers; and any commit SHA
quoted in an issue comment points at something nobody else can reach. Offer to push.

**`STOP release gate FAILS`** — do not release. Say which gate and what it said.

**`!! tracker audit: N drift finding(s)`** — run it and check whether any are from this session.
Pre-existing findings are somebody else's; new ones are not.

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

- `$session-start`
- A project may have its own `docs/runbooks/session.md`
