---
name: never-point-dan-at-github
description: Dan never wants "see issue N" or "check GitHub"; a reply carries the clickable URL or the content itself
metadata:
  type: feedback
---

When a reply rests on a ticket, comment, PR or file on GitHub, paste the direct URL (issue or
comment permalink) or quote the content inline. Never "the spec is on issue 579" as a bare
pointer.

**Why:** Dan, 2026-09-21: "Stop telling me to check github and either give me a link or give me
the contents." Three replies in a row had cited issue 579 by number for a Routine spec he then
had to go and find.

**Sharpened 2026-09-22.** A GitHub URL is not the channel either: "No, I can read artifacts here. I do
not want to go to github to read things." He reads two places — the reply, and an artifact rendered
in the session. A link is a last resort for something he asked to open; content he needs goes in the
reply, or in an artifact when it outgrows one. The global rules carry this as a rule of the reply.

**How to apply:** `gh issue view N --json url,comments -q '.comments[i].url'` gives a comment
permalink; put it in the reply. If the content is under ~20 lines, quote it instead. Related:
[[answer-yes-no-in-one-line]].
