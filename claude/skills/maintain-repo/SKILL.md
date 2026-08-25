---
name: maintain-repo
description: Weekly repo hygiene — fix doc-vs-reality drift, then tidy memory. Run by hand.
disable-model-invocation: true
---

# Maintain repo

One weekly pass. Two skills back-to-back, in order.

## Order matters

Truth first, shape second. Consolidating memory before auditing merges two wrong notes into one wrong note. Fix reality-drift, then dedupe.

## Step 1 — consistency-audit

Invoke `/consistency-audit`.

It sweeps every prose surface (README, CLAUDE.md, ADRs, PRDs, runbooks, memory files, doc generators), verifies each claim against primary sources (live measurement > code > git > tracker), fixes stale claims in place, and hunts the generator that republished drift. Owner-decision items go through `/triage` or `/to-tickets`, not inline.

**Completion criterion:** the audit's report lists every prose surface inventoried, every claim checked, every fix applied, every drift-generator named, and every owner-ruling item filed as a ticket with a number. A report ending without the ticket numbers is not done.

## Step 2 — consolidate-memory

Invoke `/anthropic-skills:consolidate-memory`.

It walks `memory/*.md` + `MEMORY.md`, merges duplicates, retires dated entries, converts relative→absolute dates, and trims the index under 200 lines / 25KB.

**Completion criterion:** the summary names files touched and reports the resulting `MEMORY.md` line and byte count under the limits. Any line still over 150 chars or file still overlapping another is a failure.

## Report

State: surfaces audited, drift fixes count, generators repaired, tickets filed with numbers, memory files merged/retired, final `MEMORY.md` line and byte count.
