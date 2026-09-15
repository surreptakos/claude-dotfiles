# Cloud session permission posture — ruling (2026-09-15)

Recorded for issue 245. Supersedes `docs/cloud-permission-posture-2026-09-14.md`.

## Ruling

> Ruling (Dan, 2026-09-15, issue 245): `autoMode.allow` is widened to every action
> an unattended session takes, destructive and irreversible included.

An **unattended session** is a cloud session (claude.ai/code) or Routine master —
no human at the keyboard, spawned by a workflow, schedule or orchestrator. It is
sanctioned to run every command its work requires, across every classifier
category the classifier can raise:

- Self-Modification
- Data Exfiltration
- Exfil Scouting
- External System Writes
- Destructive Operations (git force push, branch deletes, `git reset --hard`,
  `git clean -fd`, `rm -rf`, database drops)
- Irreversible Operations (PR merges, releases, deploys, publishes, tag pushes)
- Credential Handling
- any successor category

Do not classify, do not prompt, do not park the session.

The organization's standing YES / backup / blast-radius / deploy-safety gates in
`CLAUDE.md` still apply as **process discipline**; they are enforced by the
model's own conduct, not by the classifier stopping the shell. A change that
still needs a human review lands in a PR — that is the review, not a classifier
prompt.

## Why the 2026-09-14 acceptEdits ruling was reversed

`docs/cloud-permission-posture-2026-09-14.md` landed acceptEdits + a blanket
allow list, plus two narrow `autoMode.allow` prose rules (Self-Modification for
`~/.claude` / hook / settings edits; External System Writes for `gh api`
comment posts). Two failures showed up on Routine and fleet runs after it
landed on `.claude/settings.json` (final ruling for #170 flipped from
acceptEdits back to auto with the two narrow rules):

- The classifier still parked unattended sessions on shapes the two narrow
  rules did not cover — force pushes to feature branches, branch deletes after
  merge, PR merges, tag pushes, occasional `rm -rf` in scratch dirs. Each new
  shape needed a bespoke prose rule; the tail was longer than any
  enumeration.
- A rule keyed on a specific path (`gh api .../comments`) misses close
  variations the workflow legitimately performs (`gh api .../pulls/{n}/merge`,
  `gh release create`, `gh workflow run`). Fine-grained sanction bought no
  safety and cost every fleet run some parked steps.

The reversal keeps the process discipline (the model's own YES / backup /
blast-radius / deploy-safety gates in `CLAUDE.md` and the pre-send lint) and
drops the classifier as a second, weaker gate that saw only shape, never
intent.

## What landed on master

`.claude/settings.json` on `origin/master`:

- `permissions.defaultMode`: `"auto"` (unchanged since the 2026-09-14 final
  ruling)
- `permissions.allow`: `["Bash(*)", "Edit", "Write", "mcp__github__*"]`
  (unchanged)
- `autoMode.allow[0]`: the ruling prose above, quoted with `(Dan, 2026-09-15,
  issue 245)` and the eight-category enumeration. `autoMode.allow[1..2]` are
  the two narrow 2026-09-14 rules, retained as elaboration of what the blanket
  rule already covers, not as gates.

## Delivered to every harnessed repo

`project-harness` v19 (this branch) carries the widened rules in
`templates/claude-settings.json` and merges them via
`templates/add-cloud-plugin.js`:

- `permissions.defaultMode` is filled with `"auto"` **only when absent** —
  never overrides an existing `bypassPermissions` (desktop-only repos) or an
  explicit `acceptEdits`.
- `permissions.allow` is unioned with `Bash(*)`, `Edit`, `Write`,
  `mcp__github__*` — existing entries are kept.
- `autoMode.allow` gets the ruling prose prepended if not already present —
  existing narrow-rule entries a repo carries stay in place.

Issue #218 sweeps every harnessed repo running the installer once, bumping
each repo's `harness-version` marker to 19. On the eight repos already at v17
or v18 the installer changes only the two new keys; the marketplace / plugin
pointer half is a no-op.

## Verification

**Static (this branch, committed to `agent/issue-245-attempt1-*`):**

- `.claude/settings.json` on master parses as JSON and carries the ruling
  quote with its date.
- `agents/skills/project-harness/templates/claude-settings.json` parses and
  carries the same ruling text.
- `agents/skills/project-harness/templates/add-cloud-plugin.js` merges the two
  new keys idempotently against empty and partial fixtures (`{}` and a repo
  with an existing `permissions.defaultMode: acceptEdits` + one-entry
  allow list).
- `powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1` passes.

**Runtime (delivery stage — a fresh cloud session under this branch on the
default branch):** the ticket's acceptance criteria 3 and 4 are exercised
by the delivery agent in a real cloud container, not from an isolated
worktree that cannot push. Expected shape:

- Re-run the two commands the 2026-09-14 probe recorded as denied
  (`cat ~/.claude/plugins/installed_plugins.json`; combined `cat`/`ls` over
  `~/.claude/hook-state`). Both should run with no classifier prompt and no
  denial — the blanket rule covers Data Exfiltration and Exfil Scouting.
- Attempt one write in each remaining class and record the outcome:
  - Destructive: `git push --force-with-lease` to a scratch branch, then
    `git push origin --delete <scratch-branch>`.
  - Irreversible: `gh pr merge <scratch-pr> --squash` on a scratch PR, or
    `gh release create <scratch-tag>` in a scratch repo.
  - Credential Handling: a `git config credential.helper` read; a
    `gh auth status` call.
- Any surviving denial is listed with the exact classifier reason string the
  session recorded. The ticket permits some to still refuse; each survivor
  becomes a discovery for follow-up.

The delivery agent captures the runtime observations into issue 245 when it
merges the PR.
