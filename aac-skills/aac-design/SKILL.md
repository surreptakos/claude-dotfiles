---
name: aac-design
description: Design and release gate for anything an AAC reader will look at, including forms, Word documents, letters, reports, slide decks, web pages and HTML artifacts. Use when creating or revising one, when asked whether something looks right or is hard to look at, and whenever the design gate blocks a turn.
metadata:
  modified: "2026-10-01T02:51:28Z"
  previous-modified: "2026-10-01T01:45:12Z"
  revision: "8"
  content-sha: "fe686ad767ab"
---

# AAC design

Every deliverable is judged by what it looks like rendered, and it ships only with a passing **critique stamp**.

**The gate acts only inside an opted-in folder.** The plugin wires `hooks/hooks.fragment.json`, but the hook ignores every file outside a folder that holds the marker file `.aac-design` (empty; its content is not read). The marker covers the folder it sits in and every folder below it. To opt a deliverables folder in, create the file there: `touch .aac-design`, or `New-Item .aac-design` in PowerShell. Code repositories stay unmarked, so their `.html` sources never meet the gate. For a deliverable outside a marked folder, run the linter, the critique and the scorer yourself, and say in the reply which files shipped without a stamp. Inside a marked folder:

- **After every write** it lints the `.docx`, `.pptx` or `.html` file just written.
- **At every Stop** it refuses to end the turn while any deliverable changed this turn still has a design error, or has no stamp matching its current bytes.

Clearing the gate means finishing the steps below. See `scripts/designgate.py`.

Reference files, each loaded when its step needs it:

- [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md): the approved AAC tokens, spacing scale, form components, document parts and web tokens (`assets/aac-tokens.css`).
- [TELLS.md](TELLS.md): every catalog rule grouped by surface, tagged with the linter rule that catches it, with the precedence order and the catalogued conflicts. Generated from `catalog/CATALOG.json` by `node tools/build-design-catalog.js`; never edit it by hand.
- `catalog/CATALOG.json`: one row per rule, citing its source file and line. The sources are AAC-WR-001 Rules 75 to 102 and the tokens (cited, never restated), and six design skills vendored as rule text under `vendor/` (pins in `vendor/PROVENANCE.json`). `scripts/fetch_engine.py` fetches a source's engine or data, such as impeccable's detector, and hash-checks it against the pin.
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

1. **Load the standards.** Load `aac-house-writing-standard` and read CORE, LAYOUT, CONTROL and DRAFT-QUALITY. It governs every word on the deliverable. AAC-WR-001 v0.11 carries the fill-in form clauses in Rules 43, 77, 85, 98 and 99; `assets/AAC-WR-001-amendment-forms.md` is the record of that amendment. Done when those four files are read this session.

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

## Audit mode

Audit an existing page, document, deck or PDF against every catalog row that applies to its surface (`catalog/CATALOG.json`). Same run every time, whatever the surface: each adapter writes one evidence bundle in one shape (`scripts/evidence.py`), so the ledger and the scorer never special-case a surface.

1. **Evidence.** For a page, by URL or HTML file: `node scripts/web_audit.js <url|page.html> --out evidence/` writes one bundle: screenshots at 1440, 768 and 390 px, 200% zoom, reduced motion, forced colours and offline; the DOM with computed styles; the accessibility tree; a scripted keyboard walk; axe-core; the plain text. It uses the local Chromium, Chrome or Edge (`CHROME_PATH` to pick one) and downloads no browser; axe-core is fetched at a pinned version and refused unless its sha256 matches. A local harness is just its address. A gated page takes `--signin steps.json` (goto, fill, click, waitFor; secrets as `{"env": "NAME"}`). A URL takes `--commit <deployed commit>`, or the page's `<meta name="deployed-commit">`. For a `.docx`, `.pptx` or `.pdf`: `python3 scripts/doc_audit.py FILE --out evidence/ [--max-pages N] [--surface S]`, wherever LibreOffice and poppler are on PATH (the Linux sandbox; on Windows, LibreOffice ships both stand-in fonts). An Office file goes through the build mode's renderer and linter: page images under both stand-in fonts, with both page counts and the fonts each rendering embedded recorded, the document XML as its structure, and `designlint.py` as its detector. A PDF is judged as printed: its page images, its text layer as its structure, and the linter's text rules run on that layer. Its surface is `document` unless `--surface` names `deck` or `form`. Done when `bundle.json` exists and `python3 scripts/evidence.py validate evidence/` exits 0.
2. **Ledger.** One isolated sub-agent per catalogued skill. Give it its vendored copy under `vendor/` in full, its applicable catalog rows, and only the files in the bundle's `review_set`. It returns one row per applicable id: `verdict` PASS, FAIL or N/A, with `evidence` (a bundle file), `owner`, `file`, `fix` and `priority` P0 to P3 on a FAIL, and a `reason` on an N/A. Only after its rows are in does it see the `detector_set` (`findings.json`, `axe.json`) and mark each finding real or false positive; record both times in `reviewers[]`. With no Agent tool, do it yourself in that order and write a `DEGRADED` method. The ledger shape is in `scripts/score.py`.
3. **Score, stamp, report.**
   ```bash
   python3 scripts/score.py ledger.json --markdown --report findings.html --stamp <file|url>
   ```
   It rejects (exit 3) a ledger missing an applicable id, an N/A without a reason, or detector output shown before the rows were in. The gate needs full coverage, no open P0 or P1 owned by the ledger's `auditor`, and a dual-agent method. A file is stamped by its sha256, a URL by its address plus deployed commit; `score.py --check-stamp <target> [--commit SHA]` says whether the stamp is still fresh. Publish `findings.html` as the findings page; its first line is the method line. Done when score.py exits 0, or the report names what blocks.

## Rules the steps depend on

- **The stamp is bound to the bytes.** Any edit after stamping, even a typo fix, makes the gate block until steps 4–6 run again. Batch edits before critiquing.
- **Precedence decides a conflict.** AAC tokens and AAC-WR-001 first, then the design skills, then the brief (the catalog's `precedence` field; Dan, 2026-09-30). When two rules conflict, report the rule that won and why: a catalogued conflict carries both in TELLS.md. When the user asks for a pattern a rule refuses, name the rule, and record any exception they confirm in the report.
- **Cut before you squeeze.** Only reduce type sizes or spacing to meet the page budget after the duplicate and parked content is gone.
- **Gate override.** After three consecutive blocks in one turn the gate lets the turn end so a broken linter cannot wedge a session. When that happens, the reply names every file that shipped unstamped and why.
