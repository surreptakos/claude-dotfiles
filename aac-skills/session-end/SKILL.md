---
name: session-end
description: Land the session — commit, push, merge, file what was promised, re-run the end check — and end on the archive line. The checks already run as a hook when a turn reads as wrapping up; this is the sequence that clears them.
metadata:
  modified: "2026-09-18T06:07:06Z"
  previous-modified: "2026-09-18T06:00:51Z"
  revision: "18"
  content-sha: "d56df95c2eaf"
---

# Finish a session

Four steps. Typing `/session-end` is the standing OK for every one of them; passive wrap-up
wording ("wrap up", "handing off") asks before each shared-state action instead.

1. **Commit and push.** One commit that says what changed and why; never `--no-verify` (fix the
   hook failure and commit again). `git push -u origin <branch>` if there is no upstream.
2. **Open and merge the PR.** `gh pr create --base <default> --head <branch>` with a `Closes #N`
   line per issue the commits resolve, then `gh pr merge <n> --squash`. Branch protection,
   pending checks or a refused merge: say so and stop short of the archive line.
3. **File what was promised.** Read the conversation once for anything that will die with it: a
   thing the user deferred ("later", "after X"), a thing you offered and never did, a known limit
   you named, a question that got no answer, a step only the owner can take. Each is either
   already on an open ticket (name the number), not worth tracking (say why in one line), or a new
   ticket — publish those through `/to-tickets` in one batch. A line that hands work to someone
   without a `#number` in it is a ticket you have not filed yet.
4. **Re-run the end check** — `node ~/.claude/hooks/session-gate.js report --end --refresh` (or
   `node ~/.claude/skills/session-check/check.js --end` where the hook file is absent). It reads
   the tree, the pushed state and the last run of every tracker job (closure guard, board sweep,
   metadata audit, stale-ref sweep, tracker audit), so a red job shows up here as a line, not as a
   step. Resolve every `STOP`; a `!!` is a note unless it names this session's branch.

The reply ends with:

```
Landed: <PR or commit, one line each>
Filed:  #<n> <title> — ready-for-agent | ready-for-human   (or: none)
Next: archive this session
```

`Next: archive this session` is the last line, verbatim, and only when steps 1–4 are clear.

## Not this skill's job

The tracker jobs own the housekeeping a session used to narrate: reopening a ticket that a merge
closed with boxes unticked, moving closed cards to Done, assigning the single open milestone,
deleting landed `agent/*` and `claude/*` refs, auditing the tracker. Read their verdict in step 4;
do not re-run their queries by hand, and do not file `ready-for-local-agent` tickets for them.

A session deletes only its own branch after the merge (`git push origin --delete <branch>` if
`delete_branch_on_merge` did not; `git branch -d`, never `-D`). If the classifier refuses, the
stale-ref sweep takes it on its next run — say so in one line and file nothing.

`sweep-closed-to-done.js` in this directory is the board-sweep script the Actions job runs; it is
not a step here.

## In a cloud container

Same four steps. `gh pr` and `gh issue` are GraphQL and the proxy refuses them: step 2 uses the
GitHub MCP `create_pull_request` and `merge_pull_request`, step 3's tickets go through the same
`/to-tickets` batch with MCP `issue_write`, and `gh api repos/<owner>/<repo>/...` (REST) works
for everything else. Step 4 runs `node ~/.claude/skills/session-check/check.js --end` when the
hook file is absent. If the classifier refuses a bash `gh api --method POST|PATCH`, retry once,
then use the MCP tool for the same write.

## Related

- `/session-start`
- A project may have its own `docs/runbooks/session.md`
