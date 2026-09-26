# AAC SOP input schema

The input JSON `scripts/build_sop.js` reads, one schema per tier. Read the example for your tier
before building your first input file, and pattern-match its shape:

- `example_input.json` - a complete Procedure (the Service-to-Sales Lead Progression SOP), with the
  red-flag and N/A patterns.
- `example_wi_input.json` - a complete Work Instruction (System Surveyor site walk), with both
  appendices and the cross-role hand-off referenced rather than bundled.

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
