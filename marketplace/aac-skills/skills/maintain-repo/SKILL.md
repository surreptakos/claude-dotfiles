---
name: maintain-repo
description: Weekly repo hygiene — fix doc-vs-reality drift, then tidy memory. Run by hand.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-18T18:36:19Z'
  previous-modified: '2026-09-18T18:14:35Z'
  revision: '5'
  content-sha: 5dc24fe29e8f
---

# Maintain repo

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

One weekly pass. Two skills back-to-back, in order.

## Always a full sweep — never a delta

Every run is holistic. Never restrict scope to files changed since last sweep, git-log windows, "recently touched" surfaces, or a diff against a prior report. Sweep the complete inventory of prose surfaces and the complete set of memory files every time. Drift accumulates hardest in files nobody touched — the ones a delta sweep skips are exactly the ones that get most wrong. If a report ever justifies coverage by pointing to a last-run date, it is not a full sweep and does not satisfy this skill.

## Order matters

Truth first, shape second. Consolidating memory before auditing merges two wrong notes into one wrong note. Fix reality-drift, then dedupe.

## Gate — no memory, no run (Dan, 2026-09-18)

Before step 0, resolve the memory set the way step 2 does (`docs/agents/memory/` when the repo commits its
notes, the auto-memory directory only when it does not) and count its files. **Zero files on a repo with
commit history is a stop, not a finding**: the memory exists where this session cannot see it (a cloud
container holds no copy of the desktop's auto-memory). Report the resolved path and the count, name what
unblocks it — run on the desktop, or commit the notes into the repo as `docs/agents/memory/` + `MEMORY.md` —
and end there. Never run steps 0–2 on a repo whose memory is unreachable; "0 files, nothing to consolidate"
is a false report. The one exception is a repo with fewer than ten commits, and the report says so.

## Step 0 — ticket-reaper

Run `/ticket-reaper` first: it parks belt-and-suspenders tickets in the Maybe Someday milestone
and closes the moot ones, so the two steps below do not spend effort keeping speculative work
consistent. Its digest is on the repo's "Ticket reaper digest" issue.

## Step 1 — consistency-audit

Invoke `/consistency-audit`.

It sweeps every prose surface (README, CLAUDE.md, ADRs, PRDs, runbooks, memory files, doc generators), verifies each claim against primary sources (live measurement > code > git > tracker), fixes stale claims in place, and hunts the generator that republished drift. Owner-decision items go through `/triage` or `/to-tickets`, not inline. Full inventory every run — no "unchanged since last sweep" shortcut.

**Completion criterion:** the audit's report lists every prose surface inventoried, every claim checked, every fix applied, every drift-generator named, and every owner-ruling item filed as a ticket with a number. A report ending without the ticket numbers is not done. A report scoped to changed files only is a failure regardless of counts.

## Step 2 — consolidate-memory

Invoke `/consolidate-memory` (local override at `${CLAUDE_PLUGIN_ROOT}/skills/consolidate-memory/`, which wraps the anthropic-skills version with the full-sweep rule).

It walks every note plus `MEMORY.md` in the repo's memory set — `docs/agents/memory/` when the repo commits its notes (the auto-memory directory is then a pointer on the PC and empty in a cloud container), the auto-memory directory only when the repo has no `docs/agents/memory/` — merges duplicates, retires dated entries, converts relative to absolute dates, and trims the index under 200 lines / 25KB. Every file every run — never "only files added since last consolidation".

**Completion criterion:** the summary names files touched and reports the resulting `MEMORY.md` line and byte count under the limits. Any line still over 150 chars or file still overlapping another is a failure. A summary listing "N new files reviewed" without confirming the full set was walked is a failure. A summary reporting zero files read is not a completion at all — it is the gate above having been skipped.

## Report

State: surfaces audited, drift fixes count, generators repaired, tickets filed with numbers, memory files merged/retired, final `MEMORY.md` line and byte count.
