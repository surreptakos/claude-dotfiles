---
name: consistency-audit
description: Prose-vs-reality audit of a repo's documents against code, git, the tracker and live state. Use when docs contradict each other or misstate what is built or shipped ("X is already implemented" when it isn't, or the reverse), or to wire a repo's docs/claims.json tripwire.
metadata:
  modified: '2026-09-25T23:18:11Z'
  previous-modified: '2026-08-26T14:35:01Z'
  revision: '2'
  content-sha: a362efab595d
---

# Consistency audit — make every document agree with reality

Check every factual claim in the repo's prose against its primary source, fix what is stale, and
kill the scripts that generate drift. Drift has three known root causes; the report names which
it saw:

1. Nothing sweeps prose when state changes — rulings, issue closes and deploys update code and
   tickets, not sentences.
2. Tracker audits compare tracker to commits and never read prose.
3. Partial fixes correct the doc where the error was noticed and miss the same fact's other
   spellings, so docs disagree with each other.

## Ground rules — read before touching anything

0. **Full sweep, every run.** The scope is the complete prose inventory as it stands today: every
   surface is re-verified whether or not anyone touched it, because untouched surfaces are where
   drift hides. A prior audit report is a comparison point at the end, never a scope at the
   start. An inventory smaller than the repo's actual prose surface count means the audit is
   broken — restart it with a complete inventory.
1. **Primary source outranks any document.** Authority order: live measurement > code as it
   reads today > git history > tracker state. A doc is never evidence for a doc.
2. **Verify before editing — subagent findings included.** Re-grep every file:line cite, re-read
   every "function X does Y", re-check every "issue N is closed" against the tracker before
   writing the fix. Agents report plausible cites that are wrong, and one unverified fix is the
   next generation of drift.
3. **Protected facts stay protected.** A project CLAUDE.md block marked "measured live, do not
   re-derive" outranks contradicting prose — fix the prose. If the world may have changed since
   the measurement, re-measure, then update both, date-stamped. A measured fact is never softened
   to match a doc.
4. **Dated history is not stale.** A handoff or report section describing what was true on its
   date stays as written: append a dated update line, or head the doc "historical record — kept
   for X" when it no longer describes the present (obsolete procedure docs included). Anything
   that records a measurement stays.
5. **Closing-keyword hygiene.** GitHub's linkifier closes an issue when a closing keyword
   (Fixes/Closes/Resolves, or prose like "closed") immediately precedes its number, anywhere in a
   commit or doc — prose about the hazard included. Write "issue 88" with no `#`, or put the
   number before the keyword.
6. **Live facts are measured, not documented.** Which environment is live, which triggers are
   installed, which flags are set: run the project's diagnostic (`ping`, `listInstalledTriggers`,
   whatever its CLAUDE.md names), and replace a stated value with a pointer to that diagnostic.
   Tracker-derivable facts (counts, status, enumerations GitHub Issues carries) likewise become a
   pointer. One source of truth per fact.
7. **Owner decisions become tickets.** Anything needing a human ruling (a threshold, a judgment
   call, a manual UI step) goes through the project's flow (`/triage` or `/to-tickets`) — not an
   ad-hoc fix, not a note buried in the report.

## Phase 1 — inventory every prose surface

List the surfaces before reading any, fresh from today's tree (rule 0):

- Root docs: `*.md` at repo root (README, CLAUDE.md, CONTEXT, AGENTS, HANDOFF, trace/report/
  follow-up files).
- Decision records: `docs/adr/*.md` (or the project's equivalent).
- Specs and PRDs: `.scratch/*/PRD.md`, `docs/specs/`, wherever the project keeps them.
- Runbooks and guides: `docs/runbooks/`, `docs/guides/`, `docs/agents/`.
- Agent memory: `~/.claude/projects/<project-slug>/memory/*.md` — memory drifts like any doc.
- Global config naming this repo: sections of `~/.claude/CLAUDE.md` that state facts about this
  project.
- **Generated docs AND their generators**: any doc a script builds (dashboards, indexes). The doc
  is never hand-edited; the generator is audited like prose, because a hardcoded claim inside it
  republishes drift on every CI run.

Done when every category above is enumerated and every surface deliberately skipped has a line
saying why. The count goes in the report.

## Phase 2 — extract the testable claims

Read every inventoried surface for claims a tool can verify. The recurring kinds:

- **Implementation status**: "X is implemented / not yet implemented / planned / TODO".
- **Ticket state**: "issue N is open / closed / blocked on".
- **Code cites**: `file:line`, function names, exported symbols, test counts.
- **Command spellings**: test commands, deploy commands, tool invocations.
- **Do/don't-call lists**: APIs refused, endpoints used, flags honored.
- **Counts and enumerations**: "five triggers", "three departments", "20 test files".
- **Status headers**: PRD/ADR "Status:" lines, acceptance checkboxes.
- **Cross-doc duplicates**: the same fact spelled in CLAUDE.md AND a trace doc AND an ADR — every
  spelling is a claim; note the siblings now so Phase 4 fixes them together.

## Phase 3 — verify each claim against its primary source

- Code claims: `Grep`/`Read` the actual code. Re-derive file:line from the code.
- Ticket claims: `gh issue view N --json state,title` (batch with `gh issue list --json`).
- History claims: `git log`, `git branch -a`, ancestry checks (`git merge-base --is-ancestor`).
- Live-state claims: the project's own read-only diagnostics, per its CLAUDE.md — an audit leaves
  the system it audits untouched.
- Count claims: recount (`node --test` output, `ls | wc -l`, the config file itself).

Fan out freely: parallel read-only agents per surface group, each returning
`claim → verdict → evidence`. The main thread re-verifies every finding it acts on (rule 2).
Done when every extracted claim carries a verdict and its evidence.

## Phase 4 — fix

- Update the claim. Date-stamp a correction that reverses a prior statement ("ruled X
  2026-08-25", "superseded by ADR-NNNN"), and leave a "superseded" note where another doc may
  cite the old finding.
- Repoint dead references (local ticket files that moved to GitHub, renamed functions).
- **Sibling sweep — the step partial fixes skip**: after each fix, grep the fact's key terms
  across the whole inventory and fix every other spelling in the same pass.

## Phase 5 — kill drift generators

For every generated doc, read the generator for hardcoded claims (commands, counts, lists) and
point them at the single source of truth (a config file, a constant the code also uses). One
killed generator prevents more drift than ten fixed sentences.

## Phase 6 — prove and land

1. `node --check` (or the language's equivalent) on every edited script.
2. Run the project's full test command — read it from the project's config.
3. Commit with rule 5 hygiene; push.
4. Run the project's tracker audit if it has one.
5. Confirm the push closed no issue that should have stayed open
   (`gh issue list --state closed --limit 10` and compare timestamps).

## Phase 7 — report

- Full-sweep confirmation: the total inventory count for this run, and confirmation that every
  surface was verified this run. A report that cannot state this fails.
- Counts: claims checked, claims fixed, files touched, generators killed.
- The fixes that change behavior or procedure, each in one plain sentence.
- Root causes observed (which of the three known ones, plus anything new).
- Ticket sweep: every surfaced item gets exactly one stated outcome — already tracked (number),
  not worth tracking (one line why), or needs a ticket (batched through the project's flow).
- Update the project's handoff/state doc with a dated section recording the sweep.

## Tripwire — pin the facts between sweeps

A sweep is a point-in-time fix; the `claims-audit.js` engine beside this file keeps facts pinned
between sweeps, driven by each repo's own `docs/claims.json`. When asked to wire a repo's
tripwire, or to add or change a claim, read [claims-tripwire.md](claims-tripwire.md) first: the
claim types, the wrapper test and the engine's exit codes.
