---
name: session-start
description: Re-print the start-of-session check report (remote, uncommitted work, deploy credential, tests, tickets). Use when it has scrolled out of context, or with --refresh after the tree has moved.
metadata:
  modified: '2026-10-02T15:35:12Z'
  previous-modified: '2026-09-18T20:01:29Z'
  revision: '5'
  content-sha: 8a7f1e0ad448
---

# Start a session

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

**The checks are a hook.** The plugin's `session-gate.js start` runs on `SessionStart` and injects
the report before the first reply. When the report is already in context, read it there and carry
on: one posting per run is what the hook buys.

To see it again, or re-run it after the tree has moved:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js
```

It prints the cached report and its age; `--refresh` forces a fresh run, worth it after a pull, a
long gap, or anything that touched the tree. Where that hook file is absent, run the engine
directly, same report, always fresh: `node ${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js`. Both are
read-only: the run fetches and reports.

## Then turn each line into a recommendation

**`STOP the remote has N commits you do not have`** — say it plainly and stop. Merging someone
else's work before writing code is easy; after is where conflicts come from. Show what landed
(`git log --oneline HEAD..<upstream>`) and say whether it looks like bot noise (a dashboard refresh
touching one generated file) or real work by a person, which deserves reading first.

**`STOP you are in a git WORKTREE`** — code work is fine; releasing from one publishes that tree
rather than main.

**`!! N uncommitted files`** — left from last time. Show `git status --short` and get a decision —
keep, commit or discard — before building on the tree.

**`self-deploying Apps Script project`** — the repo carries `gas.json` (or the cockpit's own
endpoint): a merge to the default branch is the deploy, the commit's `gas/deploy` status is the
verdict, and no clasp credential exists anywhere. Every AAC Apps Script repo has been on this since
2026-09-09; the three clasp findings below appear only in a repo that still deploys with clasp.

**`!! clasp credential needs re-authorizing`** — deploys are blocked until someone re-authorizes in
a browser. If the project has `tools/clasp-auth.js`, run it: it prints the exact command. **Never substitute
a bare `clasp login`**: it authorizes clasp's own OAuth client with narrower default scopes, and
`~/.clasprc.json` is shared across projects, so it can silently break another repo while this one
keeps working.

**`!! no tools/clasp-auth.js`** — the credential refreshes but its scopes are unchecked. Worth
fixing before any release.

**`cloud container — no clasp credential is provisioned here`** — expected, a note: deploys stay CI
or local and the session carries on.

**`STOP harness vN is behind vM`** — the repo's `docs/agents/harness-version.md` says vN but this
machine's `project-harness` skill is at vM. Run `/project-harness` (its upgrade path, which is
machine-wide) and close the gap before writing code.

**`!! repo is not harnessed`** — neither `docs/agents/harness-version.md` nor
`scripts/build-dashboard.js` is present. Run `/project-harness`; on a deliberate scratch repo, set
`"harness": false` in `.claude/session.json` to silence it.

**`note project-harness skill not available here`** — nothing to compare against, so the harness
version stays unchecked until a machine that has the skill runs.

**`STOP tests FAIL`** — find out whether it was already broken before this session: `git stash` and
re-run, or check the last commit that touched the failing area.

**A line that prints a command** (`claude plugin update`, `claude plugin marketplace update`,
`git push`, `git status`) — run it in this turn and report the result. Relay only what needs the
owner: an app restart, a device code, a UI toggle. On 2026-09-18 three consecutive reports copied
`claude plugin update aac-skills` into chat instead of running it.

**Tickets** — offer the ones that look actionable rather than reading the list out. When the user
picks one, read it **with its comments** (`gh issue view <n> --comments`): measurements and owner
decisions live in comments, and skipping them costs rework. In a cloud container `gh issue` is
GraphQL, which the egress proxy refuses: read it with the GitHub MCP tools (`issue_read` for the
body, its comments method for the thread), or `curl
https://api.github.com/repos/<owner>/<repo>/issues/<n>/comments` (the proxy authenticates
api.github.com, private repos included). The engine reads tickets over REST, so an empty Tickets
section means none are open, not that the list could not be read.

## What it cannot tell you

Whether deployed code matches the repo. A clean tree and green tests say nothing about what is
running in production.

## Related

`/session-end`; a project's own `docs/runbooks/session.md`, if it has one — read it.
