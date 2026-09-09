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

<!-- HARNESS: this section is only meaningful for a repo that deploys. Delete it if this one does
     not. An Apps Script repo with gas.json deploys itself (the default since 2026-09-09); keep the
     first block. A repo that still deploys with clasp keeps the second. -->

**Self-deploying Apps Script (`gas.json`):** a merge to the default branch is the release.
`.github/workflows/deploy.yml` runs the suite (and the canary, if the repo has one), then moves the
`deploy/test` ref; the script's own five-minute tick writes itself, the next tick verifies, and the
commit is marked `gas/deploy` green or red. Confirm with `gas status owner/repo` rather than assuming;
`gas run owner/repo <fn> '[args]'` runs a function on the live script and prints the answer.

**Still on clasp (legacy):**

```bash
node tools/clasp-auth.js    # credential alive AND correctly scoped?
node tools/canary.js        # if the repo has one: does the code load and run?
clasp push                  # main checkout only, never a worktree
```

`clasp-auth.js` is the only correct way to re-authenticate. **Never hand-write a `clasp login`**: a
bare one authorizes clasp's own OAuth client with narrower default scopes, and `~/.clasprc.json` is
shared by every clasp project on the machine — so the result pushes fine here while silently dropping
scopes another repo depends on. The tool prints the exact command to paste; do not shorten it.
