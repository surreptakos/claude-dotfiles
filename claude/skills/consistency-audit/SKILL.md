---
name: consistency-audit
description: Repo-wide prose-vs-reality audit. Verifies every factual claim in the repo's documents (README, CLAUDE.md, ADRs, PRDs, runbooks, trace docs, state logs, agent memory) against primary sources — code, git, the tracker, live state — fixes what is stale, hunts the scripts that generate drift, and reports root causes. Use when docs contradict each other or claim work states wrongly ("X is already implemented" when it isn't, or the reverse).
---

# Consistency audit — make every document agree with reality

Born from the 2026-08-25 aac-bill-intake sweep: ~60 stale claims across 33 files, including an
API trace listing a call as do-not-call while two live paths called it, six PRDs claiming
in-progress work that had shipped weeks earlier, and a dashboard builder hardcoding a dead test
command so CI re-published a stale claim on every run. Root causes, which this skill is designed
around: (1) nothing sweeps prose when state changes — rulings, issue closes, and deploys update
code and tickets but not sentences; (2) tracker audits compare tracker to commits and never read
prose; (3) partial fixes update the doc where the error was noticed and miss the same fact's other
spellings, making docs disagree with each other.

## Ground rules — read before touching anything

1. **Primary source outranks any document.** Authority order: live measurement > code as it reads
   today > git history > tracker state > another document (never). A doc is never evidence for a
   doc.
2. **Verify before editing — including subagent findings.** Agents report plausible file:line
   cites that are wrong. Re-grep every cite, re-read every "function X does Y", re-check every
   "issue N is closed" with the tracker before writing the fix. One unverified "fix" creates the
   next generation of drift.
3. **Protected facts stay protected.** Project CLAUDE.md blocks marked "measured live, do not
   re-derive" outrank contradicting prose — fix the prose. If you have reason to think the world
   changed since the measurement, RE-MEASURE, then update both, date-stamped. Never soften a
   measured fact to reconcile it with a doc.
4. **Dated history is not stale.** A handoff or report section describing what was true on its
   date stays as written. Do not rewrite history: append a dated update line, or head the whole
   doc "historical record — kept for X" when it no longer describes the present. Delete nothing
   that records a measurement.
5. **Closing-keyword hygiene.** In commits and docs, a closing keyword (Fixes/Closes/Resolves,
   and prose forms like "closed") must never immediately precede an issue number — GitHub's
   linkifier fires from anywhere in a message, including prose about the hazard. Write
   "issue 88" with no `#`, or put the number before the keyword.
6. **Live facts are measured, not documented.** Which environment is live, which triggers are
   installed, which flags are set — run the project's diagnostic (`ping`, `listInstalledTriggers`,
   whatever the project CLAUDE.md names). If prose states one of these as fact, the fix is
   usually to replace the value with a pointer to the diagnostic.
7. **Owner decisions become tickets, never inline fixes.** Anything the audit surfaces that needs
   a human ruling (a threshold, a judgment call, a manual UI step) gets a ticket through the
   project's flow (`/triage` or `/to-tickets`), not an ad-hoc fix and not a note buried in the
   report.

## Phase 1 — inventory every prose surface

Build the list before reading anything, so nothing is skipped silently:

- Root docs: `*.md` at repo root (README, CLAUDE.md, CONTEXT, AGENTS, HANDOFF, trace/report/
  follow-up files).
- Decision records: `docs/adr/*.md` (or the project's equivalent).
- Specs and PRDs: `.scratch/*/PRD.md`, `docs/specs/`, wherever the project keeps them.
- Runbooks and guides: `docs/runbooks/`, `docs/guides/`, `docs/agents/`.
- Agent memory: `~/.claude/projects/<project-slug>/memory/*.md` — memory files are prose surfaces
  too and drift the same way.
- Global config naming this repo: sections of `~/.claude/CLAUDE.md` that state facts about this
  project.
- **Generated docs AND their generators**: any doc a script builds (dashboards, indexes). The doc
  is never hand-edited; the generator is audited like prose, because a hardcoded claim inside it
  republishes drift on every CI run.

State the inventory count in the report. A surface deliberately skipped gets a line saying so.

## Phase 2 — extract the testable claims

Read each surface for claims a tool can verify. The recurring kinds:

- **Implementation status**: "X is implemented / not yet implemented / planned / TODO".
- **Ticket state**: "issue N is open / closed / blocked on".
- **Code cites**: `file:line`, function names, exported symbols, test counts.
- **Command spellings**: test commands, deploy commands, tool invocations.
- **Do/don't-call lists**: APIs refused, endpoints used, flags honored.
- **Counts and enumerations**: "five triggers", "three departments", "20 test files".
- **Status headers**: PRD/ADR "Status:" lines, acceptance checkboxes.
- **Cross-doc duplicates**: the same fact spelled in CLAUDE.md AND a trace doc AND an ADR — every
  spelling is a claim; note siblings now so Phase 4 fixes them together.

## Phase 3 — verify each claim against its primary source

- Code claims: `Grep`/`Read` the actual code. Re-derive file:line — never trust the cite.
- Ticket claims: `gh issue view N --json state,title` (batch with `gh issue list --json`).
- History claims: `git log`, `git branch -a`, ancestry checks (`git merge-base --is-ancestor`).
- Live-state claims: the project's own diagnostics, per its CLAUDE.md. Read-only ones only —
  an audit never mutates the system it audits.
- Count claims: recount (`node --test` output, `ls | wc -l`, the config file itself).

Fan-out is fine: parallel read-only agents per surface group, each returning
`claim → verdict → evidence`. The main thread re-verifies every finding it acts on (rule 2).

## Phase 4 — fix

- Update the claim, date-stamp corrections that reverse a prior statement
  ("ruled X 2026-08-25", "superseded by ADR-NNNN").
- Mark obsolete procedure docs as historical records (header note) instead of deleting.
- Repoint dead references (local ticket files that moved to GitHub, renamed functions).
- **Sibling sweep — the step partial fixes skip**: after each fix, grep the fact's key terms
  across the whole inventory and fix every other spelling in the same pass.
- Add "superseded" notes rather than silently rewriting a finding another doc may cite.

## Phase 5 — kill drift generators

For every generated doc, read the generator for hardcoded claims (commands, counts, lists) and
point them at the single source of truth (a config file, a constant the code also uses). One
killed generator prevents more drift than ten fixed sentences.

## Phase 6 — prove and land

1. `node --check` (or the language's equivalent) on every edited script.
2. Run the project's full test command — from its config, not from memory.
3. Commit with rule 5 hygiene; push.
4. Run the project's tracker audit if it has one.
5. Verify the push closed no issue that should have stayed open
   (`gh issue list --state closed --limit 10` and compare timestamps).

## Phase 7 — report

- Counts: claims checked, claims fixed, files touched, generators killed.
- The fixes that change behavior or procedure, each in one plain sentence.
- Root causes observed (which of the three known ones, plus anything new).
- Ticket sweep: every surfaced item gets exactly one stated outcome — already tracked (number),
  not worth tracking (one line why), or needs a ticket (batched through the project's flow).
- Update the project's handoff/state doc with a dated section recording the sweep.

## Automate — per-repo wiring for the claims-audit tripwire

A sweep is a point-in-time fix; the tripwire keeps facts pinned between sweeps. Same
generic-tool/per-repo-config shape session-check uses: `claims-audit.js` beside this SKILL.md
travels to every machine, and each repo declares its own facts in `docs/claims.json`.

**Recipe** — perform once per repo, after a consistency sweep has established the truth:

1. **Seed `docs/claims.json`** from the sweep. Every fact the sweep fixed becomes a claim.
   Pick the smallest claim type that captures the invariant — an `expected-text` claim on a
   whole paragraph is a maintenance drag; a `symbol-exists` or `command-single-source` claim
   on the load-bearing detail is not.

   ```json
   {
     "claims": [
       {
         "id": "test-command-single-source",
         "type": "command-single-source",
         "source": ".claude/session.json",
         "sourcePath": "test",
         "bindings": [
           { "doc": "README.md",       "occurrence": "Run `node --test tests/` before committing." },
           { "doc": "docs/runbook.md", "occurrence": "CI executes `node --test tests/` and then deploys." }
         ]
       },
       {
         "id": "public-api-symbols",
         "type": "symbol-exists",
         "doc": "docs/api.md",
         "source": "src/pipeline.js",
         "symbol": "processInvoice"
       }
     ]
   }
   ```

2. **Add a wrapper test** to the repo's suite so the tripwire fires on every CI run and every
   pre-commit gate. The wrapper is thin — the engine already exits 1 with one line per finding.

   ```js
   // tests/claims-audit.test.js in the consuming repo
   const { execFileSync } = require('node:child_process');
   const path = require('node:path');
   const test = require('node:test');

   const ENGINE = path.join(
     require('node:os').homedir(),
     '.claude', 'skills', 'consistency-audit', 'claims-audit.js'
   );

   test('docs/claims.json verifies clean', () => {
     execFileSync(process.execPath, [ENGINE], {
       cwd: path.join(__dirname, '..'),
       stdio: 'inherit',
     });
   });
   ```

   If the repo's canonical test command is something other than `node --test` (a `pytest`
   suite, a `powershell` runner), shell out to the engine from that runner instead — the exit
   code is the whole contract.

3. **Seed the four claim types** to the facts that failed the sweep most:

   - **token-subset** — for endpoint lists, flag inventories, enumerations the docs recite. The
     doc names every token; the code file emits every token; drift is one side that stopped
     matching.
   - **symbol-exists** — for API reference docs, trace files, ADRs citing a function name. Both
     directions: the doc must still cite it AND the source must still define it, so a rename
     that landed in code but not docs (and its inverse) both trip.
   - **expected-text** — for pinned prose the reader must see verbatim: a warning, a rule, a
     header a script parses. Use sparingly; a whole-paragraph claim breaks on any edit.
   - **command-single-source** — for commands quoted across README/runbook/CI docs whose source
     of truth is a config file (`.claude/session.json`, a workflow YAML, a package.json script).
     Bindings are explicit doc positions — dated history files stay exempt because they are not
     bound.

4. **Wire the wrapper into pre-commit and CI.** A test that runs only on demand is a report,
   not a tripwire. The engine's exit codes are:

   - **0** — every claim verified clean.
   - **1** — one or more findings; one tab-separated line per finding on stdout
     (`<claimId>\t<docPath>:<lineNo>\t<message>`). Broken claims land here too — an unknown
     `type`, a missing `doc`, a missing `source`, or a malformed field — so one broken claim
     never masks the rest of the audit.
   - **2** — audit-level configuration error: the claims file itself is missing, is not valid
     JSON, or is not the expected shape. Anything scoped to a single claim never trips exit 2.

   Surface all three to the caller so a runner can tell "the tripwire fired" apart from "you
   pointed me at nothing".

5. **Extend claims.json as the world changes.** A new claim is a JSON edit, never an engine
   edit. If a repo needs a claim type this engine does not offer, that is a signal for a
   ticket back to this skill's engine — the point of the declarative shape is that per-repo
   config never forks the engine.

The first consumer is `aac-bill-intake` (issue 326): its seed claims are the concrete fixtures
this engine was designed against.
