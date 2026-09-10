---
name: update-cloud-plugin
description: Rebuild and republish the aac-skills plugin (the single package built from ~/.claude/skills plus the repo aac-skills/ tree) when the session-end sweep reports drift. Marketplace push is the primary channel; zip upload is the fallback for claude.ai Skills pages. Use when the session-end cloud-skills sweep reports drift or no recorded upload, when the user says the cloud sessions are missing a skill, or after adding or editing a skill that should reach claude.ai/code and Cowork.
---

# Update the cloud plugin

**Since 2026-08-31 evening there is ONE plugin: `aac-skills`** — Dan's personal set
from `~/.claude/skills` plus the AAC team skills from the repo's hand-edited `aac-skills/`
tree, merged by the packager. `dan-skills` no longer exists as a plugin name anywhere.

**One button now exists.** `sync.ps1 -Mode push` refreshes `marketplace/dan-skills/` and
`.claude-plugin/marketplace.json` from the live tree on every push, and the session hooks already
run that push automatically. The repo IS a private marketplace:

```bash
claude plugin marketplace add surreptakos/claude-dotfiles
claude plugin install aac-skills@claude-dotfiles
```

Installed at user scope on this machine for both profiles 2026-08-31 (the old
`dan-skills@local-desktop-app-uploads` copy was uninstalled). Any machine refreshes with
`claude plugin marketplace update claude-dotfiles && claude plugin update aac-skills`.
claude.ai itself takes the same marketplace: Settings > Plugins > Add > "Add from a
repository" syncs a plugin marketplace straight from a GitHub repo or git URL — confirmed in Dan's
own UI 2026-08-31 after the docs suggested zip-only. So the zip is a fallback, not a channel: every
plugin surface (Code, Desktop, claude.ai chat, Cowork, org admin) can sync from
surreptakos/claude-dotfiles. Only the claude.ai SKILLS pages (Customize > Skills, admin-settings >
Skills) remain upload-only. Same-name uploads OVERWRITE; deleting first is unnecessary.


Cloud containers never read this machine's `~/.claude/skills`. They load what the claude.ai account
has enabled, and an uploaded plugin is a **snapshot** — claude.ai keeps its own copy. A skill edited
here reaches a cloud session only after a rebuild and a re-upload. `cloud-plugin-sweep.js` detects
the gap; this skill closes it.

There is no CLI or API for this. `claude plugin --help` has no upload or publish command, and the
plugins reference documents only how a cloud session *downloads* an enabled plugin. The upload runs
through the claude.ai web UI, so the browser is the transport.

## 1. See what drifted

```bash
node "$HOME/.claude/skills/session-check/cloud-plugin-sweep.js"
```

Exit 0 in sync, 1 drift or never uploaded, 2 could not check — **2 is never a pass**. In sync means
there is nothing to do; say so and stop.

## 2. Rebuild the zip

```bash
py -3 "$HOME/Claude/Projects/Meta/claude-dotfiles/tools/build-cloud-plugin.py"
```

Exit non-zero means at least one skill could not be packaged; it prints which and why. Fix that
before uploading — a partial plugin silently drops skills from every cloud session. Note the skill
count and the version it prints (a date, e.g. `2026.08.28`); both get checked against the UI later.

## 3. Check which account, then hand the zip over

**The account matters more than the upload.** Cloud Claude Code sessions load the plugins enabled on
the account that runs them — for Dan that is **djgatsakos@gmail.com**, a separate login from the
`dgatsakos@activealarm.com` session Chrome is normally signed into. That other login carries an
Active Alarm team workspace and a personal one; a plugin uploaded there reaches Cowork on the team,
not his cloud Claude Code. Read the signed-in email out of the profile menu before believing an
upload will land anywhere useful.

**`dan-skills` is enabled on BOTH accounts, and the desktop app serves it too.** Established
2026-08-31 from a work-account session (`~/.claude.json` → `dgatsakos@activealarm.com`): its skill
list carried `dan-skills:session-end` and 49 more, while
`installed_plugins.json` held only `pyright-lsp`, `typescript-lsp`, `caveman`, `i-have-adhd` and no
`dan-skills` directory existed under `~/.claude`. So the account copy reaches a local desktop
session, not only cloud ones, and it arrives **beside** `~/.claude/skills` rather than instead of
it — every packaged skill shows up twice, once bare and once `dan-skills:`-prefixed, and the
prefixed one is whatever the last upload froze. A stale upload is therefore not merely invisible to
cloud sessions; it plants a second, older copy of every skill in this machine's own picker. Both
accounts need the new zip, or the one that does not get it keeps serving the old snapshot.

**There are three skill channels on this machine, and this skill only covers one of them.**

1. **Local** — `~/.claude/skills` plus `~/.agents/skills` junctions. What `sync.ps1` mirrors into
   claude-dotfiles, what the sweep fingerprints, what a fresh machine restores.
2. **Account Plugins** — the `dan-skills` zip this skill builds. Namespaced `dan-skills:`.
3. **Account Skills** — individual skills uploaded at claude.ai, cached on disk at
   `%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\<orgUuid>\<accountUuid>\skills\`
   beside a `manifest.json`. Namespaced by the org's display name, which is why `anthropic-skills:`
   fronts skills that are Dan's own, not Anthropic's.

Channel 3 is invisible to everything in this repo, and its `manifest.json` carries a
`creatorType` per skill — `anthropic` for the stock set, `user` for an upload of Dan's. Counted
2026-08-31, and the split matters: the work org held 33 skills, but 21 were Anthropic's; only 12
were his. The personal org held 27, of which 7 were his.

Of his 12 in the work org, **nine have no copy under `~/.claude/skills` at all** —
`aac-contract-package`, `aac-sop`, `audit-code-changes`, `email-review`, `o3-prep`,
`review-contract`, `software-decision`, `todo`, `writing`. Those are not in the mirror, not in the
zip, and not on a restored machine; they come back only by signing into the account. The other
three — `caveman`, `find-skills`, `writing-dan` — exist in both places and can drift, and do:
writing-dan (deleted 2026-08-31) drifted the same way.

The two orgs are not in step either. Five of his work-org skills are absent from the personal org:
`aac-contract-package`, `email-review`, `o3-prep`, `review-contract`, `todo`.

**The manifest does NOT distinguish org-scoped from personal.** Every uploaded skill is
`creatorType: user`, and the org-vs-personal scope lives only in claude.ai. Confirmed 2026-08-31
against the work-org Skills UI: `aac-contract-package`, `writing`, `aac-sop`, `software-decision`
are published org-wide (visible to every Active Alarm member), yet in `manifest.json` they are
indistinguishable from Dan's personal `o3-prep`. So a downstream tool cannot know
which uploads reach teammates without asking the web UI.

Do not conclude a skill is missing from the packager because it is absent from `~/.claude/skills`.
Check channel 3 first, and read `creatorType` before calling anything Anthropic's.

Default path: send `dist/dan-skills.zip` with `SendUserFile` and let the owner upload it. One drag,
no account switching, no credentials, and it works regardless of which login the browser holds.

Only upload yourself when the browser is signed into the right account **and** the owner said yes in
chat — it replaces a plugin on their account, which is an account settings change. Show the drift
summary and the skill count so the answer is informed. No standing approval carries over.

## 4. Upload (only when driving the right account yourself)

Drive the browser (Claude in Chrome for the real logged-in session; the in-app browser cannot see
that login):

1. Open `https://claude.ai/settings/customize`, then the **Plugins** section.
2. Open the **dan-skills** row and delete it. claude.ai keeps one copy per plugin name; deleting
   first is what makes the re-upload land as the same plugin rather than a second one.
3. **Add → Upload plugin**.
4. Attach `dist/dan-skills.zip` by finding the `input[type=file]` element and setting the file on it
   directly. **Never click the file-picker button** — it opens an OS dialog the browser tools cannot
   drive, and the tab is then stuck.
5. Submit, then toggle the plugin **on**.

Validator rejections and what they mean, all three seen in practice:

- `SKILL.md description cannot contain XML tags` — a description holds something like
  `<ViewTransition>`. The packager strips these; if one survives, its regex missed a form.
- frontmatter key rejected — only `name`, `description`, `allowed-tools`, `license`, `metadata`,
  `compatibility` are allowed. The packager moves the rest under `metadata:`.
- `Plugin contains a top-level bin/ directory` — repacked marketplace plugins only; `dan-skills`
  ships no `bin/`.

A rejection means the zip is wrong, not the upload. Fix the packager, rebuild, upload again.

## 5. Verify, then stamp

Read the plugin row back: it must show the new version and the skill count from step 2. When the
owner uploaded, wait for them to say it landed — their word is the read-back. Only then:

```bash
node "$HOME/.claude/skills/session-check/cloud-plugin-sweep.js" --stamp --version <version> --accounts <every account uploaded to>
node "$HOME/.claude/skills/session-check/cloud-plugin-sweep.js"
```

`--accounts` takes a comma-separated list of emails and defaults to every account signed in on this
machine, which is only right when the upload really did reach all of them. Name the subset when it
did not: the sweep then reports `partial-upload` and exits 1 until the rest are done, instead of
calling the machine current while one account still serves the old snapshot.

The second run must print `cloud plugin is current`. Stamping before a verified upload is worse than
not stamping at all — it tells every future session the cloud copy is fresh when it is not.

## 6. Carry the change

If the sweep fired because skills changed, those edits belong in the dotfiles repo too:

```powershell
cd "$HOME\Claude\Projects\Meta\claude-dotfiles"; .\sync.ps1 -Mode push -Commit "chore: sync"
```

## The other two plugins

`caveman` and `i-have-adhd` were uploaded from `~/.claude/plugins/cache/<name>/...`, repacked
without their top-level `bin/`. The sweep does not track them — it watches `~/.claude/skills`. After
`claude plugin update`, repack and re-upload those by hand if the cloud copy should match.
