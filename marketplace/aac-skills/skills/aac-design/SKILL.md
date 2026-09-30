---
name: aac-design
description: Design and release gate for anything an AAC reader will look at, including forms, Word documents, letters, reports, slide decks, web pages and HTML artifacts. Use when creating or revising one, when asked whether something looks right or is hard to look at, and whenever the design gate blocks a turn.
metadata:
  modified: '2026-09-30T17:29:41Z'
  previous-modified: none
  revision: '1'
  content-sha: a6c7f15e3ff5
---

# AAC design

Every deliverable is judged by what it looks like rendered, and it ships only with a passing **critique stamp**. The design gate hook enforces this:

- **After every write** it lints the `.docx`, `.pptx` or `.html` file just written.
- **At every Stop** it refuses to end the turn while any deliverable changed this turn still has a design error, or has no stamp matching its current bytes.

Clearing the gate means finishing the steps below. See `scripts/designgate.py`.

Reference files, each loaded when its step needs it:

- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md): the approved AAC tokens, spacing scale, form components, document parts and web tokens (`assets/aac-tokens.css`).
- [TELLS.md](TELLS.md): the patterns to refuse, each tagged with the linter rule that catches it.
- [CRITIQUE.md](CRITIQUE.md): the scoring protocol.

Scripts run in the Linux sandbox. `designlint.py` and `designgate.py` use only the standard library, so the hook also runs them on the host.

## Branches

| Deliverable | Build with | Render with |
|---|---|---|
| **Form** (fields to fill in or sign) | `scripts/build_form.py` from a spec (DESIGN-SYSTEM.md) | `scripts/render.py --max-pages N` |
| **Document** (letter, memo, report, SOP, proposal) | the `docx` skill (or `aac-sop`, `aac-contract-package` when they own it), on the AAC template, with the tokens | `scripts/render.py` |
| **Deck** | the Slides artifact type, or the `pptx` skill when a .pptx file is asked for | `scripts/render.py` (works on .pptx) |
| **Web page or HTML artifact** | `artifact-design` first, `assets/aac-tokens.css` for every color, size and space, then the rules fetched from `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md` | a screenshot of the rendered page (`mcp__cowork__screenshot_file_preview` or the browser tool) |

## Steps

1. **Load the standards.** Load `aac-house-writing-standard` and read CORE, LAYOUT, CONTROL and DRAFT-QUALITY. It governs every word on the deliverable. Until `assets/AAC-WR-001-amendment-forms.md` is adopted, its form clauses are the approved exceptions to Rules 43, 77, 85, 98 and 99. Done when those four files are read this session.

2. **Inventory the content.** List every section, field and sentence with its source. Tag each one:
   - *keep*;
   - *cut*, because it duplicates another item (name which);
   - *park*, because it guards a failure nobody has had.

   Done when every item has a tag and a reason.

3. **Plan, then check the plan.** Write the build input: a spec for a form, an outline and token plan for the other branches. Sketch the page as an ASCII wireframe. Check the wireframe against every section of TELLS.md, including the branch's own section, and revise whatever matches. Done when the plan names its page budget and nothing in it matches a tell.

4. **Build, lint, render.** Build with the branch's tool, then run:
   ```bash
   python3 scripts/designlint.py FILE
   ```
   Fix every error; `--fix-fonts` clears D18 on a .docx. Render the file and open every page image. Done when the linter exits 0 and you have looked at every rendered page, under both stand-in fonts for .docx and .pptx.

5. **Critique with two isolated assessments.** Follow CRITIQUE.md exactly:
   - **A:** a sub-agent reviewing the rendered pages, the plan and CRITIQUE.md. It scores the heuristics, the audit and the cognitive-load checklist, and walks 2–3 personas through the page.
   - **B:** a separate sub-agent running `designlint.py --json`, the renderer, and the house-standard linter on a plain-text export.
   - A sees no detector output, and A's result is in before B's enters your context.
   - With no Agent tool, run A then B yourself and open the report with the degraded banner.

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
- **The brief wins.** When the user asks for a pattern TELLS.md lists, build it, and record it in the report as an accepted exception.
- **Cut before you squeeze.** Only reduce type sizes or spacing to meet the page budget after the duplicate and parked content is gone.
- **Gate override.** After three consecutive blocks in one turn the gate lets the turn end so a broken linter cannot wedge a session. When that happens, the reply names every file that shipped unstamped and why.
