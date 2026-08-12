---
name: zoho-bulk-writes-need-trigger-suppression
description: "Pass trigger:[] on any AAC_Projects bulk write — the module carries 20+ repeat:false create_or_edit rules that would fire for the first time on old records."
metadata: 
  node_type: memory
  type: project
  originSessionId: cb11045a-f3c9-40ed-906f-93c6b5917caf
  modified: 2026-07-30T18:17:01.638Z
---

Any bulk write to Zoho `AAC_Projects` must send `"trigger": []` in the body.

**Why:** the module had 22 active workflow rules as of 2026-07-30, 16 of them `create_or_edit` with `repeat: false` — including **Send deposit invoice**, Notify PM - New Jobs, Ready to Invoice, eleven `Create Task: *` rules, and a Zoho Flow job-channel rule. `repeat: false` means once per record, so a record predating a rule has never spent its execution. An unsuppressed edit fires it for the first time — a silent field copy across 222 historical job records would have raised deposit invoices on jobs closed months ago.

**How to apply:** `trigger: []` suppresses all workflows, approvals and blueprints. Confirm it worked by snapshotting the rules' `last_executed_time` before and after a single-record write — none should move. Write one record, check, then batch the rest (100/call max).

Deliberately *not* suppressed when creating a genuinely new job record, since those rules are what drive the job's normal course. But note what create-time automation actually does: on a fresh AAC_Projects record it leaves `W_O`, `Deposit_Amount`, `Deposit_Invoice_Number` and `Team_Channel_Created` empty. Those get filled later in the flow, so an empty W/O right after creation is not a failure. Since the rules are `repeat: false` and have then spent their one execution, confirm with Palm that the W/O and deposit invoice actually get raised.

Related: [[zoho-workflow-create-record-is-api-editable]], [[live-workbook-id-sa-readable]].
