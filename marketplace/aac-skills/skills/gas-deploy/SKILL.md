---
name: gas-deploy
description: AAC Apps Script deploys with gas instead of clasp. Use when a repo's clasp credential died or it should move off clasp (adopt gas), to deploy the script, promote PROD or run a function on it, or when a gas/deploy or gas/promote status is red.
metadata:
  modified: '2026-09-25T23:18:11Z'
  previous-modified: '2026-09-16T04:44:25Z'
  revision: '3'
  content-sha: 61b34ed0c34e
---

# gas-deploy

The package lives in `claude-dotfiles/gas/`: a vendored `SelfDeploy.js`, `deploy/*` refs on
GitHub, one time trigger. `gas/README.md` is the reference; read it once. Every command below is
`node <claude-dotfiles>/gas/cli/gas.js …`, written `gas …` here.

## Which job is this? Decide first

- **A repo still on clasp, or its `CLASPRC_JSON` just died** → Adopt (below). Adopting retires that
  secret instead of re-minting it: the seven-day death belongs to the client, not the token.
- **A red `gas/deploy` or `gas/promote` status, or CI's wait timed out** → Diagnose.
- **"Run X on the script"** → `gas run owner/repo X '[args]' --wait 10`. The result prints; the function
  ran on HEAD. Latency is the tick (five minutes).
- **"Promote PROD now"** → dispatch the repo's `promote.yml` (freeze guard applies), or `gas ref
  owner/repo deploy/prod <sha> --wait 20` for a commit `deploy/test` already verified.

## Adopt (once per repo)

1. `gas whoami`. No credential → `gas login` (in a cloud container: `gas login --paste`, hand the URL to
   the owner, paste back the localhost URL). `gas login` rather than `clasp login`: the latter mints the
   machine-wide credential `aac-google-access` guards, and is the wrong client for anything CI-shaped.
2. `gas init <repo> --script-id <id> --root-dir <dir>`; edit `gas.json`: `include`/`exclude` (mirror the
   repo's `.claspignore`), `prod.deploymentId` if there is a PROD, `hooks.postDeploy` if the project has
   something to check (write that function in the project: throw on a bad deploy, return a one-line
   summary on a good one), and **`preserve`**: init prefills it with every file HEAD holds that the repo
   does not (hand-pushed, gitignored data files). Keep the ones the script needs; a deploy that would
   delete an unlisted one refuses, by design. `gas pull <id>` and a CR-stripped diff against `rootDir`
   shows what else differs — a repo ahead of its script means the first push is a real release.
3. `gas vendor <repo>`; commit `gas.json` and `<rootDir>/SelfDeploy.js`.
4. Manifest scopes: `script.external_request`, `script.scriptapp`, `drive`, `userinfo.email`, a mail
   scope. The AAC canonical block has them all.
5. `gas seed <scriptId> --repo owner/name --github-token-env GAS_PAT` (the owner supplies the PAT once;
   classic `repo`, or fine-grained Contents read + Commit statuses write + Contents write for run comments).
6. Ask the owner to run `gasInstall()` once in the editor — or, if the project already has a trigger
   that runs HEAD, add `gasEnsureTrigger_();` to it and let the next run install the tick. Say which.
7. If HEAD has never carried the library: `gas push <scriptId> --dir <rootDir> --sha <commit>`.
8. Copy `gas/templates/deploy.yml` (and `promote.yml`) into `.github/workflows/`, substitute the branch
   and the test command. Delete the clasp workflows and the `CLASPRC_JSON` secret's readers. Remove
   `tools/clasp-auth.js` and the `clasp-auth` release gate from `.claude/session.json` if present.
9. Note in the repo's CLAUDE.md: the script deploys itself from `deploy/test`; `gas run` replaces
   `clasp run`; `gas logs --project <gcp>` replaces `clasp logs`.
10. Prove it: push a commit, then `gas status owner/repo` until `deploy/test` shows `success`, and
    read the status description alongside the colour. Adopt is done when that status is green
    for the pushed commit.

## Diagnose

- `gas status owner/repo` — the three refs and the latest status on each, with its description.
- `gas logs --project gpt-sheets-access-475817 --minutes 60` — the `[gas]` lines. `--all` for everything.
- No status at all after the wait → the tick trigger is not installed, or the seed was never ingested
  (`[gas] no GAS_REPO property` in the log), or the GitHub token cannot write statuses.
- `could not be verified … bound to a versioned deployment` → the trigger was created from a web app.
  `gasUninstall()` then `gasInstall()` from the editor.
- `Service invoked too many times for one day: urlfetch` → another project on the account spent the
  allowance; the tick retries in five minutes and mails nothing. Find the spender (Cloud Logging shows
  it) rather than waiting it out.
- `Google token refresh failed … re-seed` → the refresh token was revoked (password change, explicit
  revocation, six months unused). `gas login` then `gas seed` again.
- `promote refused: … of 200 versions` → the owner deletes old versions in the editor's project history.

## Hard rails

- **The only secret this design puts in GitHub is `GAS_PAT`.** Google credentials stay out of the
  repo and out of Actions, whichever client minted them.
- **The tick trigger is installed from the editor** (`gasInstall()`), so it runs HEAD. One created
  from a versioned deployment's execution is the `bound to a versioned deployment` failure above.
- **`SelfDeploy.js` is edited at source** — `claude-dotfiles/gas/lib/SelfDeploy.js`. Run its tests
  (`node --test gas/tests/*.test.js`), bump `gas/VERSION`, then `gas vendor` in each repo; the copy
  in a repo is output.
