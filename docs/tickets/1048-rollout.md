# Issue 1048: the token-aware bootstrap hook in the nine harnessed repos

**Status:** five of nine delivered, four still on the v36 hook. Read on 2026-09-30 from each repo's
default branch through the REST contents API. Nothing on this page was simulated. Every row below
is an API read, and the commands to repeat it are under [Re-checking](#re-checking).

The v37 template, `aac-skills/project-harness/templates/session-start.sh` at claude-dotfiles
`e827969f` (issue 1047, PR 1120), is git blob **`3e3ef907`**. The v36 template it replaced, at
`72eca421`, is blob **`cbd35791`**. Every repo matches one or the other exactly, so no repo carries a
hand-edited hook, and each behind repo's upgrade is a straight overwrite.

## Where each repo stands

| Repo | Default branch | Hook path | Blob | Marker | Landed by |
| --- | --- | --- | --- | --- | --- |
| aac-bill-intake | main | `.claude/hooks/session-start.sh` | `3e3ef907` v37 | 37 | PR 739, `29d8afe7` |
| aac-message-board | main | `.claude/hooks/session-start.sh` | `3e3ef907` v37 | 37 | PR 25, `a4b83315` |
| aac-sales-commissions | master | `.claude/hooks/session-start.sh` | `3e3ef907` v37 | 37 | PR 126, `201be363` |
| aac-routines | main | `.claude/hooks/session-start.sh` | `3e3ef907` v37 | 37 | PR 656, `60195025` |
| aac-sales-cockpit | main | `.claude/hooks/session-start-bootstrap.sh` | `3e3ef907` v37 | 37 | PR 792, `23402336` |
| aac-contract-builder | main | `.claude/hooks/session-start.sh` | `cbd35791` v36 | 36 | not yet |
| brazil-flights | master | `.claude/hooks/session-start.sh` | `cbd35791` v36 | 36 | not yet |
| osh-rfp | main | `.claude/hooks/session-start.sh` | `cbd35791` v36 | 36 | not yet |
| zoho-source-of-truth | main | `.claude/hooks/session-start.sh` | `cbd35791` v36 | **34** | not yet |

The cockpit sidecar is the template byte for byte, so its "public repo" STOP wording is gone with
it. The template's clone-failure STOP names `BOOTSTRAP_DOTFILES_TOKEN` and says it no longer
claims the repo is public.

None of the four behind repos had an open PR or a branch for the upgrade when this page was read.
Their newest harness PRs are aac-contract-builder 386 (v36), brazil-flights 7 (v34 to v36), osh-rfp
87 (v36) and zoho-source-of-truth 211 (v34).

## What the four still need

Each one takes the harness upgrade path, project-harness section 7, in a session opened on that
repo. That path lands the change through the repo's own PR and merge and moves the marker with the
hook:

- **aac-contract-builder, brazil-flights, osh-rfp** (36 to 37): step 16,
  `node <skill>/templates/add-cloud-plugin.js <repo-root>`, rewrites the hook to blob `3e3ef907`.
  Then set the marker to `harness-version: 37`.
- **zoho-source-of-truth** (34 to 37): apply UPGRADES.md rows 35 and 36 first. Row 35 is the four
  governance plugins that `add-cloud-plugin.js` declares, and row 36 stages `.githooks/pre-commit`
  as 100755. Then apply row 37 as above. One `add-cloud-plugin.js` run covers rows 35 and 37.

A claude-dotfiles ticket-fleet worker cannot do this. Its rails allow one push, to its own branch
in claude-dotfiles, and no PR.

## Re-checking

Acceptance criteria 1 and 2 are met when every row reads `3e3ef907` and 37. For each repo, with
`sidecar` in the path for aac-sales-cockpit only:

```sh
gh api repos/surreptakos/<repo>/contents/.claude/hooks/session-start.sh --jq .sha
gh api repos/surreptakos/<repo>/contents/docs/agents/harness-version.md --jq .content | base64 -d | grep harness-version
git hash-object aac-skills/project-harness/templates/session-start.sh   # in claude-dotfiles: the blob to expect
```

Criterion 3 needs a claude.ai/code session on one of the nine repos. It must have
`BOOTSTRAP_DOTFILES_TOKEN` set in its environment and no claude-dotfiles source attached. Pass when
the session-check `Cloud bootstrap` block reads ok with the payload's full skill count. No
container on the desktop can show this. claude-dotfiles' own bootstrap gate,
`tests/bootstrap-test.sh --scenario token-clone`, covers the same hook body without a live token.
