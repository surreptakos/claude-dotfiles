**Purpose & context**

Dan Gatsakos is the General Manager of Active Alarm Company (AAC), a commercial fire alarm and security systems integration firm based in Lake Zurich, IL. He uses this Claude Project as an AI-assisted internal contract review and operations system. The core mission is ensuring outgoing customer contract packages are accurate, compliant, and professionally formatted before reaching subscribers — and increasingly, shifting from human-drafted documents toward AI-assisted document generation.

Key colleagues: Amanda Gatsakos (Sales Admin/drafter), Mark Kurland (VP of Sales and Marketing, holds language authority over certain governing documents), David Kolia (Account Executive), Erich Rojek (sales rep), John Gatsakos (sales rep).

AAC's services span fire alarm, access control, video surveillance, elevator monitoring, and related technologies. Dan holds final language authority over the contract review system and oversees the rep-facing contract review workflow.

**Current state**

**Contract review system:** Six governing documents are active — PROMPT.md, Living Standard, Schedule-to-Master Mapping Appendix, BASELINES.md, SOW-BASELINES.md, and DRAFTER-PRESEND-CHECKLIST.md. A major standards consolidation was completed (merging April content, June redlines, and Mark Kurland's two conformed bullets into BASELINES.md and Living Standard). SOW-BASELINES.md and DRAFTER-PRESEND-CHECKLIST.md were created as new companion files.

**Document generator project:** A strategic initiative to auto-generate the Schedule of Equipment and Services from source materials rather than auditing a human-drafted version. Key architecture decisions are settled: source-of-truth hierarchy established (Work-Up/proposal/rep comments as primary truth; drawings/checklists/sub agreements as corroborating; Zoho CRM as deal envelope metadata). Two doc-level prerequisites are blocking downstream generator stages: (1) SOW §7/§8 templates must be reconciled to the §4 no-re-enumeration rule; (2) OpenCorporates permissibility question must be resolved (DRAFTER-PRESEND-CHECKLIST bans aggregators, but prior practice has used it). A decision is also pending on seven system types lacking §7 SOW template coverage (Nurse Call, Area of Refuge, Network, Standalone Intercom, Visitor Management, Standalone Environmental Monitoring, Audio/Visual) — each needs a ruling: escalate to human or author a new §7 template.

**SOP formalization:** A prioritized inventory of process candidates for the `/aac-sop` skill was produced. Five were identified to build now (governing standards change ratification Procedure, rep-facing Work Instruction for BASELINES.md clarification selection, legal entity verification Work Instruction, pricing Work Instruction for FSI worksheets and Repair Service, contract package review Procedure). Three are deferred pending open decisions or unbuilt tools. Drafting the ratification Procedure was offered as the immediate next step.

**Zoho CRM / rep activity tracking:** A custom `Last_Rep_Touch` field (field ID 6551719000039264001) was created on the Deals layout. Two build items remain open in Todoist: native workflow rule to stamp the field on owner edits and note-adds (excluding the existing stage-timeout automation), and deploying a Google Apps Script reconciler in strict GET→PROCESS→WRITE structure.

**Standards governance:** Open Todoist items include standing up a shared Claude Project for Mark Kurland (promised), adding a ratification-checklist sync step to prevent document drift, and confirming the merged governing documents are published to the project.

**On the horizon**

- Resolve SOW §7/§8 template reconciliation and OpenCorporates permissibility to unblock generator build
- Decide coverage approach for the seven system types with no §7 template
- Build the downstream generator stages once prerequisites clear
- Draft the governing standards change ratification Procedure (source material exists from a June 12 chat)
- Stand up the rep-facing shared Claude Project (Team plan confirmed)
- Complete Zoho native workflow rule and Apps Script reconciler deployment
- Evaluate a live-render (connector reading canonical file) vs. deliberately-owned two-copy approach for rep-facing BASELINES.md access; any static copy creates a sync surface requiring an explicit ratification-checklist step

**Key learnings & principles**

- **Validate, don't trust CRM data:** Generator should validate Zoho field values against the source-of-truth hierarchy, not treat populated CRM fields as authoritative. `Effective_Agreement_Term` = 0 signals missing data or a deal needing a new contract, not a benign "no term." `Invalid_System_Types_Found` flags only system-type-to-contract-type incompatibility.
- **SOW device re-enumeration is prohibited:** Equipment already detailed in the Equipment and Labor section must not be re-listed in the SOW scope (§4 rule). This was a corrected failure mode.
- **No placeholder edits:** If an answer is pending, the line waits unwritten in the hold queue. No write-then-strike, no "add so it can be removed."
- **Stop-slop must be run, not read:** Reading the skill file is not running it. A visible score is required before delivering any prose to another person.
- **UI capability claims require empirical verification:** Do not assert what Zoho's workflow builder (or any product UI) can or cannot do from memory. Treat as unknown unless confirmed from a screenshot or live test. This applies to any product capability claim, not just API/data behavior.
- **Find empirical answers in the data:** Dan's preference is for Claude to resolve ambiguities by looking things up rather than surfacing them as decisions for him. "Check which one is getting used" is the expected pattern.
- **Zoho automation contamination:** Native fields (Modified_Time, Last_Activity_Time, Stage_Modified_Time) are contaminated by existing stage-timeout workflows and are anti-correlated with actual rep activity — hence the custom `Last_Rep_Touch` field approach.
- **Rep-facing content requires a different format than reviewer content:** BASELINES.md is right for Amanda and the reviewer but carries too much reviewer metadata for field reps. A separate surface is needed.
- **Instruction files cannot overwrite project knowledge at runtime:** Instructions are prompt text with no write-access to project knowledge; connector files are fetched per-conversation and never persist as project knowledge.
- **Standards drift risk:** Mark Kurland's parallel docx drifted from project standards over a six-week gap due to a missing confirmation gate. A ratification-checklist sync step is the structural fix.

**Approach & patterns**

- **4D framework:** Dan triages all requests through Delete / Delegate / Defer / Do. Claude applies this proactively without being asked.
- **Surgical edits with exact anchors:** Dan expects precise, verifiable edits — not paraphrases or approximations. File changes must be confirmed by script-based audit, not eyeballing.
- **Empirical verification over assertion:** All data claims, field values, and system behaviors should be verified from source before being stated.
- **Delegation-aware outputs:** Dan distinguishes between tasks requiring his decision and tasks that can be handed off. Deliverables for delegation should be tagged accordingly (Dan-only / Delegable / Quick Check).
- **Todoist task management:** All Claude-created tasks go to Inbox; Dan organizes from there. Add parent tasks first to get IDs, then add subtasks one at a time using `parentId` only (omit `projectId` on subtasks).
- **File outputs for handoff deliverables:** Markdown files written to `/mnt/user-data/outputs/` and surfaced via `present_files` is the right format for content meant to be handed to another person.

**Tools & resources**

- **Zoho CRM MCP tools:** `getFields` (payload at `d[0]['text']`, requires `json.loads()`, fields under `fields` key), `getRecords` (data at `p['data']`, requires user approval before first return), COQL via `POST /coql`, Timeline API at `GET /crm/v8/[Module]/[recordId]/__timeline` (v3+ required; `per_page` only on first page, subsequent pages use `page_token` alone)
- **Todoist MCP:** Single-item `add-tasks` calls only — batching is unreliable. Inbox referenced as projectId `'inbox'`.
- **Google Apps Script:** Strict three-phase structure (GET DATA → PROCESS DATA → WRITE DATA); no mixing of API calls and computation. Preferred over Deluge.
- **Microsoft 365 connector:** Used for Outlook search to recover historical email threads.
- **Illinois Secretary of State (SOS) lookups:** Used for legal entity verification.
- **Alarmbiller:** Account management system for RMR tracking; relevant to eventual RMR portfolio due diligence.
- **`/aac-sop` skill:** System for creating formal Procedures and Work Instructions.
- **Stop-slop skill:** Must be invoked (not just read) before delivering any prose to another human; score must be shown.

**Contract-review drafter instructions (user-specified)**

- Give ONE direction per fix — either "keep X" or "remove Y," never both. If the net action is leave-as-is, write nothing about that item.
- Never instruct an edit that gets undone later — no placeholder values, no write-then-strike, no "add so it can be removed." If an answer is pending, the line waits unwritten in the hold queue.
- If a bullet/term might be needed, it stays. Removal requires a definite reason it does not apply — never "probably safe to cut."
- When a field disagrees with a governing source (RMR Items sheet, BASELINES, Mapping Appendix, master), name the source and the correct value as a do-now fix for the drafter — do not pose it back as a question when the source already answers it.
- Scan customer-facing text for open-ended company promises (indefinite price/replacement guarantees, warranty-like commitments) and flag them to cut or time-bound.
- Any prose deliverable for other humans (sales-review emails especially): run the stop-slop scoring-and-revision pass and show the score before delivering. Reading the skill is not running it.