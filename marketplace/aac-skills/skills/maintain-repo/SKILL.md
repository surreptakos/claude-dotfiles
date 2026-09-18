---
name: maintain-repo
description: Weekly repo hygiene — fix doc-vs-reality drift, then tidy memory. Run by hand.
metadata:
  disable-model-invocation: 'true'
  modified: '2026-09-18T18:13:34Z'
  previous-modified: '2026-09-18T06:04:32Z'
  revision: '3'
  content-sha: aaa47ed2c66e
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

Before step 0, resolve the repo's memory directory (the auto-memory section of the system prompt names
it: `~/.claude/projects/<project-slug>/memory/`, plus `MEMORY.md`) and count the files in it. **Zero
files on a repo with commit history is a stop, not a finding.** A developed repo has memory; a container
that sees none cannot see it (cloud sessions hold no copy of the desktop's memory), and a sweep that
proceeds without it is a partial sweep reporting as a full one — which is what the 2026-09-18
aac-sales-cockpit run did before Dan caught it (PR #631 there). Stop, report the resolved path and the
count, and say what unblocks it: run on the desktop where the memory lives, or commit the memory into
the repo (`docs/agents/memory/` + `MEMORY.md`, injected by the SessionStart hook the way this repo's
own is). Do not run step 0, 1 or 2 on a repo whose memory is unreachable; do not report "0 files, nothing
to consolidate" as a result. A repo with fewer than ten commits and no memory yet is the one exception,
and the report says so.

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

It walks every `memory/*.md` file plus `MEMORY.md`, merges duplicates, retires dated entries, converts relative to absolute dates, and trims the index under 200 lines / 25KB. Every file every run — never "only files added since last consolidation".

**Completion criterion:** the summary names files touched and reports the resulting `MEMORY.md` line and byte count under the limits. Any line still over 150 chars or file still overlapping another is a failure. A summary listing "N new files reviewed" without confirming the full set was walked is a failure. A summary reporting zero files read is not a completion at all — it is the gate above having been skipped.

## Report

State: surfaces audited, drift fixes count, generators repaired, tickets filed with numbers, memory files merged/retired, final `MEMORY.md` line and byte count.
