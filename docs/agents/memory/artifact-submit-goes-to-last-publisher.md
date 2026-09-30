---
name: artifact-submit-goes-to-last-publisher
description: An artifact's "send to Claude" (the rulings page Submit) wakes the session that last republished the page; a Cowork session that redrafts one card and republishes becomes the lander, gh-less
metadata:
  type: project
---

A published artifact's send-to-Claude comment is delivered to the session holding the artifact's
watch, and publishing registers the watch for the publisher (`ArtifactComments` tool contract).
The Ticket Rulings Desk page's Submit button uses that channel, so the owner's batch lands in
whichever session last republished the page, not in a routine and not in the session that built it.

Seen 2026-09-30: the 5 AM desktop digest drafted 57 cards (`draftedAt` 10:09-10:15Z). A Cowork
session then redrafted 11 cards (`draftedAt` 18:30Z and 18:53Z) and republished at 18:56:47Z
(page version stamp `1790794607-ec73`). Dan pressed Submit at 19:17:53Z (batch s1790795873359,
73 tickets); the comment thread on the page shows the reply came from that Cowork session at
19:22Z: no `gh`, 403 from api.github.com, sandbox refused a clone, nothing landed.

**How to apply:** the page's own record answers "who got Submit": `Artifact` `list` with
`scope: files` gives the publish time, the `draftedAt` values in the saved HTML say who redrafted,
`ArtifactComments` `read` shows each Submit and its reply. Never republish the page from a session
that cannot land (rule now in `aac-skills/grill-ready-for-human/rulings-page.md`). A tool
contract or a memory note about where routines run is not evidence of which session published.

Source: aac-skills/grill-ready-for-human/rulings-page.md, tools/rulings-page-template.html, https://claude.ai/artifact/9wnfsMJFtUNGGoSh46bmDE
