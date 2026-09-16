# Issue 268: prune stale branches left by the 2026-09-15 fleet runs — decision + evidence

**Status (attempt 2, 2026-09-15):** Six branches originally identified.
Attempt 1 recorded the evidence in this file only; reviewer flagged that AC2
("outcome recorded on this issue") requires posting on the tracker, not a
repo doc. Attempt 2 posts the outcome table below as a comment on issue 268
and ticks AC2 + AC3 on the issue body. AC1 (branches removed from origin)
stays delivery-stage — `git push --delete` needs push permission the fleet
worker does not have.

Between attempts, `git fetch --prune origin` reported
`agent/issue-242-attempt1-wf_6aa99b19-w1` already gone from origin. Five
branches remain for the delivery-stage push pass.

Fetch reference: `git fetch --prune origin` on 2026-09-15 from
`agent/issue-268-attempt2-wf_6aa9c553-w2`.

## Branch dispositions

### 1. `agent/issue-242-attempt1-wf_6aa99b19-w1` — deleted already

Head of closed-unmerged PR #252. Issue 242 landed on master through PR #246
(merged 2026-09-15T20:01:11Z, from attempt 3). PR #252 is the earlier attempt.

```
$ git log --oneline origin/master..origin/agent/issue-242-attempt1-wf_6aa99b19-w1
8089ef2 fix(bootstrap): SessionStart line names the working slash-command spelling (issue 242)
```

One commit. Superseded by the range that landed via PR #246.
Absorbing PR: **#246 (MERGED)**. Attempt-2 fetch confirms the branch is no
longer on origin:

```
$ git fetch --prune origin
From https://github.com/surreptakos/claude-dotfiles
 - [deleted]         (none)     -> origin/agent/issue-242-attempt1-wf_6aa99b19-w1
```

### 2. `claude/pensive-lovelace-cnsa3n` — delete

Working branch of the session that produced PR #258 (fleet discoveries) and
PR #260 (git-env-leak test fix). Both merged 2026-09-15.

```
$ git log --oneline origin/master..origin/claude/pensive-lovelace-cnsa3n
(no output)
```

Zero commits ahead of master. Nothing to preserve. Absorbing PRs:
**#258 (MERGED)**, **#260 (MERGED)**.

### 3. `research/cloud-connectors-onedrive` — delete

One research note (`docs/research/cloud-connectors-onedrive.md`, 210 lines)
captured 2026-09-14 for issue #156. Issue #156 is CLOSED (2026-09-14T15:21:26Z).
The findings folded into spec #207 ("Spec: all sessions for all repos from
claude.ai/code containers"), which is OPEN and names #156 in its provenance
line: "Spec synthesised 2026-09-15 from the map's Destination, Notes and the
thirteen resolved child tickets (#155, #156, #157, #158, ...)".

```
$ git log --oneline origin/master..origin/research/cloud-connectors-onedrive
47ab987 docs(research): connectors and OneDrive from cloud containers (#156)
```

No PR was opened for this branch. Absorbing ticket: **#207 (spec, OPEN)**.

### 4. `research/cloud-container-capabilities` — delete

Research note for issue #155. Issue #155 CLOSED 2026-09-14T15:21:23Z. Folded
into spec #207 (see the same provenance line above; #155 is the first ticket
listed).

```
$ git log --oneline origin/master..origin/research/cloud-container-capabilities
7b1f0ee docs(research): cloud container capability inventory (#155)
```

No PR opened. Absorbing ticket: **#207 (spec, OPEN)**.

### 5. `research/cloud-plugin-determinism` — delete

Research note for issue #157. Issue #157 CLOSED 2026-09-14T15:21:28Z. Folded
into spec #207.

```
$ git log --oneline origin/master..origin/research/cloud-plugin-determinism
777203b docs(research): cloud plugin install determinism (#157)
```

No PR opened. Absorbing ticket: **#207 (spec, OPEN)**.

### 6. `research/cloud-routines-per-repo` — delete

Research note for issue #158. Issue #158 CLOSED 2026-09-14T15:21:31Z. Folded
into spec #207.

```
$ git log --oneline origin/master..origin/research/cloud-routines-per-repo
5af561d docs(research): one Routine per repo for cloud masters (#158)
```

No PR opened. Absorbing ticket: **#207 (spec, OPEN)**.

## Delivery-stage actions

A session with git push permission runs, for the five branches still on
origin (issue-242-attempt1 is already gone):

```
git push --delete origin claude/pensive-lovelace-cnsa3n
git push --delete origin research/cloud-connectors-onedrive
git push --delete origin research/cloud-container-capabilities
git push --delete origin research/cloud-plugin-determinism
git push --delete origin research/cloud-routines-per-repo
```

Then verifies `git branch -r` no longer lists any of the six, and closes
issue 268. AC2 and AC3 are handled by the tracker comment attempt 2 posts.
