# Starting and finishing a session

Two commands, and the vocabulary to understand what they tell you.

With Claude, the checks are **hooks, not commands you have to remember**: `~/.claude/hooks/session-gate.js`
runs the start checks on `SessionStart` and the end checks as soon as a turn reads as wrapping up.
`/session-start` and `/session-end` re-print the result. Directly:

```bash
node ~/.claude/hooks/session-gate.js report           # starting (cached; --refresh re-runs)
node ~/.claude/hooks/session-gate.js report --end     # finishing
node ~/.claude/skills/session-check/check.js          # the engine, no caching
node ~/.claude/skills/session-check/check.js --end
```

Both are read-only. They fetch and report; they never commit, push, merge or deploy. Exit 0 means all
clear, exit 1 means something needs a decision.

The checker is shared across projects and auto-detects what a repo has — git, `npm test`,
`tools/clasp-auth.js`, `tools/tracker-audit.js`, `tools/canary.js`, the GitHub ticket list. Anything
it cannot detect here lives in `.claude/session.json`.

**Without that tooling the checks below are just git commands**, which is why they are written out
rather than only automated.

## The words, if you do not use git much

Your work lives in two places: this machine, and the remote (git calls it **origin**).

| | |
|---|---|
| **commit** | save a checkpoint *on this machine*. Nothing leaves it. |
| **fetch** | ask the remote what changed and download it, **without touching your files**. Always safe. |
| **pull** | fetch, *and* merge those changes into your files. Can conflict. |
| **push** | upload your commits to the remote. |

*"ahead 12, behind 22"* means you have 12 commits the remote does not, and it has 22 you do not.

## Starting

Run the check, then deal with what it says, worst first.

**Behind the remote?** Pull before writing code, not after. Merging someone else's work first is
easy; after you have written yours it is not. This is the check that earns the script: a session that
skips it discovers the divergence at push time, with all the work already done.

**Uncommitted files left over?** Look before building on top: `git status --short`.

**Deploy credential dead or unscoped?** Fix it before you need it, not at release time.

**Picking a ticket?** Read it *with its comments* (`gh issue view <n> --comments`). The comments are
not the body — measurements and decisions live there, and skipping them causes rework.

## Finishing

**Uncommitted or unpushed** — the work exists on one machine. Pushing also lets CI regenerate
whatever it owns (`DASHBOARD.md`), which otherwise reports stale numbers.

**Check what the push closed.** A commit message containing `Fixes #N` auto-closes that issue when it
reaches the default branch — including issues deliberately left open because a box still needs a
deploy or a ruling. Verify every issue the session touched, and reopen with a reason.

**Closing means verified, not merged.** A box needing a live run stays unticked and the issue stays
open, however finished the code is.

**File what outlives the session.** A finding you leave in a chat message is lost the moment the
session closes — the open question nobody owns, the contradiction found in passing, the thing that
needs a ruling. It goes on the tracker before you finish, with the evidence attached, or it did not
happen. File it with what you found, not just the question — the next reader has none of your
context, and a bare question gets closed as stale.

**Tracker drift** — `node tools/tracker-audit.js`. Exit 1 means it found something; exit 2 means it
could not audit, which is not a pass.

## Releasing

Nothing here deploys to a server. The release is the push to `origin/master`, because that is what a
new machine clones and restores from. In order, no skipping:

```powershell
.\sync.ps1 -Mode push -Commit "chore: sync"
powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1 -From origin
```

`-Commit` rather than your own `git commit`: a non-zero exit does not stop the next statement in a
PowerShell chain, so `sync.ps1 ; git commit` commits even when the secret guard failed.

Push from the **main checkout**. A worktree publishes that tree, not master.

**After any merge, regenerate before pushing.** `claude/`, `codex/`, `agents/` and `memory/` are
generated. Git will line-merge two machine snapshots into a file matching neither, and nothing fails
— the next machine simply restores something that was never on any machine. Run `sync.ps1 -Mode push`
on top of the merge and diff before committing.

Then run the restore test against `origin`, not against your working tree. The question is whether
what you pushed restores.
