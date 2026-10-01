# Issue 1048: the token-aware bootstrap hook in the nine harnessed repos

**Status on 2026-09-30:** seven of nine on their default branch. brazil-flights has the upgrade on
a pushed branch that waits for its PR. osh-rfp still needs its upgrade commit. Every row is a REST
contents-API read of the default branch; [Re-checking](#re-checking) repeats them.

The v37 template, `aac-skills/project-harness/templates/session-start.sh` (issue 1047), is git blob
**`3e3ef907`**. The v36 template it replaced is blob **`cbd35791`**. Every repo matches one or the
other exactly, so no repo carries a hand-edited hook and each upgrade is a straight overwrite.

| Repo | Default branch | Hook path | Blob | Marker | Landed by |
| --- | --- | --- | --- | --- | --- |
| aac-bill-intake | main | `.claude/hooks/session-start.sh` | `3e3ef907` | 37 | PR 739, `29d8afe7` |
| aac-message-board | main | `.claude/hooks/session-start.sh` | `3e3ef907` | 37 | PR 25, `a4b83315` |
| aac-sales-commissions | master | `.claude/hooks/session-start.sh` | `3e3ef907` | 37 | PR 126, `201be363` |
| aac-routines | main | `.claude/hooks/session-start.sh` | `3e3ef907` | 37 | PR 656, `60195025` |
| aac-sales-cockpit | main | `.claude/hooks/session-start-bootstrap.sh` | `3e3ef907` | 37 | PR 792, `23402336` |
| aac-contract-builder | main | `.claude/hooks/session-start.sh` | `3e3ef907` | 37 | PR 388, `1cd7c5bf` |
| zoho-source-of-truth | main | `.claude/hooks/session-start.sh` | `3e3ef907` | 37 | PR 220, `fa2e8c2c` |
| brazil-flights | master | `.claude/hooks/session-start.sh` | `cbd35791` | 36 | branch below, no PR yet |
| osh-rfp | main | `.claude/hooks/session-start.sh` | `cbd35791` | 36 | not yet |

The cockpit sidecar is the template byte for byte, so its "public repo" STOP wording is gone. The
template's clone-failure STOP names `BOOTSTRAP_DOTFILES_TOKEN` instead.

## brazil-flights: on a branch

Branch `agent/issue-1048-attempt3-wf_6abd9a98-w11`, commit `4cba8f88`, one commit on `master`.
It is the harness upgrade path, project-harness section 7, row 37:
`node templates/add-cloud-plugin.js <repo>` rewrote the hook to blob `3e3ef907` at mode 100755.
It reported `.claude/settings.json` already carried the plugin, the posture and the SessionStart
hook, so that file is unchanged. The marker went from 36 to 37. The repo's pre-commit gate ran and
passed (21 tests). Open its PR and merge it to finish the row.

## osh-rfp: not yet

The same two-file change was made, but the commit was not. The repo's pre-commit gate
(`python3 tools/verify-all.py`) fails on this Windows desktop with 57 passed, 4 failed. It fails
the same way on an untouched clone of `main`, so the upgrade is not the cause:

- The two "Rerun reproduces committed out/" checks find float-rounding differences in the
  regenerated model outputs. The outputs on `main` were made under a different Python or
  platform.
- The two "Page parity" checks fail with `[WinError 2]`. `checks.py` runs
  `subprocess.run(['npm', 'root', '-g'])`, and Windows only finds that as `npm.cmd`.

The commit was not forced past the gate. To finish it, run section 7 row 37 from a session opened
on osh-rfp, where the gate passes (its v36 bump, PR 87, came from a cloud session). Then
`node <skill>/templates/add-cloud-plugin.js <repo-root>` and set the marker to
`harness-version: 37`. A ticket-fleet worker in claude-dotfiles cannot open or merge a PR.

## Re-checking

Criteria 1 and 2 are met when every row reads `3e3ef907` and 37. For each repo (on
aac-sales-cockpit the file is `session-start-bootstrap.sh`):

```sh
gh api repos/surreptakos/<repo>/contents/.claude/hooks/session-start.sh --jq .sha
gh api repos/surreptakos/<repo>/contents/docs/agents/harness-version.md --jq .content | base64 -d | grep harness-version
git hash-object aac-skills/project-harness/templates/session-start.sh   # in claude-dotfiles: the blob to expect
```

Criterion 3 needs a claude.ai/code session on one of the nine repos with `BOOTSTRAP_DOTFILES_TOKEN`
set in its environment and no claude-dotfiles source attached. It passes when the session-check
`Cloud bootstrap` block reads ok with the payload's full skill count. A desktop cannot show this.
claude-dotfiles' bootstrap gate, `tests/bootstrap-test.sh --scenario token-clone`, covers the same
hook body without a live token.
