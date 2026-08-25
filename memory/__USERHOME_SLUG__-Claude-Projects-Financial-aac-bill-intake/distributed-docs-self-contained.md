---
name: distributed-docs-self-contained
description: "Owner directive 2026-08-25: staff-distributed docs (field-guide PDF, SOP docx) must carry zero repo-speak — verify renders by extracted-text grep"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f0043044-66c7-4292-8ce8-e143c7e88547
  modified: 2026-08-25T17:18:15.362Z
---

Owner directive 2026-08-25, mid-turn, verbatim: "you shouldn't even mention the repo or folder or
whatever. These guys will never see it. If something needs to be shared it should be shared in the
files."

**Why:** the distributed docs (ap-intake-field-guide.pdf, coordinator-approval-sop.docx) go to AP
coordinators who have no repo access. A repo path, ADR number, issue reference, Script Property
name, or clasp/Apps Script instruction is dead weight or confusion to them.

**How to apply:** anything shipped to staff carries zero of: repo/folder paths, internal file
names, ADR citations, GitHub issue numbers, tool commands they cannot run, Script Property names,
"a test in the code"-style repo references. Replace with plain language ("tell the AP system
owner; a report exists that…", "a production switch, currently ON"). If a fact matters to the
reader, it goes IN the document in their vocabulary — never as a pointer elsewhere. Verify every
render by extracting its text (docx document.xml, pypdf) and grepping for the token list; sources
staying clean is not proof the render is. Purge landed 2026-08-25 (commit 6690a9d, pushed
83e957f). Repo-side docs (changelog, runbooks, admin guide) keep full references. Related:
[[surface-in-chat-not-docs]].
