# Skills-page upload — the zip fallback for channel 3

The claude.ai account Skills pages serve Cowork and the other claude.ai chat surfaces, and are the
only surface with no marketplace path: a plugin install cannot reach them. Upload the individual
skill's zip to `claude.ai/settings/customize` > Skills (per-user) or admin-settings > Skills
(org-wide). One skill per upload; that surface has no bulk import.

## What the surface holds

Uploaded skills are cached on disk at
`%APPDATA%\Claude\local-agent-mode-sessions\skills-plugin\<orgUuid>\<accountUuid>\skills\` beside a
`manifest.json`, namespaced by the org's display name. `creatorType` is `anthropic` for the stock
set and `user` for every upload — the manifest cannot tell org-scoped from personal; that scope
lives only in claude.ai.

## The account decides where it lands

Dan runs on two accounts — `djgatsakos@gmail.com` (personal, the cloud claude.ai/code account) and
`dgatsakos@activealarm.com` (Active Alarm team + a personal org). The login the browser holds
decides where an upload lands. Read the signed-in email from the profile menu before believing an
upload will reach anywhere useful.

## Who uploads

Default: `SendUserFile` the built zip and let the owner upload it — one drag, no account
switching, no credentials, whichever login the browser holds.

Upload yourself only when the browser is signed into the right account **and** the owner said yes
in chat for this upload: it replaces a skill on their account, an account settings change. Show
the drift summary and the skill count so the answer is informed.

Browser mechanics for a self-upload:

1. Open `https://claude.ai/settings/customize`, Skills section.
2. Skills-page uploads upsert by name; delete the existing row first only to change the name.
   (Same-name plugin uploads overwrite.)
3. Add → Upload skill.
4. Attach the zip by finding the `input[type=file]` element and setting the file on it directly.
   The file-picker button opens an OS dialog the browser tools cannot drive, and the tab is then
   stuck.
5. Submit.

## Validator rejections, all seen in practice

A rejection means the package is wrong, not the upload: fix the packager, rebuild, upload again.

- `SKILL.md description cannot contain XML tags` — a description holds something like
  `<ViewTransition>`. The packager strips these; if one survives, its regex missed a form.
- frontmatter key rejected — only `name`, `description`, `allowed-tools`, `license`, `metadata`,
  `compatibility` are allowed. The packager moves the rest under `metadata:`.
- `Plugin contains a top-level bin/ directory` — repacked marketplace plugins only; `aac-skills`
  ships no `bin/`.

## The other two plugins

`caveman` and `i-have-adhd` were uploaded from `~/.claude/plugins/cache/<name>/...`, repacked
without their top-level `bin/`. The sweep does not track them. After `claude plugin update`,
repack and re-upload those by hand if the cloud copy should match.
