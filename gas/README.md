# gas — Apps Script projects that deploy themselves from GitHub

No clasp. No Google credential in GitHub. No web app that answers the internet. One vendored file in the
script, one `gas.json` in the repo, one time trigger, and a CLI for the rest.

Built 2026-09-08 out of aac-sales-cockpit's ADR-0033 after a week of `CLASPRC_JSON` deaths across the AAC
repos. The cause of those deaths was one shared decision: every CI credential was minted from the private
OAuth client in `gpt-sheets-access-475817`, whose consent screen is in Testing, and Google expires every
refresh token issued by a Testing client after seven days. The published client that clasp itself ships
has no such clock. This package uses that client, stores its token inside each script, and never asks
CI to hold a Google credential at all.

## The model (pull mode)

```
GitHub                                   Apps Script (HEAD)
------                                   ------------------
CI test gate green
  -> moves refs/heads/deploy/test  ---->  gasDeployTick (every 5 min) sees the ref move
                                          pulls gas.json + the deployable set at that commit
                                          stamps GAS_DEPLOYED_SHA, writes HEAD, reads it back
                                          records "pending", commit status gas/deploy = pending
                                   <----  NEXT tick (now running the new code):
                                          own GAS_DEPLOYED_SHA == pending sha -> runs hooks.postDeploy
                                          commit status gas/deploy = success | failure, owner mailed on failure
promote.yml moves deploy/prod  -------->  once deploy/test verified that commit: one version of HEAD,
                                          PROD deployment moved to it, read back, gas/promote status
`gas run` pushes deploy/run  ---------->  runs gas-run.json {fn, args} on HEAD, gas/run status + comment
```

Why the verdict is one tick later: Apps Script runs a trigger on the deployment that created it, and the
execution that writes HEAD is still the previous build. The tick that follows is the first execution of
the new code, so it is the one that judges. That rule also means the tick trigger must be created from
the editor or from another HEAD trigger, never from a versioned web app (`gasEnsureTrigger_` says so).

An idle tick costs one GitHub call and no Google call. With the default five minutes that is under 300
UrlFetch calls a day against the account's 20,000. A deploy costs one call per deployable file plus
three; a promote costs three Apps Script API calls.

## Adopting it in a repo

1. **Config.** `node <claude-dotfiles>/gas/cli/gas.js init <repo> --script-id <id> --root-dir gas`
   writes `gas.json`. Set `include`/`exclude` if the defaults (`**/*.js`, `**/*.gs`, `**/*.html`,
   `appsscript.json`; tests and `node_modules` excluded) are wrong for the repo. Set `prod.deploymentId`
   if the repo has a versioned PROD deployment. Name a post-deploy hook if the repo has something to
   check (see Hooks). The library refuses a `gas.json` whose `scriptId` is not the script it runs in.
2. **Vendor.** `gas vendor <repo>` copies `SelfDeploy.js` into `rootDir`. Commit it. Upgrades are the
   same command; the file carries `GAS_SELF_DEPLOY_VERSION`.
3. **Manifest scopes.** The script's `appsscript.json` needs `script.external_request` (UrlFetch),
   `script.scriptapp` (the trigger), `drive` (reading the seed file), `userinfo.email` and a mail scope
   (`mail.google.com` or `script.send_mail`) for the owner mails. The AAC canonical block already has them.
4. **Seed.** Once per script:
   `gas seed <scriptId> --repo owner/name --github-token-env GAS_PAT` writes
   `gas-seed-<scriptId>.json` to Drive with the Google refresh token from `gas login` and the GitHub
   token. The script ingests it on its next tick and trashes the file. The GitHub token: a classic PAT
   with `repo`, or a fine-grained one with Contents read, Commit statuses write, and (for the run
   comments) Contents write, on the repos it deploys. One token can serve every script on the account.
5. **Trigger.** Once per script: open the editor and run `gasInstall()`. Or add `gasEnsureTrigger_()`
   to a trigger the project already has. Either creates `gasDeployTick`.
6. **First deploy by hand, if HEAD has never carried the library:** `gas push <scriptId> --dir <rootDir>
   --sha <commit>` writes HEAD from disk, stamped. After that, refs do it.
7. **Workflows.** Copy `gas/templates/deploy.yml` (and `promote.yml` if there is a PROD) into
   `.github/workflows/`, substitute the branch and the test command. They call this repo's reusable
   workflows, which need one setting on claude-dotfiles: Settings → Actions → General → Access →
   "Accessible from repositories owned by the user". The caller grants `contents: write` (to move the
   ref) and `statuses: read`.

Then a push to the default branch: tests, ref moved, and within about seven minutes a green or red
`gas/deploy` status on the commit, with the reason in the status description and in the owner's mail.

## Files the repo does not carry

`updateContent` replaces HEAD's whole file set, so a file that lives only on the script — a data file pushed
by hand and gitignored for what it holds, like aac-bill-intake's `GlData`, `AliasData`, `JobData` — would be
deleted by the first deploy. So a deploy that finds HEAD-only files **refuses**, names them in the commit
status and the mail, and records the commit as judged (no five-minute retry loop). Three ways out, in
`gas.json`: `"preserve": ["*Data"]` (names or globs against the Apps Script file name) carries matching
files over byte for byte on every deploy; deleting them from the script; or `"dropUnknown": true` for a
repo that is the whole truth. `gas init` prefills `preserve` with every HEAD-only name it can see, and
`gas push` applies the same rule (`--drop-unknown` is its escape). Nothing preserved is ever stamped or
rewritten; nothing unknown is ever deleted silently.

## Hooks

- `hooks.postDeploy`: a function in the project that the verifying tick calls. Throw to fail the deploy
  (the message becomes the status and the mail); return a short string to have it quoted in the status.
  aac-sales-cockpit's is the page smoke plus the pack publication plus the seat check.
- `hooks.notify`: `(subject, body, isFailure)`; replaces MailApp to the owner when the project has its
  own mail path. Subjects start with `[gas]`; failures get `[FAIL]` in front when MailApp sends them.
- `runnable`: the functions `deploy/run` may call. Empty means every function without a trailing
  underscore, except this library's own.
- `gasPromoteNow(reason)`: for a host's own promote policy (a Sunday guard, a Thursday promote) — one
  version, PROD moved, read back, same as a `deploy/prod` move.

## The CLI

```
node <claude-dotfiles>/gas/cli/gas.js <command>
```

| Command | What it does |
|---|---|
| `login [--paste]` | The one consent, per Google account. `--paste` for a machine no browser reaches: open the URL anywhere, paste the localhost URL it lands on. Writes `~/.config/gas/credentials.json`; `GAS_CREDENTIALS_JSON` in the environment overrides it (cloud sessions). |
| `import-clasprc [path]` | Take an existing clasp login. Warns when it belongs to a private client (the seven-day kind). |
| `whoami` | Account, client, scopes, expiry of the current access token. |
| `scripts` | Every Apps Script project in the account's Drive. |
| `seed <scriptId> --repo o/r --github-token-env NAME` | The Drive seed file. |
| `pull <scriptId> [--out dir] [--version N]` | HEAD (or a version) to disk. |
| `push <scriptId> --dir <rootDir> [--sha S]` | Disk to HEAD, stamped. Bootstrap and emergencies. |
| `versions`, `deployments <scriptId>` | The lists, with the 200 cap in the versions line. |
| `promote <scriptId> --deployment ID` | One version, deployment moved, read back. By hand. |
| `logs --project P [--minutes 60] [--filter F] [--all]` | Cloud Logging; `[gas]` lines by default. |
| `status <o/r>` | The three refs and the latest `gas/*` status on each. |
| `ref <o/r> deploy/test <sha> --wait 15` | Move a ref and wait for the verdict. What CI does. |
| `run <o/r> <fn> '[args]' --wait 10` | Run a function on HEAD through `deploy/run`; prints the result. |
| `vendor <repo>`, `init <repo> --script-id ID` | The two adoption steps. |

GitHub calls use `GITHUB_TOKEN` / `GH_TOKEN`, else `gh auth token`. Google calls go through the
credential above. Behind a proxy, set `HTTPS_PROXY` and, when the proxy re-signs TLS, `GAS_CA_FILE`.

## Running functions headlessly from an agent session

`gas run owner/repo functionName '["arg1", 2]' --wait 10`. The request is a commit on `deploy/run`; the
next tick runs it on HEAD and the result comes back as a commit status (first 140 characters) and a
commit comment (up to 60 KB), which the command prints. Latency is the tick interval. This replaces
`clasp run`, which could only ever work with a Testing-client token, and it works from a container that
cannot reach `script.google.com` at all, because everything goes through GitHub.

## What still needs a person

- The consent, once per Google account (`gas login`), and again only if the token is revoked (a
  password change on an account whose grants include Gmail, an explicit revocation, six months unused).
- Starting the tick, once per script. A project that already has a trigger needs no editor: add
  `gasEnsureTrigger_();` to that trigger's function and deploy; its next run installs the tick. Only a
  project with no trigger at all needs `gasInstall()` run from the editor.
- Authorizing a brand-new script the first time it runs, in its editor. No API grants a script's own
  OAuth consent; the canary needs this once, an already-running project never does.
- The GitHub token, once per account, and its rotation if it is ever revoked.
- Deleting versions by hand at the 200 cap. Only promotes create versions; the library warns at 180
  and refuses at 199.
- Re-authorizing a script in the editor when its manifest gains an OAuth scope. Google's rule for every
  deployment method.

## Gotchas, all paid for

- **A trigger runs the deployment that created it.** Create the tick from HEAD. A tick bound to a
  versioned deployment never runs the new code, and the library fails such a deploy after six looks with
  a message that says this.
- **The account's UrlFetch allowance is shared** by every project the owner runs (20,000 a day on a
  consumer account). A poller elsewhere on the account can starve a deploy; the tick then logs the quota
  error and tries again in five minutes without mailing.
- **HEAD (`/dev`) is served only to a signed-in user.** Nothing here relies on reaching it.
- **`ScriptApp.getService().getUrl()` is empty in a trigger.** The library never needs it.
- **Commit statuses are best-effort.** A GitHub token without statuses write still deploys; the record
  then lives only in the `GAS_STATE` Script Property and the log, and CI's wait times out. Give the
  token the permission.
- **The Cloud Logging read API has a small per-minute quota.** `gas logs` makes one call; a script that
  polls it should pause between calls.

## Layout

```
gas/lib/SelfDeploy.js      the vendored library (pull mode)
gas/cli/gas.js             the CLI
gas/templates/             gas.json, deploy.yml, promote.yml for a consuming repo
gas/tests/                 node --test gas/tests/*.test.js  (CI: .github/workflows/gas-tests.yml)
.github/workflows/gas-deploy.yml, gas-promote.yml   the reusable workflows repos call
aac-skills/gas-deploy/     the team skill: how an agent adopts, upgrades, runs, and diagnoses
```

Not synced to any machine by `sync.ps1`; this is repo tooling, reached by path.
