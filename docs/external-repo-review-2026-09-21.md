# External repo review — 2026-09-21

Twenty-three external sources reviewed against this repo's skills, hooks and plugin payload, by
six parallel sub-agents. Each group read the external tree (shallow clone) and the local skills it
competes with. Verdicts are ADOPT WHOLE, BORROW PARTS or SKIP.

**Nothing here is ADOPT WHOLE.** Seven borrows are named below, ranked at the end.

Metadata caveat: `gh api` returned HTTP 403 for repos not attached to the session. Stars and
licences come from shallow clones (`LICENSE`, `git log -1`), ungh.cc or shields.io, and are marked
where a number could not be cross-checked.

## Group 1 — browser automation

Local baseline: `aac-skills/agent-browser/` (56-line stub over the Rust/npm CLI, CDP plus
accessibility-tree refs) and `aac-skills/playwright-cli/` (SKILL.md plus nine references: refs,
named sessions, storage state, network mocking, tracing, video with chapters).

| Repo | Licence | Last commit | Verdict |
|---|---|---|---|
| browser-use/browser-harness | MIT | 2026-09-07 | BORROW PARTS |
| browser-use/browser-use | MIT | 2026-09-15 | SKIP |
| browser-use/jev-ultrafast | MIT | 2026-09-18 | SKIP |
| stablyai/orca | MIT | 2026-09-20 | SKIP |

- **browser-harness** is a Python/uv daemon giving an LLM a raw CDP REPL plus 17 interaction-skill
  docs. Two conventions are worth copying, no code: the `domain-skills/<host>/` per-site playbook
  lookup, and its recording discipline (keep the exact returned path, never reenact a finished
  run, never guess from `--latest`). Land both in `aac-skills/playwright-cli/references/`.
- **browser-use** runs its own `Agent(task, llm).run()` loop. Adopting it nests a second,
  separately billed LLM inside Claude Code's loop instead of Claude driving a tool directly.
- **jev-ultrafast** is a research prototype for a dynamic-action-space policy; it needs TypeSafe
  and a small text model, and ships no skill surface.
- **orca** is an Electron IDE. Its `snapshot`/`click`/`fill` commands only run inside its own app.

Conclusion: `agent-browser` plus `playwright-cli` already cover this space at or above the depth of
every candidate.

## Group 2 — context, compaction, memory

Local baseline: the caveman skill and CLI, `handoff`, `consolidate-memory`, `docs/agents/memory/`
with `tools/repo-memory-load.js`, the `state-stash.js`/`state-rehydrate.js` PreCompact pair, and
ask-matt's smart-zone rule.

| Repo | Licence | Last commit | Verdict |
|---|---|---|---|
| Astro-Han/karpathy-llm-wiki | MIT | 2026-07-24 | BORROW PARTS |
| mksglu/context-mode | Elastic 2.0 | 2026-09-20 | BORROW one convention |
| tamaratran/fast-jev-compaction | MIT | 2026-09-17 | SKIP |
| Tencent/WeKnora | see note | 2026-09-21 | SKIP |
| paperless-ngx | — | — | SKIP |

- **karpathy-llm-wiki** carries a Grounding Invariant: every number, date and quote in a compiled
  article must appear verbatim in its linked raw source, enforced by a grep-based
  `scripts/check_evidence.py`. `research`, `research-synthesis` and the memory notes have no such
  check. This is the strongest borrow in the group.
- **context-mode** routes agents to analyse data by writing code rather than reading raw data into
  context. Worth one line of prose in `research`. The MCP server and sandbox duplicate caveman and
  cavecrew, and Elastic 2.0 is source-available, not open source.
- **fast-jev-compaction** never summarises: it scores tool calls and deletes the low scorers,
  keeping the rest verbatim. That is the opposite of `state-stash.js`'s lossy digest, and an
  interesting idea. It needs `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and a paid `TYPESAFE_API_KEY`.
- **WeKnora** is Go, Postgres, pgvector, Docker and Helm. Its badge says MIT while its LICENSE file
  is a Tencent notice wrapper; that mismatch alone is a reason to leave it. Wrong shape for a repo
  whose restore path is a PowerShell whitelist.
- **paperless-ngx** archives scanned paper. Not agent memory.

## Group 3 — writing standard vs the slop repos

Local baseline: AAC-WR-001 in `aac-skills/aac-house-writing-standard/references/`, its
`scripts/wr001-lint.js`, and the `stopslop-stop.py` / `stopslop-write.py` hook pair.

| Repo | Licence | Stars | Verdict |
|---|---|---|---|
| blader/humanizer | MIT | 50,670 | BORROW PARTS |
| petergyang/no-ai-slop | MIT | 10,806 | BORROW PARTS |

**The house standard wins on scope and on citation discipline.** It covers punctuation, numbers,
layout, front matter and contract deliverables, none of which either repo touches, and it carries
numbered rules a reviewer can cite. Both externals are prose lists.

Coverage already in the house copy, by rule: faux insight 156, colon reveal 157, importance
puffery 158, superficial -ing 159, weasel attribution 160, synonym cycling 161, fake-profound
kickers and recap endings 162, interpretive metadiscourse 163, formulaic structures 164,
formatting slop 165, empty adverbs 155, em dashes 23. Appendix H covers binary contrasts, negative
listing, dramatic fragmentation and rhetorical setups.

House rules the externals lack: false agency (H5), narrator from a distance (H6), and the business
jargon swap table (G3).

Gaps the externals expose:

1. No enumerated single-word ban list. Their combined list is roughly 40 words after dedup
   (delve, foster, leverage, utilize, facilitate, tapestry, realm, paramount, transformative).
2. No rule against avoiding is, are and has, the fake-strong-verb tell both repos name.
3. No straight-quote mandate; Rule 26 governs quotation use, not glyph choice.
4. A live conflict: humanizer 3.0.0 dropped synonym cycling, arguing it is a human habit, while
   house Rule 161 still bans it. The decision register in `TERMINOLOGY.md` is silent on this.
5. `no-ai-slop`'s `eval.md` self-check is a good model for the Rule 166 release check.

**Blocking defect found while checking this, verified directly.** Both stop-slop hooks run
`import stopslop`; no `stopslop.py` exists anywhere in the repo, and `profile/claude/tools/` does
not exist. The import raises, the handler writes a line to stderr and returns 0, so the gate passes
every turn. Neither script is referenced from `profile/claude/settings.json`, so nothing invokes
them in the first place. `TERMINOLOGY.md` records that Rules 153 to 166 and Appendices G and H were
adopted as a snapshot of an unmerged stop-slop pull request: the prose came across, the detector
did not.

Most of these patterns are judgment calls, and `wr001-lint.js` says so: it excludes all of Part XXV
except Rule 165. The mechanical half (word lists, phrase lists) belongs in the missing detector,
not in the WR-001 linter.

## Group 4 — dev workflow collections vs ask-matt

| Repo | Licence | Stars | Verdict |
|---|---|---|---|
| addyosmani/agent-skills | MIT | 98k | BORROW PARTS |
| affaan-m/ECC | MIT | 264k | BORROW PARTS |
| tech-leads-club/agent-skills | MIT / CC-BY-4.0 | 6.6k | BORROW PARTS |
| kunchenguid/firstmate | MIT | 6.9k | SKIP for ask-matt, borrow for ticket-fleet |
| BuilderIO/agent-native | see note | 5.3k | SKIP |
| chaitanyagiri/munder-difflin | MIT | 7.7k | SKIP |

**Ask-matt is better overall, for one reason: it is a state machine, and they are catalogues.**
Grill, spec, tickets with blocking edges, implement, review, simplify is one vocabulary with
durable state in CONTEXT.md and ADRs. ECC has 292 skills, 68 agents and 94 commands with no shared
router. tech-leads-club has 92 skills in 14 categories. Breadth without a funnel means the agent
picks, and the pick is the failure point.

Only `addyosmani/agent-skills` is a real rival pipeline: DEFINE, PLAN, BUILD, VERIFY, REVIEW, SHIP
behind `/spec /plan /build /test /review /ship`. It is still flatter than ask-matt: a task list with
acceptance criteria, no blocking-edge graph, and no wayfinder equivalent.

Three gaps in ask-matt these repos expose:

1. **No mechanical gate.** Every ask-matt gate is judgment an agent can rationalise past. ECC's
   `delivery-gate` is a Stop hook running deterministic non-LLM checks. tech-leads-club's
   `tlc-spec-driven` ships Python validation scripts, "enforced by code, not memory". This repo
   already proves the point: the one mechanical writing gate it has is dead, and nothing noticed.
2. **No adversarial separation.** addyosmani's doubt-driven-development materialises a hostile
   fresh-context reviewer while correction is still cheap, before the diff exists.
   tech-leads-club enforces author is not verifier. Ask-matt's `implement` runs its own
   `code-review` in the same context. The blind refuting verifier in `ticket-fleet` already does
   this correctly; the single-session flow does not.
3. **No stopping rule for the interview.** `interview-me` interviews to about 95 per cent
   confidence against four named gaps: who, why, success, constraint. `grilling` states no
   threshold.

Three things ask-matt does that none of the six do:

1. Blocking-edge tickets with a frontier, not a flat task list.
2. Fog-of-war planning as its own mode, producing decisions rather than deliverables, with an
   explicit out-of-scope split. The nearest candidate produces one verdict document.
3. Content-hash skill stamps, CI-gated. ECC and tech-leads-club scan third-party skills for
   malicious code; neither verifies that a skill's own prose has not drifted since its last commit.

`firstmate` is fleet orchestration, not a single-session flow, and its supervisor contract is
sharper than the ticket-fleet runbook: a hard-rule priority order, crewmates never address the
captain, and event-driven wake instead of polling. `agent-native` is an app framework;
`munder-difflin` is an Electron supervision GUI.

Supply-chain note: tech-leads-club Snyk-scans every skill before publishing, citing 13 per cent of
marketplace skills carrying critical vulnerabilities. Irrelevant while every skill here is
hand-authored, and relevant the day this repo vendors an outside one.

## Group 5 — orchestration, worktrees, automated review

| Repo | Licence | Last commit | Verdict |
|---|---|---|---|
| max-sixty/worktrunk | MIT or Apache-2.0 | 2026-09-20 | BORROW PARTS |
| ColeMurray/background-agents | MIT | 2026-09-20 | BORROW PARTS |
| alibaba/open-code-review | Apache-2.0 | 2026-09-20 | BORROW PARTS |
| 777genius/agent-teams-ai | AGPL-3.0 | 2026-09-19 | SKIP |
| tt-a1i/archify | MIT | 2026-09-21 | SKIP |

- **worktrunk** is a Rust CLI for parallel-agent worktrees with a shared build cache and reflink
  copying. `tools/editable-install-guard.js` exists only to repair the Python editable install that
  one worktree's install breaks for the others (issue 413). A shared cache prevents that instead of
  repairing it. Its `hooks.json` lifecycle is also a model for the tree guard's checkpoints. Taking
  the binary means a new PATH dependency in cloud containers; take the idea.
- **background-agents** runs fresh sessions per trigger, the same model as the four hourly cloud
  Routines. Its `docs/AUTH.md` states the GitHub App token scope and trust model in a table.
  `orchestrator/RUNBOOK.md` has no such section, and the fleet runs unattended with write access.
  Its multi-repo fan-out from one automation is cleaner than one Routine per repo, and is a ticket,
  not an edit.
- **open-code-review** splits review in two: a deterministic pass resolves files and per-path rules
  from `.opencodereview/rule.json`, then the host agent reviews. That split fits `code-review` step
  3 without taking the Go CLI.
- **agent-teams-ai** is AGPL-3.0, which is a copyleft risk for borrowed code, and a GUI app.
- **archify** renders architecture diagrams. Off-topic; it was a keyword match.

## Group 6 — open-seo

SKIP. MIT, last commit 2026-09-19. It is a hosted Semrush alternative: TanStack Start, Postgres or
D1, Cloudflare Workers. Its ten agent skills all require a `projectId` and its own paid MCP backend,
gated behind a 10 dollar per month subscription. AAC's work is internal tools, Apps Script, Zoho,
contracts and SOPs. Its repo-hygiene skills (`deslop`, `merge-ready`, `evaluate-skill`) are thin
wrappers over its own conventions, and `claude-md-lint`, `code-review` and `writing-great-skills`
already cover that ground.

## Local drift found along the way

- The container carries 21 skills absent from `aac-skills/`: 13 caveman ones, plus `cavecrew`,
  `investigate-first`, `lean-build`, `migration`, `safe-refactor`, `session-start-hook`,
  `surgical-patch`, `synced` and `verify-and-stop`. Eleven repo entries are absent from the
  container, including the seven design skills, `to-issues` and `to-prd`. The payload ships 54.
  Verified with `comm` over the two sorted listings.
- The stop-slop gate is dead, as described in Group 3.

## Ranked actions

1. **Write the missing stop-slop detector and wire it.** The hooks exist, the rules exist, the
   module does not, and nothing calls the hooks. Highest leverage, and independent of every
   external repo here.
2. **Add the grounding-invariant check** to `research` and `consolidate-memory`: grep every number,
   date and quote in a note against its cited source. From karpathy-llm-wiki.
3. **Add one mechanical gate** to the session-end path, on ECC's `delivery-gate` pattern:
   deterministic checks with no model judgment in the loop.
4. **Separate author from verifier in `implement`**, matching what `ticket-fleet` already does, and
   add doubt-driven-development's cheap-correction pass to `grill-with-docs`.
5. **Give the orchestrator runbook an auth and token-scope table**, on the `docs/AUTH.md` pattern.

Deferred, each worth a ticket rather than an edit: worktrunk's shared build cache replacing
`editable-install-guard.js`; open-code-review's per-path rule file for `code-review`; the
single-word ban list and the three writing gaps in Group 3; the synonym-cycling ruling; firstmate's
hard-rule list for the ticket-fleet supervisor; multi-repo fan-out for the Routines.
