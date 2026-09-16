---
name: maintain-repo
description: Weekly repo hygiene — fix doc-vs-reality drift, then tidy memory. Run by hand.
disable-model-invocation: true
metadata:
  modified: "2026-08-26T14:35:01Z"
  previous-modified: "2026-08-25T22:33:19Z"
  revision: "1"
  content-sha: "3cdb0a47d334"
---

# Maintain repo

One weekly pass. Two skills back-to-back, in order.

## Every run is a full sweep

Scope is the complete inventory of prose surfaces and the complete set of memory files, every time. Drift accumulates hardest in the files nobody touched, so coverage is measured against that inventory: the report counts what exists and what was read, and the two match. A report that establishes its scope from a last-run date, a git-log window or a diff against a prior report has measured a different job.

## Order matters

Truth first, shape second. Consolidating memory before auditing merges two wrong notes into one wrong note. Fix reality-drift, then dedupe.

## Step 1 — consistency-audit

Invoke `/consistency-audit`.

It sweeps every prose surface (README, CLAUDE.md, ADRs, PRDs, runbooks, memory files, doc generators), verifies each claim against primary sources (live measurement > code > git > tracker), fixes stale claims in place, and hunts the generator that republished drift. Owner-decision items go out through `/triage` or `/to-tickets`.

**Completion criterion:** the audit's report lists every prose surface inventoried, every claim checked, every fix applied, every drift-generator named, and every owner-ruling item with its ticket number beside it. The ticket numbers are what finish it.

## Step 2 — consolidate-memory

Invoke `/consolidate-memory` (local override at `~/.claude/skills/consolidate-memory/`, which wraps the anthropic-skills version with the full-sweep rule).

It walks every `memory/*.md` file plus `MEMORY.md`, merges duplicates, retires dated entries, converts relative to absolute dates, and trims the index under 200 lines / 25KB.

**Completion criterion:** the summary names the files touched, reports the resulting `MEMORY.md` line and byte count under the limits, and shows every index line at 150 characters or fewer with each topic owned by one file.

## Report

State: surfaces audited, drift fixes count, generators repaired, tickets filed with numbers, memory files merged/retired, final `MEMORY.md` line and byte count.
