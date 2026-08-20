---
name: contract-builder-project-state
description: "AAC contract-builder repo stood up 2026-08-19; wayfinder map on GitHub issue #1; charter decisions and what is pending"
metadata: 
  node_type: memory
  type: project
  originSessionId: 3b0c0ef5-c1fe-441f-87e6-d0e7df614ebe
  modified: 2026-08-20T00:57:22.610Z
---

Repo: https://github.com/surreptakos/aac-contract-builder (private, gh account surreptakos). Stood up 2026-08-19 from Cowork handoff zip; tag `handoff-2026-08-19` is the as-received tree, then flattened to root. Repo is authoritative; Cowork skill is a bridge consuming tagged releases.

Wayfinder map: issue #1 "Map: route to the contract-builder pilot". 12 child tickets (#2–#13), native sub-issues + dependencies. Blocked: #12 (platform/host) by #11 (Zoho research), #13 (in-house vs contractor) by #12. Frontier at creation: #2–#11.

Charter decisions by Dan (2026-08-19): tracker = GitHub Issues on the repo; map destination = route to pilot (ROADMAP step 8, Amanda parallel-run); fillable templates and agreement forms WILL enter the repo under `templates/` — supersedes handoff's stay-on-jobs-drive note for templates. Customer data still never enters, including git history.

Delivered 2026-08-19 (Additional Docs.zip): template fixtures under `fixtures/mock-jobs-root/` + `fixtures/New Agreements 8-22-19/` (SHA-256 in fixtures/SNAPSHOT-HASHES.md; jobs-drive copies stay production truth until cutover). TEMPLATES-MANIFEST.md at root governs remaining handover (#14) and the Drive-vs-repo authority question (#15). Lease calculator ruled obsolete by Dan — LEAF only, never build against it. RMR Items sheet: https://docs.google.com/spreadsheets/d/1ABfKpSdNrdm4DGV60RzyGcr2tzFYcmEYs2lXRSn772E — exported to fixtures/google-drive/ via clasp-token Drive API (refresh token flow works from ~/.clasprc.json); its first tab IS Contract Package Rules. Tickets #2 and #11 closed; #12 unblocked.

Machine facts: P: jobs drive NOT mounted on this dev machine — anything needing it is a HITL task for Dan (ticket #2 covers templates handover). `docs/agents/issue-tracker.md` holds wayfinder tracker operations; CLAUDE.md at repo root holds the seven hard rules.

Ticket #4 resolved 2026-08-19 (grilling): SCHEDULE-GENERATION-PROCEDURE §1/§6/§11/§11a/§12 ratified with amendments, carried by PR #16 (branch ratify/schedule-generation-1-6-11-12, awaiting Dan's merge = ratification act). Key rulings: domain-scoped precedence + proposal-vs-master hard stop; prevailing wage from labor COST column vs approved costs (Field Tech $55, FT-PW $100, Programmer $50, PM $75, as of 2026-08-19 — first recorded home is §1); merged work-up reconciliation rule; §6 description order (work-up Description if passes muster → references/PART-TRANSLATIONS.md → proposal via PR → rep question); largest unit price sort; kit sentence killed; dismissed-WARN line + deviation approval recorded in handoff email; stop-slop 1.1.0-custom vendored at skill/stop-slop/ (rubric for PROMPT.md 42/60). PartList export (2008 parts, recognition-only) at fixtures/exports/.

Ticket #7 resolved 2026-08-19 (grilling, PR #17 merged, main 9e9153a): MAPPING-APPENDIX §3a rewritten validation-only — drafter/reviewer NEVER derive prices; shipped figure comes from proposal and must reproduce from FSI on file. Dan's package-wide directive: all price-derivation rules gutted into new references/ESTIMATING-APPENDIX.md ("Estimating Build appendix", parked seed doc for later estimating build) — approved labor costs master table now lives THERE (§1 cites it), Repair Service derivation (1% basis unresolved, orphan flag kept per Dan), inspection formula, 50% software-passthrough markup, corrected Norway example ($46 = combined program, RS alone $21; Mark's $25 ruling recorded). Repair Service RMR bills from CUTOVER, not month 13 (MAPPING-APPENDIX §3a). Classification test for future sweeps: price derivation moves to estimating; validation/presentation anchors stay in package. OPEN-DECISIONS items 6–8 resolved. Recurring pattern now thrice-confirmed: price-setting questions are estimating's, never the drafter's — reframe before grilling Dan on them.

Ticket #3 resolved 2026-08-19 (grilling): golden set standard at docs/golden-set-standard.md (main 1422a85). Sanitization = FULL SYNTHETIC: deterministic tokens for all identifiers applied identically to facts and expected outputs; token mapping stays on jobs drive; git-history grep gates push; exception — ACCOUNT-RULES account keys retained on fixtures exercising them. Selection = ratified criteria (count 12: recency 12mo, system spread, RMR spread, CPD, LEAF-if-exists, sweep's clean package, resi+commercial), applied at export because P: unmounted. Export = HITL ticket #18 (wayfinder:task, child of map) into fixtures/golden/. Dan's training-data worry answered: identifiers carry no signal; jobs drive stays truth; lesson-mining lands findings not files (sweep precedent). PORTFOLIO-SWEEP.md stays as is.

Engineering work outside the map (proceeds anytime, no ruling needed): pytest harness, xlsx_surgical byte-fidelity test, facts-schema draft, gap report (KICKOFF-PROMPT tasks 3–5).

Session process note: the ask-matt PreToolUse gate blocks `gh issue create` unless declared route is to-spec/to-tickets/triage — declare to-tickets before publishing wayfinder tickets, in a separate tool call (the gate checks stored state before the command runs).
