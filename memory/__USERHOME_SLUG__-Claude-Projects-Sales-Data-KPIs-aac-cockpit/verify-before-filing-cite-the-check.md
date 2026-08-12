---
name: verify-before-filing-cite-the-check
description: "Never file or assert from a stale note — verify against git log, the live sheet, or the code first, and put the check in the issue so Dan doesn't have to re-derive it."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 83ee3ddd-d4d3-450c-bc41-19092153e8f4
  modified: 2026-07-29T15:53:57.150Z
---

Dan, 2026-07-29: "I don't understand why I keep having to double check your admin work." Fair. Every error that day was one pattern — **filing from the conversation summary or a `.scratch` note instead of from a source I could reach.**

What it produced: an issue claiming Mark's save bugs were unactioned when `git log --grep` shows five fix commits from that same day; an issue claiming `installTriggers()` had never run and publication was unarmed when `Report_Records` showed it firing that morning; and a claim that the `Account_Register` seed status was unknowable without adding an entry point, when the service-account key read it in one call.

**Why:** a stale note reads exactly like a fact, so there is no internal signal to catch it — only an external check catches it. Filing unverified work does not save time, it moves the verification onto Dan, which is the entire thing he is objecting to. The triage skill already mandates a redundancy search before filing; skipping it, not lacking it, was the failure.

**How to apply:** before filing an issue or asserting live state, check the reachable source — `git log --grep`/`-S` and closed issues for "was this already fixed", the live workbook for "did this run" (see [[live-workbook-id-sa-readable]]), the actual file for "does this code exist". Then **write the check into the issue**: the command run, the tab read, the commit found. That line is the marker Dan can scan instead of re-auditing; an issue without one should be treated as unverified. Related: [[nothing-lives-only-in-chat]].
