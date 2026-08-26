---
name: gas-testing-architecture
description: How the GAS project is unit-tested and parse-checked despite Apps Script having no native test/typecheck
metadata: 
  node_type: memory
  type: project
  originSessionId: 775b530f-7299-4b6d-b767-b407e67616c7
  modified: 2026-08-26T14:07:45.829Z
---

The `gas/` Apps Script project has no native typechecker or test runner, and its platform
globals (GmailApp/SpreadsheetApp/UrlFetchApp/Claude) only exist in Google's cloud. Workaround:

- **Pure decision logic lives in `gas/core.js`** (vendor/GL/term matching, dedup, the seven
  intake behaviors) with NO Apps Script globals, ending in `if (typeof module !== 'undefined')
  module.exports = {...}` — a no-op in GAS, a require target in Node. `Code.gs` is the IO layer
  and calls these as GAS globals (all `.gs`/`.js` files share one global scope).
- **Unit tests:** Node's built-in `node --test` (no deps). Run the exact 8-file command in
  `.claude/session.json` — a bare `cd gas && node --test` or a `gas/*.test.js` glob misses five
  files (`gas/eval/decision-eval.test.js` plus the four `tools/*.test.js` files, including the
  `tools/claims.test.js` docs-claims tripwire from issue 326) and under-reports by ~67 tests.
- **"Typecheck" = parse check:** `node --check` rejects `.gs`, so copy to a temp `.js` first:
  `cp Code.gs /tmp/Code.js && node --check /tmp/Code.js`. `core.js` checks directly.
- **`.claspignore`** keeps `core.test.js`, `README.md`, dev files out of `clasp push`.
- **Extraction-eval fixtures require human ground truth from the source PDF — never `expected` = live extractor output.** `gas/eval/fixtures.js` (git-ignored) once carried placeholder `total`/`invoiceDate` values that masqueraded as ground truth; the 31% match rate was stale fixture data, not an extraction defect (resolved 2026-07-17 by reading four AP PDFs by eye). The file lives only in the main checkout and is pushed to GAS, so run clasp only from main to avoid deleting git-ignored fixtures/GlData/AliasData.

The GAS-IO paths (Gmail/Sheets/Claude calls) can't be unit-tested locally — they're covered by
the structural+behavioral audit and a BILL **sandbox** run. Split-coded stop-gate threshold is
`SPLIT_CODED_MIN_RATIO = 0.10` in core.js; GL seed carries a `SplitCodedRatio` column (re-run
`seedGl` after upgrading). See [[aac-bill-intake-status]] if present.
