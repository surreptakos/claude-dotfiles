---
name: session-start
description: Re-print the start-of-session checks for a git project — the remote, uncommitted work, the deploy credential, tests, tickets. Use when that report has scrolled out of context, or with --refresh to re-run it after the tree has moved.
metadata:
  modified: '2026-09-16T04:38:45Z'
  previous-modified: '2026-09-14T21:42:38Z'
  revision: '3'
  content-sha: 2873bd2d1176
---

# Start a session

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

**The checks are a hook.** `~/.claude/hooks/session-gate.js start` runs on `SessionStart` and
injects the result before the first reply, so it happens whether or not anyone remembers this skill.
When the report is already in context, read it there and carry on: one posting per run is what the
hook buys.

Use this skill to see it again, or to re-run it after the tree has moved:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js
```

Prints the cached report (and says how old it is). Add `--refresh` to force a fresh run — worth it
after a pull, a long gap, or anything that touched the tree. If that hook file does not exist (a
cloud container with the skills but not the hooks), run the engine directly — same report, always
fresh: `node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js`.

Read-only: it fetches (which changes no files) and reports. Works in any git repo — everything is
either universal, auto-detected from files already present, or read from an optional
`.claude/session.json`. A project with none of that still gets the git checks.

## Then turn each line into a recommendation

**`STOP the remote has N commits you do not have`** — say it plainly and stop. Merging someone
else's work before writing code is easy; after is where conflicts come from. Show what landed
(`git log --oneline HEAD..<upstream>`) and say whether it looks like bot noise (a dashboard refresh
touching one generated file) or real work by a person, which deserves reading first.

**`STOP you are in a git WORKTREE`** — code work is fine; releasing from one publishes that tree
rather than main.

**`!! N uncommitted files`** — left from last time. Show `git status --short` and get a decision —
keep, commit or discard — before building on the tree.

**`self-deploying Apps Script project`** — the repo carries `gas.json` (or the cockpit's own endpoint):
a merge to the default branch is the deploy, the commit's `gas/deploy` status is the verdict, and no
clasp credential exists anywhere. Every AAC Apps Script repo has been on this since 2026-09-09; the
three clasp findings below only appear in a repo that still deploys with clasp.

**`!! clasp credential needs re-authorizing`** — deploys are blocked until someone re-authorizes in
a browser. If the project has `tools/clasp-auth.js`, run it: it prints the exact command. **Never
substitute a bare `clasp login`** — that authorizes clasp's own OAuth client with narrower default
scopes, and `~/.clasprc.json` is shared across projects, so it can silently break another repo while
this one keeps working.

**`!! no tools/clasp-auth.js`** — the credential refreshes but its scopes are unchecked. Worth
fixing before any release.

**`cloud container — no clasp credential is provisioned here`** — expected, and reported as a note.
Cloud containers carry no `~/.clasprc.json`, so deploys stay CI or local and the session carries on.

**`STOP harness vN is behind vM`** — the repo's `docs/agents/harness-version.md` says vN but
the `project-harness` skill on this machine has moved on to vM. Run `/project-harness` (upgrade
path, step 7 — machine-wide rather than per-repo). The check itself is read-only, so close an
out-of-date harness before writing code.

**`!! repo is not harnessed`** — neither `docs/agents/harness-version.md` nor
`scripts/build-dashboard.js` is present. Run `/project-harness`. Deliberate on a scratch repo: set
`"harness": false` in `.claude/session.json` to silence it.

**`note project-harness skill not available here`** — this machine or container has no
`project-harness` skill to compare against, so the harness version stays unchecked until one that
has it runs.

**`STOP tests FAIL`** — find out whether it was already broken before this session. `git stash` and
re-run, or check the last commit that touched the failing area.

**Tickets** — offer the ones that look actionable rather than reading the list out. When the user
picks one, read it **with its comments** (`gh issue view <n> --comments`): measurements and owner
decisions live in comments, and skipping them costs rework. No `gh` (cloud containers): read it
with the GitHub MCP tools (`issue_read` for the body, its comments method for the thread), or
`curl https://api.github.com/repos/<owner>/<repo>/issues/<n>/comments` — the session's egress proxy
authenticates api.github.com, private repos included. The engine lists tickets the same way when gh
is missing, so an empty Tickets section means none are open, not that the list could not be read.

## What it cannot tell you

Whether deployed code matches the repo. A clean tree and green tests say nothing about what is
running in production.

## Related

- `/session-end`
- A project may have its own `docs/runbooks/session.md` — read it if so
