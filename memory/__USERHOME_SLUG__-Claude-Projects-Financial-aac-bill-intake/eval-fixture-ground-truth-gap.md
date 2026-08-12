---
name: eval-fixture-ground-truth-gap
description: "RESOLVED 2026-07-17 — extraction-eval fixtures now carry human-verified ground truth from the real PDFs; evalExtraction match rate is trustworthy (100%)"
metadata: 
  node_type: memory
  type: project
  originSessionId: e269bf6a-6a48-416c-85ed-4072c39225e2
---

RESOLVED 2026-07-17. `gas/eval/fixtures.js` (git-ignored) had `total`/`invoiceDate`/some `vendorName` authored as placeholders, not captured from the real forwarded invoices — the old ~31% `evalExtraction` rate was stale fixture data, not an extraction defect.

Ground truth was established by reading the actual invoice PDFs by eye (pulled from Gmail `label:ap-invoices`) and the four `extraction` objects corrected to the printed values:
- Summit 4175121 → total **683.45**, date **2026-06-12**, vendor "Summit Fire & Security LLC" (new-ACH fraud box confirmed on the PDF, so the fraud flag is legit).
- FlyLock 091-1891255 → total **586.28**, date **2026-06-25**, printed vendor "FlyLock Security Solutions - West MI" (not "The Flying Locksmiths").
- IFP 1041-F208494 → total **7351.56**, date **2026-06-16**, printed vendor "International Fire Protection, Inc." (Pleasantburg/SC kept in vendorCity/State for branch resolution).
- Custom Lock & Safe → the query `"Custom Lock & Safe"` matched TWO real invoices; Dan chose the **Grayslake** one: total **515.00**, date **2026-06-22**, invoiceNumber **14600** (the preprinted slip #; these handwritten forms print no invoice-number field). `gmailQuery` pinned to `'"Custom Lock & Safe" Grayslake'` (verified to return exactly one thread) for deterministic scoring.

After correction: `node --test` decision-eval stays **8/8** (56/56 total) with NO `expected.*` or `ctx.aliasMap` gaming — the existing `matchOneName` franchise-fallback + `pickByAddress` city-disambiguation already resolve the true printed names. Live `clasp run evalExtraction` = **100%** (4/4 located). The only non-literal field match is Custom Lock vendorName ("Custom Lock & Safe, Inc." vs "Custom Lock & Safe"), equal under `vnorm` suffix-stripping — by design, not a loophole.

**Why:** ground truth was read from PDFs FIRST, independently, then written to the fixtures — so the 100% means the extractor is genuinely accurate on these 4, not a circular eval. Do NOT set `expected` = live extractor output.

**How to apply:** the extraction-eval is now trustworthy for these 4. Gate fixtures `gate-duplicate`/`gate-no-invnum` still reference the old CLS-88231/340 values on purpose (synthetic stop-gate logic, not real-invoice ground truth). git-ignored `fixtures.js` lives ONLY in the main checkout (not worktrees) and is pushed to GAS (not claspignored); run clasp only from main to avoid deleting git-ignored GlData/AliasData. See [[gas-verification-loop]] and [[gas-testing-architecture]].
