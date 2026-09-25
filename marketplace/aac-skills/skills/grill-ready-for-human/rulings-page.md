# The rulings page

The same two phases as `SKILL.md`, across every repo at once, with a page in place of the question
batch. **Ask** is a published artifact holding every open `ready-for-human` ticket with drafted
options; the owner clicks through it and presses Submit. **Land** is a run that reads what Submit
recorded and writes each ruling to GitHub. Two desktop scheduled tasks drive it; either may also be
run by hand from any session.

- Page: https://claude.ai/artifact/9wnfsMJFtUNGGoSh46bmDE (one URL for good; republish in place,
  never publish a second page, or the owner's saved picks stay behind on the old one).
- Code: `tools/rulings-page.js` (`queue`, `bodies`, `build`, `land`) and `tools/rulings-page-template.html`
  in claude-dotfiles. Run from a claude-dotfiles checkout.
- Page database: `rulings/<repo-short>~<n>` (the owner's pick: `choice`, `note`), `submissions/<id>`
  (`keys`, `status`: `submitted` then `landed`), `landed/<repo-short>~<n>` (`ok`, `outcome`,
  `detail`; the card shows it).
- Drafts are never committed: the repo is public. They live in the published page (each ticket
  carries `draftedAt`) and in temp files.

## Land (the lander task, and step 1 of the digest)

1. `ArtifactData` `query` on `submissions` where `status == "submitted"`. None: stop, no output.
2. `Artifact` `read` the page URL; it saves the full HTML to a file. `ArtifactData` `list` on
   `rulings` with `out_dir` set to a temp dir.
3. Per submission: `node tools/rulings-page.js land --page <html> --rulings <dir> --submission <id>
   --keys <comma-joined keys> --execute > <result.json>`. It comments (marker makes a rerun a no-op),
   relabels, closes, and verifies each ticket's labels and state. Exit 1 means at least one ticket
   failed; the result names it.
4. Every result with `needsJudgment` (an "Other" pick, or a pick that spawns child tickets): the
   note or ruling is already posted. A spawn-children pick: run `/to-tickets` for the children.
   An "Other" pick: Read
   the ticket, then land it by the ruling shapes in `SKILL.md` (relabel, close, wontfix, or keep
   with a note); a note that leaves a fork keeps `ready-for-human` with the question in a comment.
5. Unblock: for every closed ticket, each number in its `blocks` — if all of that ticket's blockers
   are now closed, comment "Blocker #N closed by owner ruling" and remove a `blocked` label if it
   carries one. Native dependency links clear themselves.
6. `ArtifactData` `batch`: `set` `landed/<key>` for every result (`key`, `ok`, `outcome`, `detail`,
   `at`), then `update` `submissions/<id>` to `status: "landed"` (or `"partial"` with the failed
   keys) and `landedAt`.
7. One status line per submission: landed count, failures by key.

## Digest (the morning task)

1. Run **Land** above first, so the page never shows a ruling as pending that already landed.
2. `Artifact` `read` the page URL (saved HTML), then `node tools/rulings-page.js queue --page <html>
   > plan.json`. `total` 0: stop. No page change, no email.
3. `keep` holds drafts still valid (ticket not updated since `draftedAt`). `toDraft` lists tickets
   per repo that are new or changed. For each repo in `toDraft`, one `Agent` (read-only) with the
   drafting brief below, writing `<drafts dir>/<repo-short>.json` for exactly those numbers. Merge
   each repo's `keep` tickets into the same file.
4. `node tools/rulings-page.js bodies --drafts <dir>` (each card shows the ticket's own GitHub text
   beside the explainer), then `node tools/rulings-page.js build --drafts <dir> --out <page.html>`;
   publish it with `url` set to the page URL. The page's database, and the owner's saved picks, carry over.
5. Email with the Gmail connector `send_message` to dgatsakos@activealarm.com. Subject:
   `<N> tickets need your ruling`. HTML body: count per repo, up to five tickets whose drafts carry
   money, tax, customer-data or delete decisions (one line each: repo, number, the question), and
   the page link. No email when step 2 stopped.

### Drafting brief (one agent per repo)

Read-only: comment, label or edit nothing. For each listed ticket, `gh issue view N --repo <repo>
--comments` (every comment: earlier ones carry partial rulings), blocking links (`Blocked by #X`
text and `gh api repos/<repo>/issues/N/dependencies/blocked_by` and `.../blocking`), the repo's
labels (`gh label list`) and whatever quick lookup makes the options concrete. Frame each ticket's
one decision in plain real-world English: the owner holds no coding context and never opens the
ticket. 2-4 options, the ticket's own when it lists them, exactly one `recommended`; the id `other`
is reserved. Write `{"repo","labels","tickets":[{"n","title","url","plain","question","blockedBy",
"blocks","needsDanOnly","draftedAt","explainer":{"what","background","stakes"},"options":[{"id","label","detail","recommended","landing":
{"action":"relabel|close-completed|close-wontfix|keep|spawn-children","addLabels","removeLabels",
"ruling"}}]}]}`, `draftedAt` the ISO time drafting began. `explainer` is the ticket itself in plain English, shown
beside its GitHub text: `what` (what it is about, one breath), `background` (how we got here, what
was found or already ruled), `stakes` (why it matters, what waits on it); 1-4 short sentences each,
every code symbol, filename or ticket number replaced by what it does for the owner's business. `ready-for-agent` for work a cloud agent
can do, `ready-for-local-agent` (only where the label exists) for work needing the owner's PC,
`ready-for-human` kept only when owner-only work remains. `ruling` is the comment text an
implementing agent acts on. Verify the file parses.
