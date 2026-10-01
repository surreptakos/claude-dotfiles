---
name: artifact-submit-goes-to-last-publisher
description: A page's "send to Claude" (the rulings page Submit) reaches only sessions holding a watch on the artifact; publishing registers one, reading does not; name the receiver from the comment thread and the publisher from a session record, never from a tool contract
metadata:
  type: project
---

A comment sent to Claude from a published artifact is delivered to the Claude sessions watching that
artifact and to nothing else; the page's `canSendToClaude` reads `no_session` when none watches
(runtime contract `comments.d.ts`, `SendToClaudeResult` and `CanSendToClaude`). A watch comes from
publishing the artifact or from `ArtifactComments` `watch`; reading it registers none (2026-09-30:
this session read the rulings page and `ArtifactComments` `watch` listed nothing). The Ticket
Rulings Desk's Submit uses that channel, so the owner's batch lands in whatever session holds a
watch, which need not be the one that built or published the page.

Seen 2026-09-30: the page was republished at 18:56:47Z (version stamp `1790794607-ec73`, 11 cards
redrafted at 18:30Z and 18:53Z). No cloud session's record lists that publish under
`external_metadata.artifacts`, so it came from a desktop session. Dan's Submit at 19:17:53Z
(batch s1790795873359, 73 tickets) reached a Cowork session that had not published the page; its
19:22Z reply in the thread says no `gh`, 403 from api.github.com, nothing landed. A first answer
said "the Cowork session republished it": a tool contract plus a memory note about where routines
run, standing in for the records above. Dan: "inference is the tool of the devil."

Seen again 2026-10-01: Dan's Submit at 21:10:19Z (batch s1790889019918, 21 tickets) reached a Cowork
session that replied "Not landed" at 21:12Z; the desktop session that had published version 13 had
ended at 21:05Z. The `rulings-lander` desktop task had been disabled since 2026-09-29, in the app
and in aac-routines' `config/desktop-routines.json`, so nothing else would land it. Both were
flipped to enabled on 2026-10-01 (aac-routines PR 677) and the lander's first tick landed the batch.

**How to apply:** the landing path is the `rulings-lander` task on the anchor PC, never the
session that happens to hold a watch; a Submit comment reaching a session is a courtesy. Name the receiver from `ArtifactComments` `read` on the page, the publisher from
the session record that lists the artifact (`list_sessions`, `external_metadata.artifacts`) or the
publish result in that session's own transcript, and the publish time from `Artifact` `list` with
`scope: files`. A session that cannot land never publishes or watches the rulings page (rule in
`aac-skills/grill-ready-for-human/rulings-page.md`). Cowork transcripts are not readable from a
cloud session ([[cowork-transcripts-not-local]]), so a Cowork receiver's own history is read on
the laptop.

Source: aac-skills/grill-ready-for-human/rulings-page.md, tools/rulings-page-template.html, https://claude.ai/artifact/9wnfsMJFtUNGGoSh46bmDE
