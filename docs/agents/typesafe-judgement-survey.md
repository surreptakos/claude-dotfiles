# TypeSafe judgment survey — claude-dotfiles

Survey date 2026-09-23. Read-only: no code changed. Each swap below is its own later ticket.

## Context

TypeSafe's System One model (Jev, `POST https://api.typesafe.ai/v1/systemone`) answers narrow typed
questions about text: Noul (probability of yes), Choice (one of up to 255 options, with confidence),
Score (position on ordered levels). About 100 ms per call. It cannot count, do arithmetic or dates,
or run tools. Adversarial text can move an answer. In cloud sessions the proxy injects the
credential. The `typesafe@typesafe-ai` plugin carries the method (`skills/typesafe-ai/SKILL.md`),
and the live docs at `https://docs.typesafe.ai/llms.txt` are its source of truth.

The only prior use is the bill-intake shadow trial (`tools/typesafe-shadow-eval.js` and
`docs/agents/typesafe-judgement-survey.md` in that repo). Measure each swap here the same way before
it decides anything.

## Method

1. The skill: "Start from the behavior the user wants … Work backward to the judgments it needs.
   Keep known rules, calculations, exact lookups, and execution in code." It gives a method, not a
   repo-scan procedure. Its "Explore what to build" row points to the use-case map.
2. Pass 1, replacing fragile parsing: every regex or word list that answers a question about
   *meaning* in `tools/`, the hooks, `ask_matt_gate.py` and `ticket-fleet.js`, checked by reading
   the code and calling the live functions.
3. Pass 2, the use-case map (`/concepts/use-case-map.md`): its categories Harness Engineering,
   Model routing, LLM guardrails, Semantic code linting and Verification, checked against this
   repo's harness by opening the code at each site. These add judgments where no regex exists today.

## The rule for every candidate

Jev only adds a note or finding, or suppresses an advisory. Counts, facts about which tools ran,
GitHub closing syntax and every permission or publish gate stay in code. When the service is down
or the answer is unsure, today's code answers.

## Pass 1 — regexes over prose, ranked by live pain

| # | Site | Question | Today | Pain | Typed question | Code keeps | Eval set |
|---|---|---|---|---|---|---|---|
| 1 | YES reply lint, `profile/codex/hooks/ask_matt_gate.py:1166-1274` | Does the reply guess, hand work back, claim verification, overclaim a cause, or describe an unread source? | Five keyword regexes (`HEDGE_PATTERN`, `DEFLECTION_PATTERN`, `VERIFIED_CLAIM_PATTERN`, `CERTAINTY_PATTERN`, `SOURCE_CHARACTERISATION_PATTERN`) | Quoting a banned word is flagged: "The rule bans words like probably and should be" returns `YES hedge`. Runs on every reply. | One Noul per property, in the reply's own voice, with quoted or mentioned words excluded | `turn_tools` facts gating the last three, PYLONS strip, pre-send stamp | `profile/codex/hooks/tests/test_ask_matt_gate.py:505-516, 1107-1143` |
| 2 | stale-premise advisory, `tools/tracker-audit.js:1102-1159` (lists 155-209) | Does this open issue rest on something the cited closed issue settled? | 220-character proximity window; the code's comment says it "cannot read meaning, only proximity" | Issues 374 and 274; an ignore marker was added as an escape hatch | Choice per cited closed issue: premise, background, example, follow-up, none | `citedIssueNumbers`, `maskCodeRegions`, CLOSED lookup, `prd` and checkbox skips, ignore markers | `tools/tracker-audit.test.js:181, 562-600` |
| 3 | Correction detector, `ask_matt_gate.py:379-398` (#686) | Is the user correcting the assistant? | `CORRECTION_PATTERN` (`wrong`, `incorrect`, `should have`, …) | Fires on "what is wrong with the build?" and injects the correction protocol plus a Stop-time "CORRECTION NOT CLOSED" | Noul: does the user say the assistant's earlier claim, action or output was wrong or incomplete? | `SYSTEM_CHANGE_TOOLS` audit, nonce plumbing | Thin: `test_ask_matt_gate.py:873-902`; build more from logged prompts |
| 4 | ADHD opener and closer, `ask_matt_gate.py:1017-1154` (issue 177) | Is the first line an action or verdict? Is the last line one concrete next step? | 70-word `ADHD_IMPERATIVES` list, `ADHD_PAST_TENSE` (`\b[a-z]{3,}ed\b` also matches "speed", "need") | Misreads ordinary lines | Choice for the first line (action, verdict, preamble, context) and the last (next action, pleasantry, other) | List cap, bullet counts, fence rules, flag file | `tools/ask-matt-gate-adhd.test.js:77-170` |
| 5 | claude-md-lint semantic rules, `tools/claude-md-lint.js:112-197` | Is this line volatile state, code-derivable, self-evident or ambiguous? | Regex lists `VOLATILE`, `CODE_DERIVABLE`, `SELF_EVIDENT`, `AMBIGUOUS` | `profile/claude/CLAUDE.md:261`, the rule against volatile content, is itself flagged volatile; the rules went warn-only for that file (`PATH_WARN_ONLY`) | Noul per rule per line | Size and emphasis counts, duplicates, fences, per-path warn-only | `tools/claude-md-lint.test.js` plus the live findings |
| 6 | Wrap-up detection, `profile/claude/hooks/session-gate.js:226-237, 291` | Is the user ending the session? | `END_INTENT` alternation, "deliberately narrow" | Misses "let's stop here" | Noul: does the user ask to finish this working session, not a task inside it? | `/session-end` literal, cooldown, a 3-second timeout that falls back to the regex | `profile/claude/hooks/session-gate.test.js:93-160` |
| 7 | landed-but-open mentions, `tracker-audit.js:1029-1099` | Does a commit naming #N finish it, part-fix it, or only refer to it? | `/#(\d+)\b/` on the subject line; the comment says "A partial fix and a passing reference look identical from here" | aac-cockpit #220 and #244 | Choice: completes, partial, reference | `CLOSING` keyword hard finding (GitHub semantics), `stripCode` | To build |
| 8 | Not-planned box wording, `tracker-audit.js:67-85` | Does an unticked box say it was dropped, superseded or moved? | `NOT_PLANNED_PATTERNS` | ticket-reaper writes the audit's own wording to satisfy the regex (d446ddd1) | Noul with a high floor, advisory tier only | The regex, for everything `tools/closure-guard.js` and `tools/tick-acceptance-boxes.js` act on | To build |
| 9 | Blocked-by line meaning, `tracker-audit.js:798-830` | Is each `#N` line a blocker, a merge-order note, or context? | `NON_GATING = /\bmerge\s+after\b/i` | Issues 390 and 364 | Choice per line | Section bounds, native-edge comparison, open-state filter | `tools/tracker-audit.test.js:216-246` |
| 10 | Performance-review wording, `aac-skills/aac-performance-review-audit/review_gate_tools.py` (copy in `aac-review-self-check/review_format_check.py`) | Does each strength or weakness name a specific account, describe instead of prescribe, and avoid "his manager"? | Capital-word heuristics with a `STOP` list that hard-codes one person's name | No tests; the edge case is conceded in a comment | One Noul per property | Date, `$` and `%` anchors, sentence counts, exact rating phrases | To build |

Two more with no regex to replace: `tools/issue-metadata-audit.js:140-177` could suggest a milestone
(Choice over open milestones plus none, never assigned), and `tools/tick-acceptance-boxes.js` could
ask whether the quoted evidence covers a box before ticking it (it may only withhold a tick).

## Pass 2 — use-case map categories

Every row below was checked by opening the cited code. Paths are `aac-skills/ticket-fleet/ticket-fleet.js`
unless named.

| # | Map category | Site and evidence | Judgment | Code keeps | Risk | Eval data |
|---|---|---|---|---|---|---|
| A | Model routing | `:51` sets one `implModel` for every implementer (used at `:1300` prober, `:1674` implementer). Attempts 2 and 3 reuse it. The scout schema (`:604-619`) has no size or difficulty field. | Score over `title`, `criteria` and `repoMap`: single-file mechanical, multi-file, design-level. Code maps the level to a model per ticket and per attempt. | Pin table, attempt loop, verifier as the real gate | Gates nothing; a weak first attempt is caught by the verifier | Branch names record the attempt (`agent/issue-N-attemptK-…`, `:1649`); tickets that needed attempt 2+ are free "hard" labels |
| B | Semantic code linting | `aac-skills/aac-house-writing-standard/scripts/wr001-lint.js:5-7`: "Judgment rules (5, 6, 8, 9, 10, and all of Part XXV except 165) are not checked here and never will be". `profile/claude/tools/stopslop.py:13-16` leaves Rules 154, 161, 166 to a reader. | Noul per unit: Rule 5 (main point first, opening paragraph), Rule 6 (passive hiding responsibility, sentence), Rule 10 (filler beyond the list, sentence), Rule 162 (kicker or recap, last paragraph), Rule 164 (dramatic fragmentation, paragraph). Rules 8, 154, 161, 166 need evidence or the whole document and stay with a reader. | Phrase registers, ERROR tier, counts | `profile/claude/hooks/stopslop-stop.py` exits 2 on ERROR, so Jev findings stay WARN-only | No stopslop tests; Preferred/Avoid pairs in the standard's `references/CORE.md:67-124` as fixtures |
| C | LLM guardrails | The scout copies `criteria` "verbatim from issue + comments" (`:613`, `:1092`) with no comment-author filter (`:555`, `:566`). It lands in the implementer (`:1666`), prober (`:1287`), probe verifier (`:1337`), handoff (`:1422`) and code verifier (`:1760`). Nothing checks it for instructions aimed at the agent. | After the scout, one Noul per ticket on `criteria`: does this text tell the agent to act outside a repository change for this ticket (secrets, other repos, push or merge, ignoring rules)? Flag in the run log or hold the ticket for the owner. | Worktree isolation, tree guard, no-merge rails, permission mode | Never the only guard | None; build from closed tickets plus planted injections |
| D | Verification | The verify stage (`:1729-1768`) runs tests and reads the diff; it needs tools, so it stays an agent. `tools/tick-acceptance-boxes.js:160-171` checks only that the PR merged and closes the issue, then ticks every box "verified in PR #N". | In the tick script, one Noul per box: does the verifier evidence quoted in the PR body show this criterion met? Low probability withholds that one tick and adds a note. | Merge and closing-reference checks, `untickedBoxes`, verifier verdict, CI | Can only withhold; the script runs as a `pull_request_target` workflow, so the key is an Actions secret | `tools/tick-acceptance-boxes.test.js` (10 tests); closed fleet PR bodies paired with their issues |
| E | Search and retrieval | `tools/repo-memory-load.js:11-13` injects note NAMES once at SessionStart; nothing matches notes to the prompt. Each note has a `description:` line. | On UserPromptSubmit, one Noul per note (about 37, one batched request): is this note relevant to the request? Inject the top 1-3 descriptions. | Index parsing, byte budget, file reads | Gates nothing; about 100 ms per prompt | None; build from logged prompts plus the notes each session opened |
| F | Model routing (harness) | `profile/codex/hooks/ask_matt_gate.py:28-51` lists `ALLOWED_FLOWS`; `:432-440` leaves the route choice to prose hints. | Choice over the flows on the prompt, injected as a suggested route. At Stop, a note only when the declared route differs at high confidence. | Declaration, nonce, `_publish_gate` exact token | Advisory; never replaces the declaration | Declared flows in the governance log; prompts not logged yet |
| G | Map-reduce over agent output | `:1997` flattens every implementer's `discoveries`; the follow-ups writer appends them verbatim to `FOLLOW-UPS.md` (`:2016`) with no dedupe. | Noul per candidate pair (found by code on shared path or symbol): same finding as bullet or open issue Y? Annotate "likely dup of #N"; never drop. | Candidate search, the append | Annotation only | 87 bullets in `FOLLOW-UPS.md` plus tracker triage outcomes |

Opened and rejected in pass 2: `aac-skills/consistency-audit/claims-audit.js` (claim types are
structural); the fleet's env-probe, blocker-state and open-pr-scan agents (they read command output
and need tools); `HANDOFF.remainingKind` (the same agent runs commands, so the call stays).

## Rejected

- Approval tokens, `ALLOWED_FLOWS`, `_publish_gate` (`ask_matt_gate.py:28-51, 620-700`): permission
  gates. Exact user tokens by design.
- Caveman switch regexes and `_caveman_lint` caps: command syntax and counting.
- `_tool_failed`, the config backup gate, `session-check/end-gate.js`: tool output, paths, secrets.
- `closingRefs`, `CLOSING`, `citedIssueNumbers`, `maskCodeRegions`: GitHub or marker syntax.
- ticket-fleet `keepOpen` regex and `kind`: already typed fields the scout fills; the regex fails safe.
- `check-evidence.js`, `build-dashboard.js`, `stale-ref-sweep.js`, `sweep-closed-to-done.js`,
  `session-check/check.js`: dates, numbers, URLs and structure.

## Next step for any candidate

File one ticket per swap. Run the Jev question in shadow beside today's code over the eval set, log
both answers, and switch only where Jev matches or beats the regex on the fixtures.
