---
name: aac-sop
description: 'AAC SOP, as .docx: Procedure (cross-role process) or Work Instruction (one person, one task). Use when asked to write or recast an SOP, procedure, work instruction or WI, or to put a process, checklist or doc into our SOP format; also for "write up how we handle X" or "document the X process". Prefer over generic docx or runbook output.

  '
metadata:
  modified: '2026-09-25T23:17:42Z'
  previous-modified: '2026-09-16T04:48:08Z'
  revision: '3'
  content-sha: 9654a3cd1ebb
---

# AAC SOP Builder

Produces one document, a **Procedure** or a **Work Instruction**, as a Word file in AAC's house
format. The bundled generator owns structure and styling; you own the content, the tier choice, and
the judgment.

## Workflow

1. **Choose the tier** (see [Tiers](#tiers)). Done when `mode` is decided and any cross-role
   hand-off inside a task-level instruction is named as a separate Procedure.
2. **Run Discovery** (see [Discovery](#discovery)). Done when every item on its Establish list is
   verified from a source, answered by the user, or marked as a red flag. When recasting an existing
   SOP, read it first and **preserve its content** - only restructure, reformat, and clean wording.
3. **Draft every line to the [writing standards](#writing-standards-the-voice) and the
   [evidence rule](#evidence-rule).**
4. **For a Procedure, run the [brainstorm - curate - draft loop](#brainstorm---curate---draft-procedure-judgment-sections)**
   on every judgment section. A Work Instruction skips this step: its content is procedural and the
   brainstorm cost outweighs the payoff.
5. **Write the input JSON** for your tier, `mode` set, per `references/input-schema.md`: both
   schemas, the body item kinds, what the generator renders, and the example file to pattern-match.
6. **Generate the document:**
   ```bash
   npm install docx        # if not already present in the environment
   node scripts/build_sop.js <input.json> <output.docx>
   ```
   Validate the file structure with the docx skill's `validate.py` if it is available.
7. **Reader-test the `.docx`** as a cold performer (see [Reader Testing](#reader-testing)). Fix every
   gap in the JSON, regenerate, re-read. Done when a full read answers every checkpoint "yes".
8. **Deliver** the `.docx` with a short note listing every field still flagged in red (derived,
   assumed, or unverified), so the user verifies it. The list is as long as the evidence leaves it.

## Tiers

- **Procedure** (full template, `mode: "procedure"`) - the higher-level process: who does what,
  when, where, with hand-offs between roles and business decisions. Example: Service → Sales lead
  progression.
- **Work Instruction** (lean template, `mode: "work_instruction"`) - tells **one person how to
  perform one task**, step by step, usually with a specific tool. It covers only **how**; routing
  work between roles and deciding *what / whether / when* belong to a Procedure. Example: how an AE
  runs a site walk in System Surveyor.

**Litmus:** one role + one task + "how" → Work Instruction. Multiple roles + a hand-off +
"who / when / what-if" → Procedure. If a task-level instruction contains a cross-role hand-off, keep
the instruction as a Work Instruction and reference the hand-off as a separate Procedure rather than
bundling a procedure inside it.

**Work Instruction is the common case.** Most of what a field shop documents day to day is Work
Instructions, and a single-task tool how-to stays one however important it feels. Reaching for the
Procedure template there is the main over-documentation risk.

## Discovery

An SOP is only as good as the process behind it. Split the content into two layers:

- *Config / data layer* - facts that live in a system: field names and picklist values, org and
  account IDs, record owners, statuses in use, cycle times, counts. Resolve these yourself from the
  connectors and data, as far as the tools allow.
- *Process / tribal-knowledge layer* - how the work actually runs: the real sequence, what triggers
  each step, who does it and when, the required-vs-recommended calls, the sign-off gate, and the
  exceptions ("usually X, but sometimes Y"). This lives in practice, not in a system; the
  [evidence rule](#evidence-rule) governs how it is stated.

**Gather from sources in this order:**

1. This conversation, an attached document, or an existing SOP you are recasting.
2. Connectors, for the config/data layer (e.g., Zoho for module fields, picklists, owners, statuses).
3. Process evidence, for the tribal-knowledge layer: Fathom transcripts, email threads, and past
   chats where the team described how the work is actually done.
4. Only what none of the above resolves goes to the user, in **one batch**: a short numbered list
   they can answer in shorthand, by pointing you to a transcript or thread, or with "flag it" to
   leave the item as a red flag.

**Establish** (from the sources; ask only for what is still missing):

- The trigger - what starts this process or task.
- The boundaries - where it starts and where it ends, and what is out of scope or a separate SOP.
- The performer(s) and, for a Procedure, the hand-offs - who does what, by real name and role.
- Each step's how, and for a Procedure its when and its output - captured into `steps`/`procedure`,
  `responsibilities`, and `done_when`, not into any new field.
- The exceptions - the "usually X, but sometimes Y" cases. These are the highest-value content;
  route them to `ifthen`, `watch_out`, or a Procedure `exceptions` row.
- The completion criterion (`done_when`) and, only if performance over time matters, the metrics
  with targets.

**Scale discovery to where the content lives.** A single-tool Work Instruction whose facts are all
in-system or already in the conversation needs little or no elicitation - resolve and build. A
multi-role process with judgment and exceptions gets the full pass.

## Brainstorm - curate - draft (Procedure judgment sections)

Judgment sections carry the highest read-cost per line: the reader makes a decision from them, and
a single glib wording misdirects. **Applies to a Procedure only, and only to these sections:**
Trigger; Done when; each Exceptions row; each Responsibilities row; every `ifthen` branch in
`procedure[]`. Ordinary `step` and `bullet` items skip the loop.

1. **Brainstorm** - draft 2-4 candidate wordings for the section (or the row). Vary them along real
   interpretive axes: strictness of the trigger, what counts as "done", who owns an exception, how
   the branch condition is tested. Not stylistic variants of one wording.
2. **Curate** - cut every candidate that fails any of these:
   - Restates a step already in `procedure[]` (a common failure for Done when and Trigger).
   - Violates the evidence rule - asserts tribal knowledge no source confirmed.
   - Breaks one-action-per-step, must/may/should discipline, or plain-declarative voice.
   - Adds a condition the sources do not support.
   - Merges the two success measures - Done when creeping into Success Metrics.
   - For an `ifthen`, the condition is not testable or overlaps another branch with no default named.
3. **Draft** - write the surviving candidate into the JSON. If none survives, the section stays a
   red flag (`[ confirm ]` or `*_flag`), not a wording you settled for.

The loop is internal: only the winner ships.

## Reader Testing

Catches what the author cannot see: assumptions, missing preconditions, undefined terms, and
unstated decisions that a cold reader hits and stalls on. It runs at both tiers - a wrong SOP
shipped costs more than the test does.

Read the whole document from the first heading with **only what the document itself provides**, plus
the named tools and a realistic input for the role - the discovery conversation, the source thread
and your own memory of the process all stay shut. If a subagent is available, spawn one with only
the document and a role brief - the fresh context is exactly the reader you are simulating.

**Checkpoints, applied to every step:**

- **Precondition** - can the reader satisfy every prerequisite (access, artifact, sign-off, prior
  step)? Any implied one is a defect.
- **Term** - is every term the reader hits defined in the document or in a linked reference? Words
  like "escalation," "in-scope," "handoff-ready" fail without a definition.
- **Decision** - for every `ifthen`, is the condition testable, are the branches mutually exclusive,
  is a default named for the case none matches? An IF the reader cannot evaluate is a dead end.
- **Actor** - is it obvious who performs the step? Passive voice with no `responsibilities` row for
  the actor fails this.
- **Output** - the step produces something (a record, an email, a status change); is that something
  visible in the document as the input to a later step or as the `done_when`?
- **Cold-start** - a first-time performer with the document and the tools, no shadow, no
  phone-a-friend - can they complete this run?

Any "no" is a defect, not a nit. For a Work Instruction, apply the checkpoints to Steps and Watch
out for; read Sections and Appendices for reference value (does someone consulting this later find
what they need).

## Document layouts

**Procedure** (`mode: "procedure"`). Header block: Title, Department, Version, Effective
Date, Next Review, Prepared by, Approved by. Required body, in order: Objective → Scope →
Responsibilities → Trigger → Procedure → Done when → Revision Log. Optional body (rendered only when
populated): Exceptions & Escalation; Troubleshooting (diagnostic/field SOPs); Success Metrics;
References.

**Work Instruction** (`mode: "work_instruction"`). Lean header: Title, Department, Version,
Owner, Last updated (Approved by optional). Body, in order: Before you start (tools/access) → Steps →
Done when → Watch out for (optional) → reference Sections (optional) → appendices (optional).
Revision Log closes the document.

A simple WI is just numbered steps. A rich, tool-based WI (like the System Surveyor example) can also
carry - inside the Steps or in a Section - **reference tables** (e.g., required fields by device),
**template blocks** (e.g., a handoff email, rendered monospace), **color-swatch tables** (e.g., a
color-coding standard), and inline **notes**.

Step numbering restarts at each `phase` header; without phases, steps number continuously. Keep a
*simple* WI to about a page; a rich reference WI can run longer when the content earns it. Include
only the sections and appendices that apply.

### Sections and appendices in a Work Instruction (all optional)

- **Sections** (`sections`) - reference material after the steps (e.g., a Color Coding Standard,
  Seat & Account Management, a return process). Each is a heading plus a list of items using any body
  item kind.
- **Appendix A - Checklist** (`checklist`, optional `checklist_title`) - an **acceptance / sign-off
  gate**: the conditions that must be true to pass or hand off. It is the itemized version of *Done
  when*, **not** the steps restated as checkboxes. Include it only when there is a real sign-off.
- **Appendix B - Quick Reference** (`quick_reference`) - an at-a-glance summary, justified only on a
  long or multi-phase WI.

A checklist and quick-reference are a *different tier* (a filled checklist is a Form/Record), so they
render as appendices at the end of the document.

## Responsibilities (simple table)

List who does what in a two-column table, **Role | Responsibility**, with only the roles actually
involved in the procedure. AAC is a small shop: the plain table is the standard, not a RACI matrix.

## Writing standards (the voice)

- **Plain, declarative procedure language: state the action or the standard and stop.** Commentary
  is what this catches - lines like "the goal is not paperwork" or "a stale procedure is worse than
  none" are slogans, and an SOP carries neither them nor opinions.
- **One action per step, starting with a verb.**
- **Pick the format that fits the work:** checklist (default), step-by-step (strict order matters),
  hierarchical (only where steps genuinely nest), flowchart (branching / troubleshooting).
- **Write branches as `IF <condition> → THEN <action / which step>`.** One condition per line, each
  on a line of its own. (Use procedure items of kind `ifthen`.)
- **Mark required vs. recommended:** "must" for a required action, "may"/"should" for a
  recommendation, so a requirement reads as one.
- **Two separate success measures, kept apart:**
  - *Done when* (required): the completion criterion for a single run - how the person performing
    the task confirms this instance is complete and correct.
  - *Success Metrics* (optional): aggregate performance over time, each with a target, reviewed by
    the owner. A metric without a target does not show whether performance is acceptable. Include
    it only where tracking performance over time matters, such as a recurring process that affects
    revenue, quality, or customer experience.
- **Name components precisely** - model plus part number where it reduces error (panels, cameras,
  controllers).

## Evidence rule

Every fact the document states traces to the user, a document, or a system.

- If asked to look something up and the evidence is not present, state **"Insufficient evidence in
  provided documents"** rather than inferring.
- When you **derive** a field (e.g., a Trigger or Done-when summarized from the steps) or
  **summarize or reassign** roles, attach a red flag so the user verifies it - set `trigger_flag`,
  `done_when_flag`, `responsibilities_note`, or `metrics_note`, and/or a top-level `banner`.
- Leave genuinely unknown values as `"[ confirm ]"` - especially Effective Date and metric Targets.
- **Keep the two layers apart (see [Discovery](#discovery)).** A config/data fact resolved from a
  system is stated plainly, with no flag and no question back to the user. **A
  process/tribal-knowledge fact that no source confirmed stays a red flag for as long as it stays
  unconfirmed**, never a committed default - a confidently stated wrong process is worse than a
  flagged gap, because people follow it.

## Review cadence

Default Next Review to **6 months** for a Procedure or any high-risk document, and **12 months** for
an ordinary Work Instruction, measured from the Effective Date. Review immediately after a major
change: a change to a process, tool, legal or safety requirement, payroll, or anything
customer-facing.
