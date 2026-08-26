---
name: "consolidate-memory"
description: "Full holistic pass over every memory file — merge duplicates, fix stale facts, prune the index. Never a delta sweep."
---

# Memory Consolidation

Reflective pass over the auto-memory directory. Goal: a future session orients quickly — who the user works with, what they're focused on, how they like things done — without re-asking.

The system prompt's auto-memory section defines the directory, file format, and memory types. Follow it.

## Always a full sweep — never a delta

Every invocation walks the complete memory set. Never restrict to files created or modified since the last consolidation, files touched in the last N days, or a diff against a prior report. Overlaps, stale facts, and durable/dated confusion accumulate in files that look quiet — those are exactly the ones a delta sweep skips. If any file in the directory is not opened this run, the consolidation is not done. State the total file count and confirm every one was read; a summary that cannot do that fails.

## Phase 1 — Take stock (whole directory, every time)

- List the memory directory. Read every file in it, not a subset.
- Read `MEMORY.md` in full.
- Note which files overlap, which look stale, which are thin, which are dated.

## Phase 2 — Consolidate

**Separate the durable from the dated.** Preferences, working style, key relationships, and recurring workflows are durable — keep and sharpen them. Specific projects, deadlines, and one-off tasks are dated — if the date has passed or the work is done, retire the file or fold the lasting takeaway (e.g. "user prefers X format for launch docs") into a durable one.

**Merge overlaps across the entire set.** Two files describing the same person, project, or preference combine into one. This applies to every pair in the directory, not only newly written files.

**Fix time references.** Convert "next week", "this quarter", "by Friday" to absolute dates so they stay readable later. Every file, every run.

**Drop what's easy to re-find.** If a memory just restates something you could pull from the user's calendar, docs, or connected tools on demand, cut it. Keep what's hard to re-derive: stated preferences, context behind a decision, who to go to for what.

## Phase 3 — Tidy the index

Update `MEMORY.md` so it stays under 200 lines and ~25KB. One line per entry, under ~150 chars: `- [Title](file.md) — one-line hook`.

- Remove pointers to retired memories.
- Shorten any line carrying detail that belongs in the topic file.
- Add anything newly important.
- Reconcile: every file present in the directory has an index entry, and every index entry points to a file that exists.

## Phase 4 — Report

State: total files in the directory, files read this run (must equal the total), files merged, files retired, `MEMORY.md` resulting line count and byte count. A summary that reports "N files touched" without confirming the full set was walked is a failure.
