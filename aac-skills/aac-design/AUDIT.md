# Audit mode

Audit an existing page, document, deck, PDF or Google file against every catalog row that applies to its surface (`catalog/CATALOG.json`). Same run every time, whatever the surface: each adapter writes one evidence bundle in one shape (`scripts/evidence.py`), so the ledger and the scorer never special-case a surface. Each script's header carries its flags, outputs and exit codes; the steps below carry what the headers do not.

1. **Evidence.**
   - A page, by URL or HTML file: `node scripts/web_audit.js <url|page.html> --out evidence/`. A local harness is just its address; a gated page takes `--signin steps.json`; a URL takes `--commit <deployed commit>`, or the page's `<meta name="deployed-commit">`.
   - A `.docx`, `.pptx` or `.pdf`: `python3 scripts/doc_audit.py FILE --out evidence/ [--max-pages N] [--surface S]`, wherever LibreOffice and poppler are on PATH (the Linux sandbox; on Windows, LibreOffice ships both stand-in fonts).
   - A Google Doc, Slides deck or Sheet: its Drive link in place of FILE (`scripts/drive.py` exports it). The call rides the AAC service account (see `aac-google-access`), so share the file with that address first; Viewer is enough.

   Done when `bundle.json` exists and `python3 scripts/evidence.py validate evidence/` exits 0.
2. **Ledger.** One isolated sub-agent per catalogued skill. Give it its vendored copy under `vendor/` in full, its applicable catalog rows, and only the files in the bundle's `review_set`. It returns one row per applicable id: `verdict` PASS, FAIL or N/A, with `evidence` (a bundle file), `owner`, `file`, `fix` and `priority` P0 to P3 on a FAIL, and a `reason` on an N/A. Only after its rows are in does it see the `detector_set` (`findings.json`, `axe.json`) and mark each finding real or false positive; record both times in `reviewers[]`. With no Agent tool, do it yourself in that order and write a `DEGRADED` method. The ledger shape is in `scripts/score.py`; copy the bundle's `subject` into it. Done when every applicable id has a row and every detector finding is marked.
3. **Score, stamp, report.**
   ```bash
   python3 scripts/score.py ledger.json --markdown --report findings.html --stamp <file|url|Drive link>
   ```
   The gate needs full coverage, no open P0 or P1 owned by the ledger's `auditor`, and a dual-agent method; `score.py --check-stamp <target> [--commit SHA]` says whether a stamp is still fresh. A catalogued conflict is settled by precedence (see *Rules the steps depend on* in `SKILL.md`). To overrule a decision, change the ledger row and say so in the report. Publish `findings.html` as the findings page; its first line is the method line. Done when score.py exits 0, or the report names what blocks.
4. **Hand off, then draft tickets.**
   ```bash
   python3 scripts/score.py ledger.json --handoff handoff/ --tickets tickets.json --markdown
   ```
   This writes one list per owner (`handoff/<owner>.md`) and drafts one ticket per open accessibility FAIL; it files nothing. A rule whose catalog row names no WCAG criterion takes the row's `"wcag": "n.n.n"`. Show the user every draft and ask which repository they go to; file only into the repository the user names:
   ```bash
   python3 scripts/score.py --file-tickets tickets.json --repo OWNER/NAME
   ```
   A rerun files nothing twice. Done when each owner has its list and the drafts are shown, or filed into the repository the user named.
