---
name: workflow-scripts-lf-session-cache
description: "Workflow tool rejects CRLF scripts; .claude/workflows pinned LF in .gitattributes 2026-08-20; permission handler caches script content at session start, so a fix never takes effect mid-session."
metadata: 
  node_type: memory
  type: project
  originSessionId: 98bf74af-0a02-478c-86ce-ff88e4768ba1
  modified: 2026-08-20T14:00:23.630Z
---

Workflow tool permission layer rejects any script containing \r: "script contains control characters that would be hidden in the approval dialog". `core.autocrlf=true` wrote CRLF at checkout, so `Workflow({name: "ticket-fleet"})` failed on every Windows checkout. Fixed 2026-08-20, commit `1188203` on main: `.gitattributes` rule `.claude/workflows/*.js text eol=lf` (blob was already LF; working copies renormalized in place in both main checkout and worktree).

**Two verified facts:**
- `Workflow({scriptPath: <file>})` reads the file fresh — accepted the LF file the same session the fix landed (run `wf_5fe14c15-262`, `maxTickets=0`, exited clean).
- The NAMED form resolves from content the permission handler cached at session start — it kept rejecting after the file on disk was clean (0 CR bytes verified by byte scan). A workflow-script fix therefore never takes effect for `{name}` invocations until a fresh session; do not burn attempts retrying it in-session, use `{scriptPath}`.

Named-form retry in a fresh session still unperformed as of 2026-08-20; expected to pass. Related: [[nightly-local-ticket-agent]].
