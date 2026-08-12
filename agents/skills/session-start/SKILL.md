---
name: session-start
description: Start-of-session checks for any git project — fetch from the remote, report anything left over, verify the deploy credential, run the tests, and list open tickets. Use at the beginning of a session, when the user asks "what's the state", "where were we", "start a session", or before picking up a ticket.
---

# Start a session

```bash
node "$HOME/.agents/skills/session-check/check.js"
```

Read-only: it fetches (which changes no files) and reports. Works in any git repo — everything is
either universal, auto-detected from files already present, or read from an optional
`.claude/session.json`. A project with none of that still gets the git checks.

## Then interpret it — do not just paste the output

**`STOP the remote has N commits you do not have`** — say it plainly and stop. Merging someone
else's work before writing code is easy; after is where conflicts come from. Show what landed
(`git log --oneline HEAD..<upstream>`) and say whether it looks like bot noise (a dashboard refresh
touching one generated file) or real work by a person, which deserves reading first.

**`STOP you are in a git WORKTREE`** — code work is fine; releasing from one publishes that tree
rather than main.

**`!! N uncommitted files`** — left from last time. Show `git status --short` and ask whether to
keep, commit or discard. Do not build on a tree nobody has looked at.

**`!! clasp credential needs re-authorizing`** — deploys are blocked until someone re-authorizes in
a browser. If the project has `tools/clasp-auth.js`, run it: it prints the exact command. **Never
substitute a bare `clasp login`** — that authorizes clasp's own OAuth client with narrower default
scopes, and `~/.clasprc.json` is shared across projects, so it can silently break another repo while
this one keeps working.

**`!! no tools/clasp-auth.js`** — the credential refreshes but its scopes are unchecked. Worth
fixing before any release.

**`STOP tests FAIL`** — find out whether it was already broken before this session. `git stash` and
re-run, or check the last commit that touched the failing area.

**Tickets** — offer the ones that look actionable rather than reading the list out. When the user
picks one, read it **with its comments** (`gh issue view <n> --comments`): measurements and owner
decisions live in comments, and skipping them costs rework.

## What it cannot tell you

Whether deployed code matches the repo. A clean tree and green tests say nothing about what is
running in production.

## Related

- `$session-end`
- A project may have its own `docs/runbooks/session.md` — read it if so
