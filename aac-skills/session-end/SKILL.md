---
name: session-end
description: Land the session — commit, push, merge, file what was promised, clear the end check — and end on the archive line. Use to wrap up or end a session, or to clear what the end-check hook flagged.
metadata:
  modified: "2026-10-02T15:39:17Z"
  previous-modified: "2026-09-30T23:23:36Z"
  revision: "21"
  content-sha: "f4fe7e99750a"
---

# Finish a session

Four steps. Typing `/session-end` is the standing OK for every one of them; passive wrap-up
wording ("wrap up", "handing off") asks before each shared-state action instead.

1. **Commit and push.** One commit that says what changed and why. A hook failure gets fixed and
   the commit made again; never `--no-verify`. `git push -u origin <branch>` if there is no
   upstream.
2. **Open, wait, merge, pull.** Complete when the PR reads MERGED and the main checkout's HEAD is
   the merge commit. Only a failing check, branch protection or a refused merge ends the session
   short of the archive line, named in one line.
   - `gh pr create --base <default> --head <branch>` with a `Closes #N` line per issue the
     commits resolve.
   - Wait for the checks: `gh pr checks <n> --watch --fail-fast` blocks until every check has a
     verdict (the Windows restore test takes about eight minutes; rerun the command when the tool
     timeout cuts it off). Pending checks are a wait, never a stop (Dan, 2026-09-30, after a
     session ended on "10 of 12 checks green, merge waits on CI").
   - Every check green: `gh pr merge <n> --squash`, then on the anchor PC `git -C <main checkout>
     pull --ff-only` so the scheduled task and the desktop routines run the merged code.
   - The session deletes only its own branch: `git push origin --delete <branch>` if
     `delete_branch_on_merge` did not, and `git branch -d` (never `-D`). If the classifier
     refuses, say in one line that the stale-ref sweep takes it on its next run, and file nothing.
3. **File what was promised.** Read the conversation once for anything that will die with it: a
   thing the user deferred ("later", "after X"), a thing you offered and never did, a known limit
   you named, a question that got no answer, a step only the owner can take. Each is either
   already on an open ticket (name the number), not worth tracking (say why in one line), or a new
   ticket — publish every one through `/to-tickets` in one batch, reaper group included, with no
   approval round: `/session-end` is the approval (Dan, 2026-09-23). The weekly reaper parks what
   should not have been filed. A line that hands work to someone without a `#number` in it is a
   ticket you have not filed yet.
4. **Re-run the end check and clear it** — `node ~/.claude/hooks/session-gate.js report --end
   --refresh` (or `node ~/.claude/skills/session-check/check.js --end` where the hook file is
   absent). It reads the tree, the pushed state and the last run of every tracker job (below).
   Resolve every `STOP` and every `!!`, advisories included, whichever session or job raised them
   (Dan, 2026-09-23): assign the milestone, reword the stale citation, rebuild or stamp the plugin,
   then re-run the job or the check until the line is gone. What a job flags and leaves red is
   cleared here, never handed off as a `ready-for-local-agent` ticket. The only lines left standing
   are the ones no action in this session can change (the worktree `STOP`), each named in one line.

The reply ends with:

```
Landed: <PR or commit, one line each>
Filed:  #<n> <title> — ready-for-agent | ready-for-human   (or: none)
Next: archive this session
```

`Next: archive this session` is the last line, verbatim, and only when steps 1–4 are clear.

## The tracker jobs

Closure guard, board sweep, metadata audit, stale-ref sweep and tracker audit run on their own:
they reopen a ticket a merge closed with boxes unticked, move closed cards to Done, assign the
single open milestone, delete landed `agent/*` and `claude/*` refs, and audit the tracker.
`sweep-closed-to-done.js` in this directory is the board-sweep job's script, not a step here.

## In a cloud container

Same four steps. `gh pr` and `gh issue` are GraphQL and the proxy refuses them: step 2 uses the
GitHub MCP `create_pull_request` and `merge_pull_request`, step 3's tickets go through the same
`/to-tickets` batch with MCP `issue_write`, and `gh api repos/<owner>/<repo>/...` (REST) works
for everything else. If the classifier refuses a bash `gh api --method POST|PATCH`, retry once,
then use the MCP tool for the same write.

## Related

`/session-start`; a project's own `docs/runbooks/session.md`, if it has one.
