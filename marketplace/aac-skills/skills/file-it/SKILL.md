---
name: file-it
description: Route work to the repo or folder it belongs in and save it there — TypeSafe Jev picks the home and form from aac-nexus destinations.json, then the change is written, PR'd and merged. Use when asked to save, file, commit or put away a document, ruling, finding, ticket, skill change or note, or "where does this go?".
metadata:
  modified: '2026-10-02T23:01:08Z'
  previous-modified: none
  revision: '1'
  content-sha: 030747a2ed02
---

# file-it

Every item of finished work has one **home** (a repository, `people-copy` for Drive and SharePoint,
or `no-home`) and one **form** there (file, ruling, ticket, registry row, memory note). The table of
homes and forms is `destinations.json` in aac-nexus (nexus ADR 0007); Jev picks from it, the model
may **appeal** once, and the save follows the home's own conventions. Dan's rulings (2026-10-02):
route, write, pull request, merge; Jev picks with one appeal; every AAC item, ticket, skill or agent
rule, and personal repo is in scope.

## 1. Split the item into parts

One **part** per home it could need. A packet that holds rulings, legal risk and a guide for
managers is three parts, not one. For each part write an id (kebab-case) and two or three sentences:
what it is, who reads it, what it decides or changes. That text is all Jev sees, so name the
subject plainly ("attendance rulings Dan locked", not "the stuff above").

Done when every piece of the work sits in exactly one part, written to `parts.json` in the
scratchpad as `[{"id": "...", "text": "..."}]`.

## 2. Ask Jev

Read the table live, never from memory:

```bash
gh api repos/surreptakos/aac-nexus/contents/destinations.json -H "Accept: application/vnd.github.raw" > <scratch>/destinations.json
node "${CLAUDE_PLUGIN_ROOT}/skills/file-it/scripts/route.js" --destinations <scratch>/destinations.json --parts <scratch>/parts.json
```

In a cloud session with aac-nexus attached, read `destinations.json` from that checkout instead of
`gh`. The script asks one home and one form Choice per part in a single POST and prints
`{ jev, parts: [{ id, home, form, home_p, form_p }] }`. Exit 1 lists every problem with the table or
the parts; fix the parts yourself, and a broken table is a nexus fix (step 5).

Done when the script exits 0.

## 3. Show the route, appeal at most once

Before writing anything, show Dan one line per part:

`Route: rulings -> aac-nexus as ruling (Jev 0.91)`

- **Jev answered:** take its pick. If a pick contradicts a source you can quote (a home's CLAUDE.md
  or ADR, a nexus ADR, Dan's ruling this session), you may appeal it once per part: write
  `Appeal: <part> -> <home> as <form>, because <quoted source>` under the route line and use your
  pick. No source, no appeal.
- **Jev unavailable** (`jev: "unavailable"`): pick each home and form yourself from the table and
  open the reply with `route unchecked: Jev unavailable`.
- **`no-home`:** stop for that part and ask Dan whether to start a repository from
  aac-repo-template.

Done when every part has a final home and form shown to Dan.

## 4. Save each part in its home's own way

Open the home's `CLAUDE.md` (and `CONTEXT.md` and ADRs when the form is a ruling) and follow its
conventions for the form: protected branch, test command, generated files, stamping, merge rule.
The home's rules outrank anything here.

- **Repository, form file / ruling / memory note:** branch, write, run the home's test command,
  commit, push, open the pull request, merge it with squash once its checks pass, delete the
  branch. A ruling goes where that home records decisions: an ADR in nexus and claude-dotfiles, the
  matter section of `standing-context.md` in aac-legal.
- **Form ticket:** file it as an issue in the home's tracker with that repo's issue form and
  labels (`docs/agents/issue-tracker.md` and `triage-labels.md` in the home).
- **Form registry-row:** a row in aac-nexus `registry.yaml`, validated with
  `node scripts/build-registry.js` before the pull request.
- **`people-copy`:** upload to the Drive or SharePoint folder the work came from, then add or update
  the aac-nexus registry row pointing at it.
- **Same fact in two parts:** write it once and point to it from the other home; never two copies.

Done when every part is merged, filed or uploaded, and each one's location was confirmed by reading
it back (the merged file on the default branch, the issue URL, the Drive listing).

## 5. Fix the table when Jev was wrong

When you appealed a pick, or `no-home` turned into a new repository, open an aac-nexus pull request
that sharpens the losing entry's `means` (or adds the new home) so the next run picks right. A wrong
pick is a table fix, never a new rule in this skill.

Done when that pull request is merged, or there was no appeal.

## 6. Report

One line per part: where it now lives and the merged PR, issue or file link, plus any table fix.
End with one action Dan can take in under two minutes.
