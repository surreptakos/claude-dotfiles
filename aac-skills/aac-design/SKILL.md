---
name: aac-design
description: AAC design gate for anything an AAC reader will look at (form, Word document, letter, report, slide deck, web page, HTML artifact). Use when creating, revising or auditing one, when asked whether something looks right or is hard to look at, and whenever the design gate blocks a turn.
metadata:
  modified: "2026-10-02T15:38:04Z"
  previous-modified: "2026-10-01T19:46:53Z"
  revision: "13"
  content-sha: "4c4cb7bc77a9"
---

# AAC design

Every deliverable is judged by what it looks like rendered, and it ships only with a passing **critique stamp**. To build or revise one, follow the Steps. To audit an existing page, document, deck, PDF or Google file, follow [AUDIT.md](AUDIT.md).

## The gate

**The gate acts only inside an opted-in folder**: one that holds the marker file `.aac-design` (empty; its content is not read), which covers the folder it sits in and every folder below it. The plugin wires `hooks/hooks.fragment.json`; the hook ignores every file elsewhere. To opt a deliverables folder in, create the file there: `touch .aac-design`, or `New-Item .aac-design` in PowerShell. Code repositories stay unmarked, so their `.html` sources never meet the gate. Inside a marked folder (`scripts/designgate.py`):

- **After every write** it lints the `.docx`, `.pptx` or `.html` file just written.
- **At every Stop** it refuses to end the turn while any deliverable changed this turn still has a design error, or has no stamp matching its current bytes. Clearing it means finishing the Steps.
- **Override:** after three consecutive blocks in one turn it lets the turn end, so a broken linter cannot wedge a session.

For a deliverable outside a marked folder, run the linter, the critique and the scorer yourself. Whenever a file ships unstamped, outside a marked folder or past the override, the reply names every such file and why.

Scripts run in the Linux sandbox. `designlint.py` and `designgate.py` use only the standard library, so the hook also runs them on the host.

Reference files, each loaded when its step needs it:

- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md): the approved AAC tokens, spacing scale, form components, document parts and web tokens (`assets/aac-tokens.css`).
- [TELLS.md](TELLS.md): every catalog rule grouped by surface, tagged with the linter rule that catches it, with the precedence order and the catalogued conflicts. Generated from `catalog/CATALOG.json` by `node tools/build-design-catalog.js`, never by hand.
- `catalog/CATALOG.json`: one row per rule, citing its source file and line. The sources are AAC-WR-001 Rules 75 to 102 and the tokens (cited, never restated), and six design skills vendored as rule text under `vendor/` (pins in `vendor/PROVENANCE.json`).
  - For audits the vendored `accessibility-review` pin supersedes the undated session copy at `aac-skills/accessibility-review`.
  - `scripts/fetch_engine.py` fetches a source's engine or data, such as impeccable's detector, and hash-checks it against the pin.
- [CRITIQUE.md](CRITIQUE.md): the scoring protocol.

## Branches

| Deliverable | Build with | Render with |
|---|---|---|
| **Form** (fields to fill in or sign) | `scripts/build_form.py` from a spec (DESIGN-SYSTEM.md) | `scripts/render.py --max-pages N` |
| **Document** (letter, memo, report, SOP, proposal) | the `docx` skill (or `aac-sop`, `aac-contract-package` when they own it), on the AAC template, with the tokens | `scripts/render.py` |
| **Deck** | the Slides artifact type, or the `pptx` skill when a .pptx file is asked for | `scripts/render.py` (works on .pptx) |
| **Web page or HTML artifact** | `artifact-design` first, `assets/aac-tokens.css` for every color, size and space, then the rules fetched from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` | a screenshot of the rendered page (`mcp__cowork__screenshot_file_preview` or the browser tool) |

## Steps

1. **Load the standards.** Load `aac-house-writing-standard` and read CORE, LAYOUT, CONTROL and DRAFT-QUALITY; it governs every word on the deliverable. Its fill-in form clauses are Rules 43, 77, 85, 98 and 99 (added in v0.11; `assets/AAC-WR-001-amendment-forms.md` is the record of that amendment). Done when those four files are read this session.

2. **Inventory the content.** List every section, field and sentence with its source. Tag each one:
   - *keep*;
   - *cut*, because it duplicates another item (name which);
   - *park*, because it guards a failure nobody has had.

   Done when every item has a tag and a reason.

3. **Plan, then check the plan.** Write the build input: a spec for a form, an outline and token plan for the other branches. Sketch the page as an ASCII wireframe. Check the wireframe against the TELLS.md section for the deliverable's surface, and revise whatever breaks a rule there. Done when the plan names its page budget and breaks no rule in that section.

4. **Build, lint, render.** Build with the branch's tool, then run:
   ```bash
   python3 scripts/designlint.py FILE
   ```
   Fix every error; `--fix-fonts` clears D18 on a .docx. Render the file and open every page image. Done when the linter exits 0 and you have looked at every rendered page, under both stand-in fonts for .docx and .pptx.

5. **Critique with two isolated assessments**, following CRITIQUE.md exactly:
   - **A:** a sub-agent given the rendered pages, the plan and CRITIQUE.md, returning everything its Assessment A lists.
   - **B:** a separate sub-agent running its Assessment B commands.
   - A sees no detector output, and A's result is in before B's enters your context. With no Agent tool, run A then B yourself and open the report with the degraded banner.

   Done when both returns are in hand and every B finding is marked real or false positive, with a reason.

6. **Score, stamp, report.** Write `critique.json` and run:
   ```bash
   python3 scripts/score.py critique.json --markdown --stamp FILE
   ```
   Report in the order CRITIQUE.md gives, ending on the targeted questions or the `Questions skipped` line. Done when score.py exits 0 and has written `.design/<file>.json`. If it exits 1, go to step 7. If it exits 3, the critique file is invalid: fix it and rerun.

7. **Fix once, confirm once.** Fix every priority issue and linter error in one batch, rebuild, and repeat steps 4–6 once. A third round is the user's call. Deliver when the stamp exists:
   - Confirm AAC-WR-001 Rule 166 item by item.
   - Name the file per Rule 145 and bump its revision.
   - Present it with its rendered page.

## Rules the steps depend on

- **The stamp is bound to the bytes.** Any edit after stamping, even a typo fix, makes the gate block until steps 4–6 run again. Batch edits before critiquing.
- **Precedence decides a conflict.** AAC tokens and AAC-WR-001 first, then the design skills, then the brief (the catalog's `precedence` field; Dan, 2026-09-30). When two rules conflict, report the rule that won and why: a catalogued conflict carries both in TELLS.md, and an audit's report names it. When the user asks for a pattern a rule refuses, name the rule, and record any exception they confirm in the report.
- **Cut before you squeeze.** Reduce type sizes or spacing to meet the page budget only after the duplicate and parked content is gone.
