---
name: maintain-repo
description: Weekly repo hygiene — reap speculative tickets, fix doc-vs-reality drift, then tidy memory. Run by hand.
disable-model-invocation: true
metadata:
  modified: "2026-10-02T15:35:29Z"
  previous-modified: "2026-09-30T21:51:23Z"
  revision: "9"
  content-sha: "93fba4dff705"
---

# Maintain repo

One weekly pass: three skills back-to-back, in order — ticket-reaper, consistency-audit,
consolidate-memory. Each is a full sweep by its own rule; a report that justifies its coverage by a
last-run date or a changed-files list fails this skill.

**Order:** truth first, shape second. Consolidating memory before auditing merges two wrong notes
into one wrong note.

## Gate — no memory, no run (Dan, 2026-09-18)

Before step 0, resolve the memory set and apply the gate exactly as
[consolidate-memory](../consolidate-memory/SKILL.md) defines them ("The memory set, and the gate").
When the gate stops, the whole run stops there: steps 0–2 run only on a repo whose memory this
session can reach.

## Run as a subagent: draft the tickets, the parent files them (issue 1031)

A background agent never files a ticket. The ask-matt publish gate refuses its `gh issue create`
(and the MCP create): it has no nonce to declare a route with, and it cannot get the owner's
approval for a ticket set. On 2026-09-29 seven `/maintain-repo` agents were each refused, and the
parent filed 15 tickets by hand. The gate stays as it is (Dan, 2026-09-30, option 2).

- **The subagent** writes each ticket it would file (steps 0 and 1) as one file in
  `.scratch/maintain-repo-drafts/` at the root of the repo it audited, named
  `<NN>-<slug>.md` and laid out as `/to-tickets`'s local-ticket template, with the `ready-for-*`
  label on its **Status** line. It leaves that folder uncommitted. Its report gives the folder's
  absolute path and the draft count where the ticket numbers would go; that counts as done.
- **The parent**, once every agent has reported, runs `/to-tickets` once over all the drafts
  folders. The drafts are the breakdown, so one approval covers the whole batch, and each ticket
  goes to the tracker of the repo whose folder holds it. It then deletes each folder and puts the
  issue numbers in the report. Every draft goes through that one `/to-tickets` run.

## Step 0 — ticket-reaper

Run `/ticket-reaper` first: it parks belt-and-suspenders tickets in the Maybe Someday milestone
and closes the moot ones, so the two steps below do not spend effort keeping speculative work
consistent. Done when its digest is posted on the repo's "Ticket reaper digest" issue.

## Step 1 — consistency-audit

Invoke `/consistency-audit`.

**Completion criterion:** the audit's report lists every prose surface inventoried, every claim
checked, every fix applied, every drift-generator named, and every owner-ruling item filed as a
ticket with a number (as a subagent: the drafts folder and count). A report ending without them
is not done.

## Step 2 — consolidate-memory

Invoke `/aac-skills:consolidate-memory`, the aac-skills plugin's copy, which wraps the
anthropic-skills version with the full-sweep rule. Name it with the prefix:
`/anthropic-skills:consolidate-memory` has the same bare name and lacks that rule.

**Completion criterion:** the summary confirms the full set was walked, names files touched, and
reports the resulting `MEMORY.md` line and byte count under the limits. Any index line still over
150 chars or file still overlapping another is a failure. A summary reporting zero files read
means the gate above was skipped: not a completion.

## Report

State: surfaces audited, drift fixes count, generators repaired, tickets filed with numbers (or
drafts folder and count), memory files merged/retired, final `MEMORY.md` line and byte count.
