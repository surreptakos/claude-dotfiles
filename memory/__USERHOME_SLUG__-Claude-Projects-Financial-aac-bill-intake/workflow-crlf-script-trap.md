---
name: workflow-crlf-script-trap
description: Workflow tool rejects CRLF scripts — permission handler fails on \r control characters; run an LF-only copy
metadata: 
  node_type: memory
  type: project
  originSessionId: 60c8fab0-4c41-42c2-b944-99f8760aba7c
  modified: 2026-08-22T17:23:39.170Z
---

Invoking the Workflow tool with a CRLF-line-ending script fails (2026-08-22, twice): permission
handler returns `script contains control characters that would be hidden in the approval dialog` —
the `\r` bytes are the control characters. Both `{name: "ticket-fleet"}` and `{scriptPath:
".claude/workflows/ticket-fleet.js"}` fail identically because both resolve to the CRLF file.

**How to apply:** `tr -d '\r' < script.js > scratchpad/script.lf.js`, then invoke with that
scriptPath. Permanent fix: convert `.claude/workflows/*.js` to LF (or add `.gitattributes` `eol=lf`
for that dir). The repo copy of ticket-fleet.js was still CRLF when this was written.

Related: [[nightly-orchestrator-live]] — ticket-fleet run 2026-08-22 (`wf_c47a17a7-045`) drove 9
tickets, delivered 6 PRs, both waves from the LF scratchpad copy.
