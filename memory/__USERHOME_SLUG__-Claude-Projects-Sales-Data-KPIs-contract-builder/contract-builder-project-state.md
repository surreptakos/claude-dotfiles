---
name: contract-builder-project-state
description: "aac-contract-builder non-derivable facts — Dan rulings, environment quirks, active constraints (repo/tracker state looked up fresh, never cached here)"
metadata:
  node_type: memory
  type: project
  originSessionId: 3b0c0ef5-c1fe-441f-87e6-d0e7df614ebe
  modified: 2026-08-26T17:15:33.310Z
---

Repo `surreptakos/aac-contract-builder` (local: `__USERHOME__\Claude\Projects\Sales Data KPIs\contract-builder`). Wayfinder map issue #1; spec #49; rulings on #41. **Scope rule (2026-08-25): this file holds only what repo/tracker cannot show — Dan rulings + rationale, environment facts, active constraints. Milestone status, merged PRs, backlog lists: query tracker fresh, never cache here.** See [[wrong-notes-self-perpetuate]] — a stale cached line here caused the templates incident.

**Environment (not in repo):**
- Scheduled task `AAC contract-pilot tick` operational details live in docs/pilot-runbook.md §2a — read that, don't trust memory for paths.
- Gate quirk: `gh issue create` blocked unless declared route is triage/to-spec/to-tickets; declare route per turn with the hook-supplied turn nonce. PreToolUse block kills the ENTIRE Bash call, including earlier commands in it. `gh issue edit` not blocked. See [[workflow-model-pinning]].
- Amanda field guide artifact: https://claude.ai/code/artifact/418f34c0-ad88-4021-8cbb-fe6fadf66c24 — hold handout until the template-staging ticket lands (currently issue #119; check `gh issue view` for live state before assuming).

**Dan rulings (with rationale, not recorded elsewhere or easy to miss):**
- Q3 (2026-08-25): state_of_incorporation required-when-assumed-name, no Illinois default, full state names from SOS record. ~1 deal ever had d/b/a; typical subscriber names are plain legal entities. '[Legal Entity], an Illinois corporation, d/b/a [Name]' fires only on assumed-name deals.
- Row layout: ruled 2026-08-31 grouped-fill, shipped PR #153. Closed.
- Spec session 2026-09-10 (issue #123 → spec #215, ADR-0001/0002): Dan's domain model — Customer has many Sites, Site has many Systems, Project = one work-order number spanning any sites+systems within ONE contract family; folder carries Z-number until sold then Amanda renames to WO number. Dan chose BUILD multi-site+multi-system (against the refuse recommendation) because golden-12/17 already carry 3 systems. Missing package situation on commercial = refuse, no default. FSI worksheet required only when THIS project sells Repair Service/Inspection. Release: auto on every skill-touching merge, PR into claude-dotfiles marketplace. Sweep doc stays frozen dated snapshot. History-leak (#188): accept ALL identifier classes, no rewrite ever.
- facts schema: 2026-08-25 'working doc' ruling SUPERSEDED 2026-09-10 — Dan ratified it as v1.0 into references/ (spec #215 stream A; effective when that ratification PR merges). Until then DRAFT markers accurate.
- MAPPING-APPENDIX 'duplicate cellular row' was a misread — one row only; note refers to upstream price-source duplicate.

**Standing lessons:**
- Issue #72: when fixing an output, verify the live path consumes it (composer fix was dead code; tick read a different field).
- Correction contract ratified via PR #81 merge (four rules in EXTRACTION-PROMPT.md "Correction rounds").
- Fixtures hold REAL company blanks — see repo CLAUDE.md runtime facts and TEMPLATES-MANIFEST.md before any artifact-existence claim.

See [[dan-never-reads-repo-reports]], [[decisions-via-question-tool]].
