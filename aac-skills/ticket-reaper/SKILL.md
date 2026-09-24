---
name: ticket-reaper
description: Sweep every open ticket in the current repo against the speed-over-robustness rule — park belt-and-suspenders work in the Maybe Someday milestone, close only what is moot, post one digest. Runs as step 0 of the weekly /maintain-repo; a standalone weekly Routine is not created yet (issue 664).
metadata:
  modified: "2026-09-23T22:38:28Z"
  previous-modified: "2026-09-23T15:12:08Z"
  revision: "6"
  content-sha: "a5278eef78e6"
---

# Ticket reaper

Dan, 2026-09-18: "We are being way too careful for internal tools that I will only ever share
with a small scrappy team. I need speed over robustness. We shouldn't be building solutions to
problems that don't exist yet. Defensive coding is bad." This skill applies that rule to the
tracker so it never re-fills with the tickets the 2026-09-18 sweep removed (77 closed).

## Setup

- Repo: `git remote get-url origin`. Read every open issue, all pages:
  `gh api "repos/<owner>/<repo>/issues?state=open&per_page=100&page=N"` until a short page.
  Skip pull requests (`pull_request` key) and anything already in the **Maybe Someday**
  milestone.
- The digest lands on the open issue titled **Ticket reaper digest** (label `orchestrator`).
  If it is missing, create it with that title and label and say so in the digest.
- The parking milestone is **Maybe Someday**. If it is missing, create it.

## Classify each ticket — read the body, not just the title

Three outcomes. When in doubt between park and leave, leave; when in doubt between park and
close, park.

**Park in Maybe Someday** — the ticket solves a problem nobody has hit, or hardens something
that works:
- guards against a failure seen zero times ("could", "would", "in case", "a future machine")
- a fallback or retry for a path that has not failed, a second check for something one check
  already covers, an exemption path for an advisory, an audit of an audit
- a "third pass" on wording, a doc note about a trap nobody fell into, a memory note about a
  capability nothing needs, an upgrade-table row, a wikilink spelling
- a probe or measurement with no decision waiting on it
- a discovery-triage chore (triaging a fleet run's bullets) — the bullets are speculative by
  construction; a real failure files its own ticket
- consolidation or hygiene with no user-visible change

**Close as not planned** — the ticket is moot, not merely cautious:
- its subject was deleted, retired or superseded (a mirror, a flow, a design replaced by a PRD)
- it is a duplicate of an open ticket (say which)
- it is already delivered (the text or code it asks for is on the default branch — quote it)

**Leave alone** — a real problem that bit, or work on a live route:
- a bug with a date and an observed failure in its body
- work a live route depends on today: a cut-over step, a PRD child whose body names the failure
  it removes. Being a PRD child, carrying a milestone, or having a ruling on it is not by itself
  a reason to leave it: judge the body. Assume nothing about the quality of an existing ticket
  from where it sits.
- anything labelled `ready-for-human`, `orchestrator` or `wayfinder:map` (rulings and state
  containers are never the reaper's)
- anything Dan pulled back out of Maybe Someday (an issue event shows the milestone change)
- Windows-only or PC-only work: the desktop is the live venue for the master orchestrators
  again (ADR 0001, `docs/adr/0001-orchestrator-masters-run-on-the-desktop.md`), so PC work is
  judged like any other ticket

## Land it

- Park: `gh api --method PATCH repos/<owner>/<repo>/issues/<n> -f milestone=<number>` (MCP
  `issue_write` in a container), labels untouched. A ticket already in another milestone moves
  the same way; the digest names the milestone it left. No comment on the ticket; the digest is the
  record.
- Close: one comment naming the reason class and the evidence (the open duplicate's number, the
  commit or line that delivered it). Then **nullify every unticked box** in the body — append
  ` — not planned: <reason class>, ticket reaper <date>` to each `- [ ]` line, leaving the box
  unticked (a tick claims verified; `not planned` is the wording `tools/tracker-audit.js` accepts
  as a legitimate closure). Then close with `not_planned` and swap the state label for `wontfix`.
  The label is what the audit exempts; the annotated boxes are what a reader sees.
- Digest: one comment on the digest issue, three lists (parked, closed, left with a one-clause
  reason where the call was close), counts at the top. A run that changes nothing still posts a
  one-line digest, so a silent week reads differently from a week the sweep did not run.

## Rails

- Never close a ticket that is parked, labelled `ready-for-human`, or younger than 48 hours.
- Never edit a ticket body except the box annotation on a close. Never touch labels except the
  state swap on a close.
- One run touches at most 40 tickets; list the rest under "not reached" in the digest so the next
  run starts there.
- A ticket Dan pulled back is left alone forever after: check the issue's events for a
  `demilestoned` on Maybe Someday before parking.

## In a cloud container

Same steps. `gh api` REST works through the proxy; `gh issue` (GraphQL) does not — use MCP
`list_issues`, `issue_write`, `add_issue_comment` for the same calls. Page explicitly
(`&page=N`), never `--paginate`.
