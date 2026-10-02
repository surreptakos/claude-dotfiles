---
name: consolidate-memory
description: Full-sweep memory consolidation — merge duplicate notes, fix stale facts, prune the MEMORY.md index. Use when asked to consolidate or tidy memory, or when notes overlap.
metadata:
  modified: '2026-10-02T15:35:47Z'
  previous-modified: '2026-09-28T21:43:43Z'
  revision: '6'
  content-sha: 64b2aef069b2
---

# Memory Consolidation

Reflective pass over the memory set. Goal: a future session orients quickly — who the user works with, what they're focused on, how they like things done — without re-asking. The system prompt's auto-memory section defines the file format and memory types; follow it.

## The memory set, and the gate (Dan, 2026-09-18)

Resolve the set first. When the checkout has `docs/agents/memory/MEMORY.md`, that directory is the whole set: the auto-memory directory holds only a pointer (in a cloud container it is empty), and the edits are committed and pushed like any other change. Only a repo with no `docs/agents/memory/` uses the auto-memory directory as the set.

**An empty or missing set on a repo with commit history is a stop.** The memory exists where this session cannot see it — a cloud container holds no copy of the desktop's auto-memory — and "0 files, nothing to consolidate" is a false report, not a result. Report the resolved path and the count, name what unblocks it (run where the memory lives, or commit the notes into the repo as `docs/agents/memory/` + `MEMORY.md`), and end there. Only a repo with fewer than ten commits legitimately has none, and the report says so.

## Full sweep — every file, every run

Every invocation walks the complete set. Scope never narrows to files created or modified since the last consolidation, files touched in the last N days, or a diff against a prior report: overlaps, stale facts and durable/dated confusion accumulate in files that look quiet, exactly the ones a delta sweep skips. The pass is done only when every file in the set was opened this run.

## Phase 1 — Take stock

Resolve the set and apply the gate, then read every file and `MEMORY.md` in full. Note which files overlap, which look stale, which are thin, which are dated. Done when every file in the set is read.

## Phase 2 — Consolidate

**Separate the durable from the dated.** Preferences, working style, key relationships, and recurring workflows are durable — keep and sharpen them. Specific projects, deadlines, and one-off tasks are dated — if the date has passed or the work is done, retire the file or fold the lasting takeaway (e.g. "user prefers X format for launch docs") into a durable one.

**Merge overlaps.** Any two files describing the same person, project, or preference combine into one.

**Fix time references.** Convert "next week", "this quarter", "by Friday" to absolute dates so they stay readable later.

**Drop what's easy to re-find.** A note that restates what the user's calendar, docs, repo, tracker or connected tools give on demand is cut (the global rules' Memory governance scope). Keep what's hard to re-derive: stated preferences, context behind a decision, who to go to for what.

**Ground-check what you rewrite.** A merge is exactly where a number drifts off its evidence. Where the repo carries the checker (claude-dotfiles does), run `node tools/check-evidence.js <note.md>` on every note this pass edits before declaring it finished:

- **Sources.** Each number, date and quote must appear verbatim in a source the note cites as a Markdown link or on a `Source:` line. Give every note a `Source:` line: a repo file path, or an issue or comment URL. A note that cites URLs only runs with `--fetch`.
- **Exit codes.** Exit 0 is a pass; exit 3 is a pass only when every finding is an `unchecked <url>` line and no fact is reported missing. Exit 1 (a fact not found in its sources) and exit 2 (a read error) are never a pass: fix the source, fix the fact, or file the fact its own `ready-for-human` ticket.
- **Unsourced.** A note or fact with no findable source stays in place: file one `ready-for-human` ticket per unsourced note that names the note, quotes the unsourced facts and asks the owner for the source or for permission to drop them, and link the ticket from the note as a bare URL on its own line (a Markdown link would count as a source).

Done when every overlap noted in Phase 1 is merged or retired, every relative date is absolute, and every edited note has passed the ground-check or carries its ticket link.

## Phase 3 — Tidy the index

Update `MEMORY.md` so it stays under 200 lines and ~25KB. One line per entry, under ~150 chars, in the shape the index's own header states (claude-dotfiles: `- <name>: <hook>`, a bare name its loader test enforces), else `- [Title](file.md) — one-line hook`.

- Remove pointers to retired memories.
- Shorten any line carrying detail that belongs in the topic file.
- Add anything newly important.
- Reconcile: every file present in the directory has an index entry, and every index entry points to a file that exists.

## Phase 4 — Report

State: total files in the set, files read this run (must equal the total), files merged, files retired, `MEMORY.md` resulting line count and byte count. A summary that cannot confirm the full set was walked fails, whatever "N files touched" it reports.
