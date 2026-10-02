---
name: to-tickets
description: Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).
disable-model-invocation: false
metadata:
  modified: "2026-10-02T21:53:39Z"
  previous-modified: "2026-10-02T21:09:54Z"
  revision: "13"
  content-sha: "c260f9de5181"
---

# To Tickets

Break a plan, spec, or conversation into a set of **tickets**: tracer-bullet vertical slices, each declaring the tickets that **block** it.

The issue tracker and triage label vocabulary should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes a reference (a spec path, an issue number or URL) as an argument, fetch it and read its full body and comments.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Ticket titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the work into **tracer bullet** tickets.

<vertical-slice-rules>

- Each slice cuts a narrow but COMPLETE path through every layer (schema, API, UI, tests): vertical, NOT a horizontal slice of one layer
- A completed slice is demoable or verifiable on its own
- Each slice is sized to fit in a single fresh context window
- Any prefactoring should be done first

</vertical-slice-rules>

Give each ticket its **blocking edges**: the other tickets that must complete before it can start. A ticket with no blockers can start immediately.

**A ruling ticket reads what already rules first.** Before filing a `ready-for-human` question, open the ADRs, owner-ruling comments and routine cards the question turns on, in every repo involved (attach a repo to read it). A question an accepted ADR already answers is an agent ticket that applies the ADR, not a ruling. Issue 1294 asked Dan to choose a live-tail cap that aac-routines ADR 0010 had settled three days earlier, and recommended against the ADR from a paraphrase of it (2026-10-02). An ADR the draft itself names is the first to open, and a document you wrote this session is a stand-in for the ADR it summarises: grep the ADR directory and the spec for the question's nouns before filing. aac-sales-cockpit 812 asked Dan to choose a hiring plan and "record the choice in ADR-0031", drafted from that session's own audit, and ADR-0031 had already put both plans on the VP's written boxes two months earlier (2026-10-02).

**Human-only halves get their own ticket, and "human" means a person is the only instrument.** Before labelling a step `ready-for-human`, ask whether a desktop session can do it: `gh` on the owner's PC reaches API paths the cloud proxy refuses (repo visibility, Actions access, cross-repo code search), and `agent-browser` on the owner's logged-in browser can work a settings dialog (a cloud environment's variables and setup script, a token page). Those steps are `ready-for-local-agent`, with the one tap only a person can give (a 2FA code, a sudo-mode password, a judgment call) named in the body. Dan, 2026-09-29, on four owner tickets a desktop agent could have done: "I don't understand why I have to do anything if you have the ability to use my computer and run commands and click around." When a slice contains a step only a person can perform (a decision or sign-off, a 2FA or password prompt, a judgment call), split that step into its own ticket labeled `ready-for-human` (or the tracker's equivalent), with the dependent agent ticket declaring it as a blocker — never a bullet inside an agent ticket's body, a PR-comment note, or a handoff-doc line. The owner works from a label query; a human step not carrying the label is invisible to the person who has to perform it (measured 2026-08-24: a PR-gating UI rename sat unseen in PR comments until the owner asked).

**Wide refactors are the exception to vertical slicing.** A **wide refactor** is one mechanical change (rename a column, retype a shared symbol) whose **blast radius** fans across the whole codebase, so a single edit breaks thousands of call sites at once and no vertical slice can land green. Don't force it into a tracer bullet; sequence it as **expand–contract**. First expand: add the new form beside the old so nothing breaks. Then migrate the call sites over in batches sized by blast radius (per package, per directory), each batch its own ticket blocked by the expand, keeping CI green batch to batch because the old form still exists. Finally contract: delete the old form once no caller remains, in a ticket blocked by every migrate batch. When even the batches can't stay green alone, keep the sequence but let them share an integration branch that all block a final integrate-and-verify ticket; green is promised only there.

### 4. Reap the draft, then quiz the user

Before anything is shown, run the ticket reaper's classification over every drafted ticket — the "Classify each ticket" rules in `aac-skills/ticket-reaper/SKILL.md` (Dan, 2026-09-18: speed over robustness; no solutions to problems nobody has hit). Judge each ticket's body the way the reaper would judge it a week after publishing: **passes** (a failure that bit, with a date and what was observed, or a step a live route needs today) or **would be reaped** (a guard against a failure seen zero times, a fallback for a path that has not failed, a second check over something one check covers, a wording pass, a probe with no decision waiting on it, hygiene with no user-visible change). When in doubt, it passes — the reaper leaves doubtful tickets alone too.

Present the breakdown as a numbered list in **two groups**, passes first, then would-be-reaped, keeping one numbering across both so blocking edges still resolve. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work
- **Reaper**: `passes`, or the one clause it trips (quote the rule, e.g. "guards against a failure seen zero times")

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct: does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?
- Of the would-be-reaped group, which (if any) to publish anyway — and why. The reason is an observed failure or a live dependency, and it goes into that ticket's body so the next reaper run reads it as evidence rather than caution.

A would-be-reaped ticket with a blocker or dependant in the passing group is flagged: dropping it breaks an edge, so either the user promotes it or the dependant's edge is rewritten. Iterate until the user approves the breakdown. Only the approved set is published; the rest is named in the session summary as "not filed, would be reaped" with its clause, so it is a decision on record and not a leftover.

End each round of the breakdown with `Next: reply tickets ok to publish.` Ask for that phrase and no other: the publish gate on the second `gh issue create` accepts `tickets ok` as the whole message, so a different go-word invented here is refused there (issue 1060).

**Called from `/session-end`: no quiz.** Typing `/session-end` is the approval (Dan, 2026-09-23). Show the breakdown in the reply, then publish every ticket, the would-be-reaped group included; the weekly reaper parks what should not have been filed.

### 5. Publish the tickets to the configured tracker

Publish the approved tickets. **How** depends on the tracker `/setup-matt-pocock-skills` configured; the tickets are the same either way, only the shape of the blocking edges changes:

- **Local files** → write one file per ticket under `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` in dependency order (blockers first). Each file's "Blocked by" lists the numbers/titles it depends on. Use the per-ticket file template below: one ticket per file, never a single combined file.
- **A real issue tracker (GitHub, Linear, …)** → publish one issue per ticket in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers. Use the platform's native blocking / sub-issue relationship where it has one; otherwise set each ticket's "Blocked by" to the blocking issues. Apply the `ready-for-agent` triage label unless instructed otherwise; the tickets are agent-grabbable by construction.

Work the **frontier**: any ticket whose blockers are all done. For a purely linear chain that means top to bottom.

Do NOT close or modify any parent issue.

<local-ticket-template>

# <NN>: <Ticket title>

**What to build:** the end-to-end behaviour this ticket makes work, from the user's perspective, not a layer-by-layer implementation list.

**Blocked by:** the numbers/titles of the tickets that gate this one, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion 1
- [ ] Acceptance criterion 2

</local-ticket-template>

<issue-template>

## Parent

A reference to the parent issue on the tracker (if the source was an existing issue, otherwise omit this section).

## What to build

The end-to-end behaviour this ticket makes work, from the user's perspective, not layer-by-layer implementation.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Blocked by

- A reference to each blocking ticket, or "None (can start immediately)".

</issue-template>

In either form, avoid specific file paths or code snippets: they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it and note briefly that it came from a prototype. Trim to the decision-rich parts, not a working demo, just the important bits.

## A ticket that follows a closed issue

The harness's `tools/tracker-audit.js` fires `[stale-premise?]` on an open issue whose prose cites a closed issue and reads as asserting it is still true. A ticket filed downstream of a shipped fix, a completed spec or an older closed ticket is a follow-up, not a stale premise, so its body says so in one of the two forms the audit's `isFollowUpAcknowledgment` accepts (the repo's AGENTS.md, "Follow-up ticket wording", where it has one):

- **`Follow-up to closed #N.`**, one line per closed issue cited. `Follow-up from #N`, `Follow-up: #N` and `Follows #N` match too.
- **`Discovered from PR #M`** (or a bare `#M`), where `#M` is the PR that closed `#N`. The audit resolves closer PRs at check time.

Put the line above the section headings (`## Parent`, `## What to build`), so it is the first thing a reader sees and the body scan does not depend on section order. A ticket citing no closed issue carries no such line.

Decide which cited numbers are closed by reading each one; never infer it. `gh issue view` is a GraphQL call that a cloud container's proxy refuses with HTTP 403, so in a container use the REST spelling (issue 360). Both answer `open` or `closed`:

```bash
gh issue view <n> --json state --jq .state                     # desktop (GraphQL)
gh api repos/<owner>/<repo>/issues/<n> --jq .state             # container (REST)
```

The rule covers the tickets this run publishes. Existing open tickets the audit already flagged are out of scope: do not edit their bodies from a `/to-tickets` run.

### In aac-routines: publish through `publish_ticket`

aac-routines makes the line mechanical (issues 106, 237). Publish every ticket through `src/aac_routines/publish_ticket.py` (`publish_ticket(...)`, or the CLI shim `scripts/publish_ticket.py`), which runs the fields through `render_ticket_body` in `src/aac_routines/to_tickets.py`; there is no body override. Pass `closed_issue_refs=(N, ...)`, the closed numbers the ticket's discovery cites, and the acknowledgment lands at the top of the body. It is pure by default: `dry_run=True` returns the body without touching GitHub, and `dry_run=False` posts it with `gh issue create --body-file -`. With `closed_issue_refs=()` the body renders exactly as the issue template above. `aac_routines.publish_ticket.lint_ticket_body(body, cited_closed_issue_refs)` flags a body that cites a closed issue without the wording, so fleet tooling can fail a run whose bodies drifted. The renderer queries nothing; the closed check in a container there reads:

```bash
gh api repos/surreptakos/aac-routines/issues/<n> --jq .state   # container (REST)
```

`tests/test_to_tickets.py` and `tests/test_publish_ticket.py` in aac-routines pin this section: the canonical phrase, the renderer and the publisher by name.

## In a cloud container: same duties, different instruments

A cloud session (claude.ai/code, Cowork) has no `gh` — `CLAUDE_CODE_REMOTE_SESSION_ID` set in the environment is the tell. Every process step above still applies; only publishing changes. Do not report a step as impossible because its `gh` spelling failed — use the GitHub MCP equivalent, same shape as the mcp branch of `aac-skills/ticket-fleet/ticket-fleet.js`:

| The step says | In a container use |
| --- | --- |
| `gh repo view --json nameWithOwner` | derive `<owner>/<repo>` from `git remote get-url origin` |
| `gh issue create --title ... --body ... --label ready-for-agent` | MCP `issue_write` method `create` (title, body, labels: `["ready-for-agent"]`) |
| `gh issue edit N --add-label ready-for-agent` | MCP `issue_write` method `update` (labels: existing + `["ready-for-agent"]` — `update` replaces the whole label set, so read the existing labels first with `issue_read` method `get_labels` and pass them all) |
| `gh issue view N --json number,title,labels` | MCP `issue_read` (verify the new ticket landed with the right label) |
| a sub-issue / blocking edge on GitHub | MCP `sub_issue_write` method `add` (parent's `issue_number`, the child's `sub_issue_id` — its ID from `issue_read`, not its number), or `issue_write` method `update` with a "Blocked by" body line if the tracker has no native edge |
| `gh issue comment N --body-file <path>` | MCP `add_issue_comment` (read the file into `body`) |

Publish the tickets in dependency order (blockers first) so each ticket's blocking edges can reference real identifiers — the same rule the local-vs-remote step above uses. When the tracker has native blocking / sub-issue relationships, prefer the MCP tool that carries them (`sub_issue_write`); otherwise fall back to a plain "Blocked by" line in the body pointing at the blocker's number.

Local-files mode (`.scratch/<feature-slug>/issues/`) is unchanged in a container — it is just file writes, no `gh` and no MCP needed. Read-only reference lookups can also go straight to REST — `curl https://api.github.com/repos/<owner>/<repo>/issues/<n>` — the session's egress proxy authenticates api.github.com, private repos included.

MCP write calls (create, update, comment) may raise a permission prompt; when the user typed `/to-tickets`, that prompt is the confirmation, not a reason to skip the step. Publish sequentially, not in one big batch — a failed create in the middle of a batch leaves the tracker in a state the user cannot easily read back.
