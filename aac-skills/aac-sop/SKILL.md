---
name: aac-sop
description: >
  Create or rewrite an Active Alarm Company (AAC) procedure or work instruction in AAC's house
  format and writing standards, delivered as a styled Word (.docx). Two tiers: a full Procedure
  (cross-role process) and a lean Work Instruction (one person, one task, usually one tool). Use
  whenever the user asks to write, draft, standardize, or recast an SOP, "standard operating
  procedure," "work instruction," or "WI" - or to put an existing process, checklist, or rough
  document "into our SOP format." Also use when documenting any repeatable AAC process or task
  (service calls, monitoring termination, billing, payroll, the Service-to-Sales handoff,
  estimating, month-end close, or a tool how-to such as System Surveyor or Zoho). Trigger even
  without the words "template," "SOP," or "work instruction" - "write up how we handle X,"
  "document the X process," or "turn this into a procedure/checklist" all apply.
  Prefer this over generic process-doc/runbook output for any AAC procedure or work instruction.
metadata:
  modified: "2026-08-31T21:20:12Z"
  previous-modified: "none"
  revision: "1"
  content-sha: "a968307daf96"
---

# AAC SOP Builder

Produces a single document - a **Procedure** or a **Work Instruction** - as a Word file in AAC's
house format. A bundled generator renders it so every document comes out identical in structure and
styling; your job is the content, the tier choice, and the judgment; the generator handles the layout.

## Step 0 - Choose the tier

AAC documents come in two tiers. Decide which before writing; it sets the
template and the `mode`.

- **Procedure** (full template, `mode: "procedure"`) - the higher-level process: who does what,
  when, where, with hand-offs between roles and business decisions. Example: Service → Sales lead
  progression.
- **Work Instruction** (lean template, `mode: "work_instruction"`) - tells **one person how to
  perform one task**, step by step, usually with a specific tool. It covers only **how**. It does
  not span roles, route work between people, or decide *what / whether / when*. Example: how an AE
  runs a site walk in System Surveyor.

**Litmus:** one role + one task + "how" → Work Instruction. Multiple roles + a hand-off +
"who / when / what-if" → Procedure. If a task-level instruction contains a cross-role hand-off, keep
the instruction as a Work Instruction and reference the hand-off as a separate Procedure rather than
bundling a procedure inside it.

Most of what a field shop documents day to day is Work Instructions, so that is the common case: a
single-task tool how-to stays one however important it feels. Reaching for the Procedure template
there is the main over-documentation risk.

## Step 1 - Discovery (before you write)

An SOP is only as good as the process behind it. Before writing anything, separate what you can
verify from a system from what lives in someone's head, resolve the first yourself, and confirm the
second from a source.

**Split the content into two layers.**

- *Config / data layer* - facts that live in a system: field names and picklist values, org and
  account IDs, record owners, statuses in use, cycle times, counts. Resolve these directly from the
  connectors and data. A fact the tools resolve is stated plainly, with no flag and no question
  back to the user; going as far as the tools allow is the standard here.
- *Process / tribal-knowledge layer* - how the work actually runs: the real sequence, what triggers
  each step, who does it and when, the required-vs-recommended calls, the sign-off gate, and the
  exceptions ("usually X, but sometimes Y"). This lives in practice, not in a system. Verify it from
  a source before stating it. If it stays unverified, it stays a red flag - never a committed default.

**Gather from sources in this order; asking a person is the last resort, and a red flag is what an
unanswered item becomes.**

1. This conversation, an attached document, or an existing SOP you are recasting (read it first;
   preserve its content).
2. Connectors, for the config/data layer (e.g., Zoho for module fields, picklists, owners, statuses).
3. Process evidence, for the tribal-knowledge layer: Fathom transcripts, email threads, and past
   chats where the team described how the work is actually done.
4. Only what none of the above resolves: put the open items to the user in a single batch (see
   below), or leave them as red flags.

**What to establish before writing** (from the sources above; only ask for what is still missing):

- The trigger - what starts this process or task.
- The boundaries - where it starts and where it ends, and what is out of scope or a separate SOP.
- The performer(s) and, for a Procedure, the hand-offs - who does what, by real name and role.
- Each step's how, and for a Procedure its when and its output - captured into `steps`/`procedure`,
  `responsibilities`, and `done_when`, not into any new field.
- The exceptions - the "usually X, but sometimes Y" cases. These are the highest-value content;
  route them to `ifthen`, `watch_out`, or a Procedure `exceptions` row. In a Procedure, run each
  through the brainstorm - curate - draft loop before committing the wording.
- The completion criterion (`done_when`) and, only if performance over time matters, the metrics
  with targets.

**If you must ask, ask once.** Batch the unresolved items into one short, numbered list. Tell the
user they can answer in shorthand, point you to a transcript or thread, or say "flag it" to leave it
as a red item. Exhaust the sources first, then make one consolidated pass.

**Scale discovery to where the content lives.** A single-tool Work Instruction whose facts are all
in-system or already in the conversation needs little or no elicitation - resolve and build. A
multi-role process with judgment and exceptions gets the full pass. Match the effort to how much of
the content lives in people's heads versus systems.

## Workflow

1. **Complete Discovery (Step 1 above).** You now have the verified content and, for anything on the
   process layer that no source could confirm, the list of items still marked as red flags. If you
   are recasting an existing SOP, you have read it and will **preserve its content** - only
   restructure, reformat, and clean wording.
2. **Apply the writing standards** (below) to every line.
3. **Apply the evidence rule** (below).
4. **For a Procedure, run the brainstorm - curate - draft loop** on every judgment section (Trigger,
   Done when, Exceptions rows, Responsibilities rows, and each `ifthen` branch). See
   [Brainstorm - curate - draft](#brainstorm---curate---draft-procedure-judgment-sections) below.
   Work Instructions skip this step - their content is procedural and the brainstorm cost outweighs
   the payoff.
5. **Write the content into an input JSON file** matching the schema for the tier you chose, and set
   `mode` accordingly. Pattern-match the shape of `references/example_input.json` (a Procedure) or
   `references/example_wi_input.json` (a Work Instruction).
6. **Generate the document.** Ensure the `docx` package is installed, then run the generator:
   ```bash
   npm install docx        # if not already present in the environment
   node scripts/build_sop.js <input.json> <output.docx>
   ```
   Validate the file structure with the docx skill's `validate.py` if it is available; otherwise
   the generator's output is already schema-valid.
7. **Reader-test the `.docx`** as a cold performer. See [Reader Testing](#reader-testing) below. Fix
   every gap in the JSON, regenerate, re-read. Deliver only after a clean pass.
8. **Deliver.** Present the `.docx` and end with a short note listing every field still flagged in
   red (derived, assumed, or unverified), so the user verifies it. The list is as long as the
   evidence leaves it.

## Brainstorm - curate - draft (Procedure judgment sections)

Judgment sections carry the highest read-cost per line: the reader has to make a decision from them
and get it right. A single glib wording misdirects. Run these through a three-pass internal loop
before committing to the JSON.

**Applies to a Procedure only, and only to these sections:** Trigger; Done when; each Exceptions
row; each Responsibilities row; every `ifthen` branch in `procedure[]`. Ordinary `step` and `bullet`
items skip the loop. A Work Instruction skips it entirely.

**The loop:**

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

Reader Testing is its own stage. A `.docx` that generates cleanly can
still be unreadable to the person it was written for. The purpose is to catch what the author cannot
see: assumptions, missing preconditions, undefined terms, and unstated decisions that a cold reader
hits and stalls on.

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

Any "no" is a defect, not a nit. Fix it in the JSON, regenerate, re-read. Deliver only after a clean
pass.

For a Work Instruction, apply the same checkpoints to Steps and Watch out for; read Sections and
Appendices for reference value (does someone consulting this later find what they need). The stage
runs at both tiers - a wrong SOP shipped costs more than the test does.

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
color-coding standard), and inline **notes**. Use the body item kinds listed under the schema.

Step numbering restarts at each `phase` header; without phases, steps number continuously. Keep a
*simple* WI to about a page; a rich reference WI can run longer when the content earns it - drop
sections and appendices that don't apply rather than padding them.

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

List who does what in a two-column table: **Role | Responsibility**. Include only the roles actually
involved in the procedure. AAC is a small shop - a full RACI matrix is more structure than these
procedures need, so keep this plain.

## Writing standards (the voice)

These standards are what make it an AAC SOP. Hold the line on them:

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
    the owner. A metric without a target does not show whether performance is acceptable. Include it only where tracking performance over time matters, such as a recurring process that affects revenue, quality, or customer experience; otherwise omit it.
- **Name components precisely** - model plus part number where it reduces error (panels, cameras,
  controllers).

## Evidence rule

Every fact the document states traces to the user, a document, or a system.

- If asked to look something up and the evidence is not present, state **"Insufficient evidence in
  provided documents"** rather than inferring.
- When you **derive** a field (e.g., a Trigger or Done-when summarized from the steps) or
  **summarize or reassign** roles, attach a red flag so the user verifies it - set `trigger_flag`,
  `done_when_flag`, `responsibilities_note`, or `metrics_note`, and/or a top-level `banner`.
- Leave genuinely unknown values as `"[ confirm ]"` rather than guessing - especially Effective
  Date and metric Targets.
- **Separate the two layers (see Step 1 - Discovery).** A config/data fact resolved from a system is
  stated plainly. **A process/tribal-knowledge fact that no source confirmed stays a red flag for as
  long as it stays unconfirmed** - a confidently stated wrong process is worse than a flagged gap,
  because people follow it.

## Review cadence

Default Next Review to **6 months** for a Procedure or any high-risk document, and **12 months** for an ordinary Work Instruction, measured from the Effective Date. Review immediately after a major change: a change to a process, tool, legal or safety requirement, payroll, or anything customer-facing.

## Procedure - input JSON schema

```jsonc
{
  // Header (all strings)
  "title": "", "department": "", "version": "1.0",
  "effective_date": "", "next_review": "", "prepared_by": "", "approved_by": "",

  "banner": null,                 // optional red note under the header (e.g. recast / verify)

  "objective": "",                // one sentence, outcome-oriented
  "scope": "",                    // what's included/excluded; sites, customers, system types

  "responsibilities": [           // one row per role
    { "role": "", "responsibility": "" }
  ],
  "responsibilities_note": null,  // optional red note (e.g. when mapping/recasting)

  "trigger": "", "trigger_flag": null,    // flag = optional red "(derived - confirm)" marker

  "procedure": [                  // ordered; mix the kinds below
    { "kind": "phase",  "text": "Step 1 - ..." },     // bold sub-header
    { "kind": "step",   "text": "..." },              // numbered (use for a flat numbered list)
    { "kind": "bullet", "text": "..." },              // bullet (use under phase headers)
    { "kind": "ifthen", "if": "...", "then": "..." }  // a decision branch
  ],

  "done_when": "", "done_when_flag": null,

  "exceptions": [ { "situation": "", "action": "" } ],          // optional; [] = omit section
  "troubleshooting": [ { "symptom": "", "cause": "", "fix": "" } ], // optional; [] = omit
  "troubleshooting_na": null,     // optional: string reason -> renders "Troubleshooting - N/A (reason)"
  "metrics": [ { "metric": "", "target": "", "method": "" } ],  // optional; [] = omit section
  "metrics_note": null,           // optional red note (e.g. set targets)
  "references": [ "" ],           // optional; [] = omit section

  "revision_log": [ { "date": "", "ver": "1.0", "by": "", "change": "Created" } ]
}
```

## Work Instruction - input JSON schema

```jsonc
{
  "mode": "work_instruction",
  "title": "", "department": "", "version": "1.0",
  "owner": "", "last_updated": "", "approved_by": null,   // approved_by optional for a WI

  "intro": null,                  // optional grey context line under the header
  "banner": null,                 // optional red verify/recast note

  "responsibilities": [ { "role": "", "responsibility": "" } ],   // optional Roles table (after the intro)

  "tools": [ "" ],                // "Before you start" - tools/access/prereqs (string or array)

  "steps": [ /* body items - see "Body item kinds" below */
    { "kind": "phase",  "text": "Phase 1 - ..." },     // bold header; step numbering restarts here
    { "kind": "step",   "text": "..." },               // numbered (restarts each phase)
    { "kind": "ifthen", "if": "...", "then": "..." },  // decision branch (bullet)
    { "kind": "table",  "title": "...", "headers": ["",""], "rows": [["",""]], "widths": [4680,4680] },
    { "kind": "block",  "title": "...", "lines": ["line 1","line 2"] },   // monospace template box
    { "kind": "note",   "text": "..." }                // grey italic caution / clarification
  ],

  "done_when": "", "done_when_flag": null,
  "watch_out": [ "" ],            // optional - common mistakes / cautions

  "sections": [                   // optional reference sections, rendered after the steps
    { "heading": "Color Coding Standard", "items": [
      { "kind": "text", "text": "..." },
      { "kind": "swatch_table", "title": "...", "headers": ["Swatch","col","col"],
        "rows": [ { "label": "ORANGE", "hex": "C55A11", "cells": ["",""] },
                  { "label": "CATEGORY", "hex": null, "cells": ["",""] } ] },  // null hex = plain label
      { "kind": "kv", "label": "Q1 - ...", "text": "..." }
    ] }
  ],

  // Optional appendices (omit when empty)
  "checklist": [ "" ],            // Appendix A - acceptance/sign-off items (NOT the steps restated)
  "checklist_title": null,        // optional, e.g. "Pre-Handoff Quality Gate"
  "quick_reference": [            // Appendix B - objects render a 2-col table; strings render bullets
    { "step": "", "detail": "" }
  ],

  "revision_log": [ { "date": "", "ver": "1.0", "by": "", "change": "Created" } ]
}
```

**Body item kinds** (usable in WI `steps` and in any `sections[].items`): `phase` (bold header;
restarts step numbering), `step` (numbered), `bullet` (optionally with a bold `label`), `ifthen`
(decision branch), `note` (grey italic), `flag` (red italic - for unconfirmed / decision items), `text` (plain paragraph), `kv` (bold `label` + `text`),
`subhead` (bold sub-header), `table` (`headers` / `rows` / optional `widths`), `block` (monospace
`lines`, for templates such as a handoff email), and `swatch_table` (color-coded rows, each
`{ label, hex, cells }`; a null `hex` renders a plain label cell). Decision branches are always
`ifthen`. In the Procedure `procedure` array use the basic kinds (`phase` / `step` / `ifthen` /
`bullet`); the richer kinds are for Work Instructions.

## Generator behavior

`scripts/build_sop.js` reads the JSON and writes a US-Letter, Arial, navy-headed `.docx`. It renders
the Procedure layout by default and the Work Instruction layout when `mode` is `"work_instruction"`.
It omits any optional section or appendix whose array is empty; renders Troubleshooting as an
"N/A (reason)" line when `troubleshooting_na` is set and `troubleshooting` is empty; renders
`banner`, `*_flag`, `responsibilities_note`, and `metrics_note` in red; and defaults the Revision Log
to a single "Created" row when none is supplied. It requires only the `docx` npm package.

## Reference examples

- `references/example_input.json` - a complete Procedure (the Service-to-Sales Lead Progression SOP),
  with the red-flag and N/A patterns.
- `references/example_wi_input.json` - a complete Work Instruction (System Surveyor site walk), with
  both appendices and the cross-role hand-off referenced rather than bundled.

Read the one matching your tier before building your first input file.
