---
name: message-board-backup-copies
description: "The 20 Message Board backup copies the claude-code service account can read, and how to match a row across them."
metadata: 
  node_type: memory
  type: project
  originSessionId: e225ee62-0293-4970-8a24-a05c32680535
  modified: 2026-07-29T23:37:56.630Z
---

The owner added `claude-code@project-id-3741568742576186263.iam.gserviceaccount.com` as **editor on
20 backup copies** of the Message Board workbook on 2026-07-29, so board history is now readable
without the owner's own credential. Verified: the SA could read none of them before that.

Find them with a Drive `files.list` as the SA (`q=mimeType='application/vnd.google-apps.spreadsheet'`)
— everything it can see is a Message Board copy. Snapshots span Oct 2024 → Nov 2025, plus
`Message Board Archive` and `Message Board @ Doug Resignation`. Titles carry a date that is roughly,
not exactly, the snapshot date; `createdTime` is the reliable ordering key.

**Matching a row across snapshots — do not match on subscriber.** A customer has many jobs and a
`W/O #` is reused across change orders, so both name and W/O alone find the wrong row. A first pass
matching on subscriber produced six confident, wrong answers. Use `W/O #` **+** `Change Order #` **+**
`Project Total`, or `Project Total` + `Date contract signed`. Row numbers shift between snapshots and
are useless as identity.

Two traps that make a real match look like no match:

- **Type coercion.** The Sheets API returns formatted strings (`'$1,272.00'`, `'8/15/2024'`); an xlsx
  export read with openpyxl returns a float and a `datetime`. Comparing raw strings finds nothing.
  Normalise to a number and a `(y, m, d)` tuple first.
- **Read-quota 429s.** Sweeping ~20 workbooks blows the per-minute read quota. Without retry the
  rejection returns empty and reads as "no such header/row" — a failed look posing as a finding.
  Back off and retry, and report unread files as unread.

Older snapshots use a different schema: the header is `Lead #`, not `Lead # (Get from ZOHO)`, and an
xlsx export renames the tab `Leads  Jobs` (slash stripped). Match tab names on alphanumerics only.

Where the schema is stable the header row is 2, `Stage`=1, `Subscriber…`=2, `Notified`=3, `Lead #`=4,
`W/O #`=5, `Change Order #`=6.

Related: [[message-board-google-access]]
