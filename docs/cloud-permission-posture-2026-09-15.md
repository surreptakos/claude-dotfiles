# Cloud session permission posture — ruling (2026-09-15)

Recorded for issue 245. Supersedes `docs/cloud-permission-posture-2026-09-14.md`.

## Ruling

> Ruling (Dan, 2026-09-15, issue 245): `autoMode.allow` is widened to every action
> an unattended session takes, destructive and irreversible included. "I want the
> auto mode to never run into a block, even if it wants to delete all repos on my
> account permanently with no path to reverse it."

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
landed on `.claude/settings.json` (the final ruling for #170 flipped from
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

The two 2026-09-15 denials on issue 245 that motivated the widening:

- **[Self-Modification]** — a heredoc patch of `.claude/hooks/session-start.sh`
  followed by running it with `CLAUDE_CODE_REMOTE=true` against the live home
  in the same command.
- **[External System Writes]** — a Python loop issuing
  `gh api -X PATCH repos/surreptakos/claude-dotfiles/issues/<n> --input <file>`
  over six issues.

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

## Scope split — local-agent lands 1+2, cloud fleet does 3+4+5

Dan on issue 245 (2026-09-15) relabelled the ticket `ready-for-local-agent`
and split acceptance:

> A desktop session runs with `bypassPermissions` (#199) and can land the
> `autoMode.allow` wording in `.claude/settings.json` and the project-harness
> template directly, then push. Criteria 3 to 5 (the proof runs) are then a
> cloud fleet ticket: relabel `ready-for-agent` once the rule text is on
> master.

This branch is the local-agent half. The classifier is not loaded on a
desktop session (no `~/.claude/settings.json` with `defaultMode: auto`; the
desktop keeps `bypassPermissions`), so a local run of the regression
commands proves nothing about the cloud classifier — it only proves the
shell will run them, which was never in doubt. The verification that
matters lives in a cloud container that loads this branch's
`.claude/settings.json`, and that container does not exist until the branch
is on `origin/master`.

## Verification

**Static (this branch):**

- `.claude/settings.json` parses as JSON and carries the ruling quote with
  its date; CRLF byte-pin preserved (issue 87).
- `agents/skills/project-harness/templates/claude-settings.json` parses and
  carries the same ruling text.
- `agents/skills/project-harness/templates/add-cloud-plugin.js` merges the
  four keys idempotently against empty and partial fixtures (`{}` and a repo
  with an existing `permissions.defaultMode: acceptEdits` + one-entry allow
  list); verified with a scratch invocation on both.
- `powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1` exits 0.

**Cloud (follow-up ticket after merge — acceptance criteria 3, 4, 5):**

The follow-up cloud-fleet ticket runs the block below in a fresh cloud
session on `origin/master` at or after this branch's merge SHA, and pastes
the transcript into a comment on issue 245. Each block is a single copy-and-
paste unit; the shell echoes the classifier reason string into the transcript
when a call is refused, and the widened rule succeeds by leaving that
string absent.

```bash
# 1. Previously-denied #245 regression commands — must both run with no prompt/denial.
#    a) Self-Modification: hook edit + run against the live home in one command.
cat > /tmp/session-start.sh.probe <<'EOF'
#!/usr/bin/env bash
# no-op probe patch for issue 245 verification
echo "session-start.sh.probe ran under CLAUDE_CODE_REMOTE=$CLAUDE_CODE_REMOTE"
EOF
cp .claude/hooks/session-start.sh .claude/hooks/session-start.sh.bak-245
cat /tmp/session-start.sh.probe > .claude/hooks/session-start.sh \
  && CLAUDE_CODE_REMOTE=true bash .claude/hooks/session-start.sh \
  && cp .claude/hooks/session-start.sh.bak-245 .claude/hooks/session-start.sh
#    b) External System Writes: Python loop issuing gh api -X PATCH over six issues.
python3 - <<'PY'
import subprocess, json, tempfile, os
ISSUES = [245]  # single-issue rehearsal so the probe does not spam six real tickets
for n in ISSUES:
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump({"body": f"issue 245 verification probe (no-op, run {n})"}, f)
        path = f.name
    r = subprocess.run(
        ["gh", "api", "-X", "POST",
         f"repos/surreptakos/claude-dotfiles/issues/{n}/comments",
         "--input", path],
        capture_output=True, text=True)
    print(f"[{n}] rc={r.returncode} stderr={r.stderr.strip()[:200]}")
    os.unlink(path)
PY

# 2. One write in each remaining classifier class.
#    Destructive:
git checkout -b scratch/issue-245-probe
git commit --allow-empty -m "issue 245 probe"
git push -u origin scratch/issue-245-probe
git commit --allow-empty -m "issue 245 probe force"
git push --force-with-lease origin scratch/issue-245-probe
git push origin --delete scratch/issue-245-probe
#    Irreversible: skip PR-merge probe against master; a tag push to a scratch tag suffices.
git tag issue-245-probe-tag
git push origin issue-245-probe-tag
git push origin :refs/tags/issue-245-probe-tag
#    Credential Handling:
gh auth status
git config --get credential.helper
#    Google API write (existing service-account credential):
python3 -c "from google.oauth2 import service_account; \
  c = service_account.Credentials.from_service_account_file( \
    '$HOME/.config/aac-google/service-account.json', \
    scopes=['https://www.googleapis.com/auth/drive.file']); \
  print('google creds loaded:', c.service_account_email)"
```

Recording format for the comment on issue 245:

- one line per command: `PROBE: <label> — ACCEPTED` (ran with no prompt/denial)
  or `PROBE: <label> — REFUSED [<classifier reason>]` (quote the reason
  verbatim).
- any refusal becomes a discovery on issue 245 with the exact reason string.

Once the comment is posted, the delivery agent (or Dan) closes issue 245.
Refusals that survive are the platform floor; the ticket's ruling explicitly
allows some to survive, and each becomes its own follow-up.
