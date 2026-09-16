---
name: session-end
description: Re-print the end-of-session checks for a git project — whether anything is uncommitted or unpushed, whether tests and release gates pass, and whether the tracker is clean. The checks already run automatically when a turn reads as wrapping up; use this to see them again or to force a fresh run.
metadata:
  modified: "2026-09-16T00:26:01Z"
  previous-modified: "2026-09-15T22:52:50Z"
  revision: "4"
  content-sha: "bb8dbd74ec36"
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
check is the state of the tree *now*. If that hook file does not exist (a cloud container with the
skills but not the hooks), run the engine directly — same report, always fresh:
`node ~/.claude/skills/session-check/check.js --end`. If that path is missing too, the plugin did
not load (claude-dotfiles#157): clone `surreptakos/claude-dotfiles` and run
`marketplace/aac-skills/skills/session-check/check.js --end` from that clone, and say so in the report.

## When the user types `/session-end`: auto-drive to archive-ready

Typing `/session-end` explicitly is the user's standing OK for every land-and-clean action below.
The final state must be: nothing uncommitted, nothing unpushed, no unmerged PR from this session,
no orphan worktree, no stale local or remote branch whose work already landed on main, no
open fleet PR that has been superseded, no open issue without a milestone, no open issue
whose acceptance ledger is fully ticked — and no surfaced item uncaptured. The reply MUST end
with the exact line `Ready to archive` (no punctuation, no bold, no extra words) so the user
can hit archive immediately. Passive wrap-up wording ("wrap up", "handing off") is NOT a
standing OK — confirm before landing shared-state actions in that mode.

Sequence, none skippable when the user typed `/session-end` (in a cloud container, take each
step's `gh` spelling through the substitution table in the cloud section below):

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
   Dry-run without `--apply` first when unsure. Requires `gh auth refresh -s project`. Local
   machines only — it needs gh with project scope, and no cloud substitute exists (see the cloud
   section below): in a container, skip it with a stated reason and file or update a
   `ready-for-local-agent` ticket that names the skipped sweep — never a reply line.
7. **Batch surfaced items through `/to-tickets`** (see ticket sweep below). This is required, not
   optional. `/to-tickets` handles its own breakdown/approval/publish flow — invoke it once with
   all NEEDS-A-TICKET items collected during the sweep. Never `gh issue create` ad hoc. In a
   container where the plugin did not load and `/to-tickets` is uninvocable, read
   `marketplace/aac-skills/skills/to-tickets/SKILL.md` from a clone of `surreptakos/claude-dotfiles`
   and follow it by hand; the create call is then that skill's publish step, not ad hoc.
8. **Refresh tracker audit** — `node tools/tracker-audit.js` (or the project's equivalent). If the
   audit flags acceptance boxes on issues touched this session, tick them or record N/A with a
   justification before finishing.
9. **Audit issue metadata — every issue must live in a milestone, and no issue should sit
   open while all its acceptance boxes are ticked.** Two failure modes the tracker audit does
   not catch on its own; both surface with two `gh` queries the assistant runs here.

   **These checks resolve EVERY open issue that fails them, not just the ones this session
   touched.** "These checks" means the two in THIS step and no others: un-milestoned open
   issues, and open issues whose acceptance ledger has zero unticked boxes. The tracker
   audit's own findings are scoped differently — see the tracker-audit entry under *Then
   close the loop*, and read both before deciding what a given line obliges. `/session-end` is the housekeeping pass for the whole tracker — a pre-existing
   un-milestoned or delivered-but-open issue is a blocker the assistant fixes here, not a
   note handed back to the owner. Ruling 2026-08-31 after a `/session-end` reply routed five
   pre-existing hits back as questions ("which milestone for each?", "close, add box, or
   hold?"). Wrong. Read the body, pick the best-fit milestone from the open list, or convert
   prose bullets to `- [ ]` boxes. Only escalate when the body cannot be read from the tracker
   or the choice is genuinely between two open milestones with equal fit — and even then,
   act (pick one, note the alternative in a comment), do not hand back.

   a. **Un-milestoned open issues.** Every open issue must be assigned to a milestone — the
      milestone is what maps a ticket to a scope decision, and an un-milestoned ticket is
      invisible to the milestone view the owner works from. Run:
      ```bash
      gh issue list --state open --limit 1000 --json number,title,milestone \
        --jq '[.[] | select(.milestone == null) | {n: .number, t: .title}]'
      ```
      For each result: list open milestones with
      `gh api repos/OWNER/REPO/milestones --jq '.[] | select(.state == "open") | {n: .number, t: .title}'`,
      read the issue body, and assign the best-fit milestone with
      `gh issue edit <n> --milestone "<Milestone N — Title>"`. Ambiguity between two open
      milestones is resolved by picking the one whose title's scope decision most directly
      names the issue's subject; leave a one-line comment on the ticket if the second choice
      is close. Skip this check for repos that deliberately do not use milestones (state so
      out loud the first time it comes up in a session).

   b. **Delivered-but-open issues.** An open issue whose `## Done when` / `## Acceptance` /
      `## Acceptance criteria` section has zero unticked boxes is either finished-and-forgotten
      or held open on a signal that is not written down. Run this expression against `gh issue
      list --json number,title,body --jq <expr>` (jq strings need `\\[` for a literal `[`, and
      `scan()` must be wrapped in `[...]` before `length` because it streams matches by default):
      ```jq
      .[]
      | select(.body != null and (.body | test("(?m)^##+ (Done when|Acceptance criteria|Acceptance)$")))
      | select((.body | [scan("(?m)^[- \t*]*\\[ \\][ \t]")] | length) == 0)
      | {n: .number, t: .title}
      ```
      For each hit, do one of exactly three things — no fourth. **The frequent case is a
      prose-bullet acceptance (`- foo` instead of `- [ ] foo`), which reads as "zero unticked
      boxes" to the scanner even though the work has not started.** That is not a real
      delivered-but-open — convert the prose bullets to unchecked boxes in the SAME `/session-end`
      pass. `gh issue view N --json body --jq .body > body.md`, rewrite the Acceptance section's
      `- ` bullets to `- [ ] ` (leave `## Non-goals` / `## Evidence` / `## References` sections
      alone — those are prose lists, not acceptance), then `gh issue edit N --body-file body.md`.
      Re-run the scan to confirm zero hits before `Ready to archive`.
      - **Close** with a comment naming what proved each box, if the work genuinely landed
        this session or earlier.
      - **Add the missing box** to the body if a live-run, deploy, or owner sign-off is still
        required, OR if the Acceptance section is prose bullets that need converting to `- [ ]`
        boxes (see paragraph above; the two cases share a fix). A ticked ledger without a
        real acceptance box is dishonest — that pattern closed real issues prematurely before
        the tracker audit was written.
      - **Leave open and say why** in one line to the user, if the hold-open reason is
        genuine but not captured on the issue AND the box conversion above does not apply.

10. **Clean up the worktree** — if the session ran in a git worktree and the branch has landed:
   `git worktree remove` refuses to remove the current worktree, so use the `ExitWorktree` tool
   (deferred; load via `ToolSearch` with `select:ExitWorktree`) to exit and remove it in one
   step. If `ExitWorktree` is unavailable, print the exact command the user should run from the
   main checkout: `git worktree remove <path>` (add `--force` only if the tree is unclean and the
   user OKs discarding) **and** file a `ready-for-human` ticket carrying that exact command, since
   a printed command the session cannot run is a step it cannot finish.
11. **Sweep the repo's stale branches, worktrees, and PRs** — session cleanup runs beyond this
    session's own branch, because fleet attempts, prior sessions, and abandoned scratch trees
    accumulate silently and no built-in check surfaces them. The state to reach is: only `main`
    plus branches with active unmerged work; only worktrees currently in use; no open PR that has
    been superseded by later work.

    Do it in this order (all commands run from the main checkout — a worktree cannot delete its
    own branch and confuses `git branch --merged`):

    a. **List foreign worktrees.** `git worktree list` shows every worktree; anything except
       `main` and the current session's tree is a candidate for removal. For each, run
       `git -C <path> status --short` first; a clean tree is safe to `git worktree remove --force`,
       a dirty tree gets its diff shown to the user before removal. Windows quirk: PowerShell
       redirects can leave a `nul` file that blocks removal — `rm -rf <path>` clears it, then
       `git worktree prune -v` cleans up the metadata.

    b. **Fetch --prune** — `git fetch --prune origin` deletes local remote-tracking refs whose
       upstream is gone, so the merged-branch scan reflects reality.

    c. **Delete merged local branches** — `git branch --merged main | grep -vE '^\*| main$' |
       xargs -r git branch -d`. Safe: `-d` refuses if a branch has unmerged work, which is what
       you want.

    d. **Audit unmerged local branches** — for each remaining non-main branch, `git log --oneline
       main..<branch> | wc -l` says whether it has unique commits, and searching `main` for the
       same commit messages says whether those commits were squash-landed under a different SHA
       (common with `gh pr merge --squash`). Force-delete (`git branch -D`) any branch whose
       commits are all present on main under different SHAs, or whose PR was closed as
       superseded. Never force-delete a branch with genuinely stranded work: file it as a
       `ready-for-human` ticket naming the branch, its unique commits and why they look stranded,
       and quote that number in the reply. Handing it over in prose loses it.

    e. **Prune remote branches** — `git branch -r` after the fetch. Any remote branch whose PR
       merged or closed but that survived (auto-delete off, or a manual push after merge) gets
       `git push origin --delete <branch>`. In a cloud container where the proxy refuses the
       remote delete, file or update a `ready-for-local-agent` ticket naming the branches for a
       desktop session; do not leave the item in a reply.

    f. **Audit open PRs the assistant did not open this session** — `gh pr list --state open`.
       Any fleet-attempt PR older than the ADRs, spec revisions, or scope decisions made this
       session should be closed with a comment naming what superseded it, then its branch
       deleted (`gh pr close <n> --delete-branch --comment "..."`). If the assistant cannot
       tell whether an open PR is superseded, leave it open and file a `ready-for-human` ticket
       naming the PR, what it would collide with, and the evidence that is missing — not a line
       in the reply.

12. **Re-run the end check** — `node ~/.claude/hooks/session-gate.js report --end --refresh` — and
    report the fresh result. Every STOP line must be resolved before the `Ready to archive` line
    is emitted.

If any step in 1–11 fails or is blocked for a reason the assistant cannot resolve, name the
blocker, **file it as a ticket — `ready-for-agent` when another session can finish it,
`ready-for-human` when only the owner can — or as a comment on the ticket that already owns the
step** (rule below), list what IS done, and stop. Do NOT emit `Ready to archive` — the whole point of the
line is that seeing it means the user can archive without checking, and an unfiled blocker is a
step nobody will ever see again.

**"Blocked for a reason the assistant cannot resolve" is a narrow phrase, not a hedge.** A
pre-existing tracker hit (un-milestoned issue, prose-bullet acceptance, delivered-but-open
detected by the scanner) IS resolvable: read the body, pick the milestone, convert the
bullets to boxes. Handing those back as questions defeats the whole `/session-end` skill.
The blocker exception covers CI failures, protected-branch refusals, credentials the assistant
cannot mint, and choices requiring an owner ruling (values / risk tolerance / priorities) —
not tracker housekeeping that reading the body settles.

### Every step the session cannot finish becomes a ticket

Owner ruling 2026-09-15: nothing said in a session reply is seen. A step of the sequence that
this session cannot complete — blocked, unavailable in this environment, or refused — has
exactly one durable landing place, chosen before the reply is written:

- **A comment on the ticket that already owns the step**, when one exists — a discovery an open
  ticket already tracks goes there, naming the repo and the date, and files no new ticket.
- **A `ready-for-agent` ticket**, when another cloud session can finish it — a rebuild, an audit
  re-run, a follow-up edit.
- **A `ready-for-local-agent` ticket**, when only a desktop session can — the skipped board sweep
  (step 6), a live-tree edit plus `sync.ps1 -Mode push`, a remote branch delete the session proxy
  refuses, a command the container's auto-mode classifier blocks. Never `ready-for-human` for
  these: a desktop session runs them without the owner.
- **A `ready-for-human` ticket**, when only the owner can: stranded work to judge, a credential
  to mint, a UI action no API covers, a superseded-or-not call the session cannot make. The
  owner's queue is a label query, so an unlabelled ticket is invisible to it.

File new tickets through `/to-tickets` in the step-7 batch (comments go through `gh issue
comment`, or MCP `add_issue_comment` in a container), then quote every number in the wrap-up.
"Named it for the user" and "needs a local session" are not outcomes.

**A classifier-denied cleanup is one of these cases, not an exception.** In auto mode the
destructive-action classifier can refuse `git push origin --delete <branch>`, `git branch -D
<branch>` or `git worktree remove --force <path>` mid-sweep. Do not retry it and do not leave
the refusal sitting in the reply: file a `ready-for-local-agent` ticket carrying the exact command,
the branch or path, and the evidence that its work already landed (the squash SHA on `main`,
the merged PR number), so running it is read-and-paste for the owner.

## In a cloud container: same duties, different instruments

A cloud session (claude.ai/code, Cowork) has no `gh` — `CLAUDE_CODE_REMOTE_SESSION_ID` set in the
environment is the tell. Every step above still applies; only the tool changes. Do not report a
step as impossible because its `gh` spelling failed — use the equivalent:

| The sequence says | In a container use |
| --- | --- |
| `gh pr create` | GitHub MCP `create_pull_request` |
| `gh pr merge --squash --delete-branch` | MCP `merge_pull_request` (method squash), then `git push origin --delete <branch>` |
| `gh issue list --json … --jq …` | MCP `search_issues` (returns milestone) or REST `curl .../issues?state=open&milestone=none&per_page=100`; `list_issues` returned no milestone field in a cloud session on 2026-09-14 (claude-dotfiles#154 evidence), so it cannot drive step 9a |
| `gh issue edit <n> --milestone` | MCP `issue_write` (update) |
| `gh pr list --state open` | MCP `list_pull_requests` with `perPage` 30 or less — 100 overflows the tool-result limit and spills to a file |
| `gh pr close <n> --comment` | MCP `update_pull_request` (state closed) + `add_issue_comment`, then delete the branch with git |

Quick read-only checks can also go straight to REST — `curl
https://api.github.com/repos/<owner>/<repo>/...` — the session's egress proxy authenticates
api.github.com, private repos included. Git itself (push, fetch, branch delete) works normally
through the same proxy.

Three genuine differences. Each is said out loud **and filed** — a ticket, or a comment on the
ticket that owns the step (rule above); a container's missing instrument is the commonest way a
step ends up living only in the reply:

- **Step 6 (board sweep)** has no cloud substitute — the MCP has no ProjectsV2 tools. Skip it with
  a stated reason and file or update a `ready-for-local-agent` ticket that names the skipped sweep;
  never a reply line, and never `ready-for-human` — a desktop session can run it.
- **A repo tool that shells out to gh** (a tracker audit, typically) exits 2 in a container. Still
  not a pass: run the same audit through the MCP tools, or file/update a `ready-for-local-agent`
  ticket naming the tool that needs a desktop run.
- **The cloud-plugin staleness check** does not run in containers — the container IS the
  downstream copy. Nothing to do there.

MCP write calls (merge, close, edit) may raise a permission prompt; when the user typed
`/session-end`, that prompt is the confirmation, not a reason to skip the step.


## Then close the loop (report interpretation)

**`STOP N uncommitted files`** — the work exists on one machine and nowhere else. Show
`git status --short`, then commit it (per step 1 above) or say explicitly what is being left
behind and why.

**`!! N commits not pushed`** — same risk, plus two consequences worth naming: CI has not run, so
any generated file (a dashboard, a coverage badge) is reporting stale numbers; and any commit SHA
quoted in an issue comment points at something nobody else can reach. Push per step 2.

**`STOP release gate FAILS`** — do not release. Say which gate and what it said.

**`!! tracker audit: N drift finding(s)`** — run it and fix every finding, whatever session caused
it (Dan, 2026-09-10, after a session left three pre-existing dangling references standing under the
older "yours versus theirs" reading). The audit prints the fix beside each finding: qualify a bare
cross-repo `#N` as `owner/repo#N`, tick or justify an open box on a closed issue, add the missing
triage label. A finding that needs an owner ruling gets a `ready-for-human` ticket, not a pass.

**Scope.** Step 9's two checks and this rule together sweep the WHOLE tracker, origin irrelevant:
`/session-end` is the housekeeping pass, and a hit left for "the session that caused it" is a hit
the next session re-investigates from scratch. Advisories count too: a `landed-but-open?` line is
resolved by reading the named commit, then closing the issue or commenting on what is left (ruling
2026-09-02, after a session cleared only its own advisory and reported the other two as somebody
else's).

**`!! cloud plugin is STALE`** (or `no upload recorded`) — the skills on this machine changed since
the plugin was uploaded to claude.ai, so every cloud container is still loading the old ones. The
report names what was added, changed or removed. Fixing it is a rebuild and a re-upload: run
`/update-cloud-plugin`, which rebuilds the zip, asks before touching the account, drives the upload,
verifies the row, and stamps the sweep. Leaving it stale is a fine answer for a throwaway edit — say
so rather than passing over the line in silence.

A `could not check` note is not a pass; it means the sweep could not read the tree or the stamp.

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
7. **Human-action preconditions** — a step only the owner or another human can perform (a UI
   operation the API cannot do, a credential mint, a sign-off, a judgment call) that gates work
   this session produced or held. These hide better than the others because they feel "attached"
   to the PR or handoff they gate. Measured failure 2026-08-24: a PR's merge was gated on a
   49-choice Desk-UI rename that lived only in the PR's hold comment, the HANDOFF owner queue,
   and session replies — the owner found it only by asking "how would I have known?".

For every item found, exactly one of three outcomes, stated explicitly:

- **Already tracked** — name the ticket number. Tracked means an OPEN ISSUE ON THE TRACKER,
  nothing else: a PR body or comment, a HANDOFF/DECISIONS/FOLLOW-UPS line, or a session reply is
  where items go to be lost, and citing one is naming the burial site, not the ticket. A step
  a local session can perform must additionally carry the `ready-for-local-agent` label (or the
  project's equivalent); only a person's judgment, credential or sign-off carries `ready-for-human`.
  Each label drives a queue, and an unlabeled ticket is invisible to both.
- **Not worth tracking** — say so and why, in one line. Silence is not this option.
- **Needs a ticket** — collect these and invoke **`/to-tickets`** in one batch, no confirmation
  needed when the user typed `/session-end` (that IS the confirmation). `/to-tickets` runs its
  own breakdown → approval → publish flow; let it handle the approval gate. Do not `gh issue
  create` ad hoc.

### The wrap-up template

The reply that ends a `/session-end` pass has these parts, in this order:

```
Landed: <PR or commit, one line each>
Filed:  #<n> <title> — ready-for-agent | ready-for-human      (one line per ticket filed this pass)
        #<n> comment — <what was recorded on the ticket that already owns the step>
Left:   <nothing, or one line per item, each carrying a #number from the Filed block>
Ready to archive
```

Every ticket `/to-tickets` published this pass appears under `Filed:` by number, and so does
every comment landed on an owning ticket. `Filed:` is never omitted when empty — write
`Filed: none`, so a clean pass reads differently from a forgotten one.

**A line saying work is left for someone else — "needs you", "needs a local session", "for the
owner", "could not delete X", "hand this to" — is malformed unless a `#number` sits in it.** If
you are about to write one without a number, the ticket has not been filed yet: file it, then
write the line. `Ready to archive` is not emitted while any surfaced item exists only in the
reply.

## Two things the script cannot check

**Did the push close an issue that should have stayed open?** A commit message containing `Fixes #N`
closes that issue the moment it reaches the default branch — including issues deliberately left open
because a box still needs a deploy or an owner's ruling. Verify the state of every issue the session
touched, and reopen with a reason. This has happened more than once.

**Are the acceptance boxes honest?** In a repo where closing means *verified*, a box needing a live
run stays unticked and the issue stays open, however finished the code is.

## If the session ends in a release

Order matters, and no step is skippable:

1. **Credential** — none for a self-deploying repo (`gas.json`: the script holds its own and a merge
   is the release). A repo still on clasp: `node tools/clasp-auth.js` (or the project's equivalent),
   alive *and* correctly scoped, not merely alive.
2. **Gates** — whatever `releaseGates` names, or the project's canary.
3. **Release** — from the main checkout only, never a worktree.
4. **Confirm** — read back what the deployed thing reports about itself, rather than assuming the
   push landed.

Then watch the first real piece of work through it.

## Related

- `/session-start`
- `/update-cloud-plugin` — closes a stale cloud plugin the sweep found
- `~/.claude/skills/session-check/cloud-plugin-sweep.js` — the sweep itself; `--stamp` after a
  verified upload, `--json` for tooling
- A project may have its own `docs/runbooks/session.md`
