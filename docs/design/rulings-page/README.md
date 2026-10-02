# Rulings page design evidence (issue 1238)

The aac-design gate's record for `tools/rulings-page-template.html`.

- `drafts/`: synthetic drafts with no real tickets. `rulings-page-sample.html` is the page
  `node tools/rulings-page.js build --drafts docs/design/rulings-page/drafts --out ...` makes from
  them and the template.
- `critique.json`: the scored critique of that page's exact bytes. Assessment A and assessment B
  each ran as a separate `claude -p` session; their session ids are in `method`. A saw only the
  `web_audit.js` screenshots, the plan and CRITIQUE.md, never detector output. B ran
  `designlint.py --json` and `wr001-lint.js --formal` and judged the bundle's `findings.json` and
  `axe.json`.
- `critique/`: each sub-agent's raw return, per round.
- `score.md`: `score.py critique.json --markdown`. Gate: PASS.
- `.design/rulings-page-sample.html.json`: the critique stamp, bound to the sample's sha256.
  `python3 aac-skills/aac-design/scripts/score.py --check-stamp docs/design/rulings-page/rulings-page-sample.html`
  says whether it is still fresh.

Error check: `designlint.py` on the sample exits 0 with 0 errors (one H09 warning, a false positive:
the radio's label is built in a JS string). Before this change the template failed D03, D05 and D08.
`tools/rulings-page.test.js` keeps that check on every build.

The template now builds on the AAC web tokens (`assets/aac-tokens.css`): one accent hue, state
carried by words, weight and the native radio rather than status colours, no tracked caps, a 1px
quote rule.

Rounds:

1. A 30/40, audit 16/20, no P1. B: one real P3 (`8 AM` style times break AAC-WR-001 Rule 57).
   The fix batch wrote the times as a.m. and p.m., showed GitHub task lists as glyphs instead of
   checkboxes, and gave the disclosures back their markers.
2. Confirming A (run on Sonnet: the Opus session ran out of credit): 29/40 and one P1, the
   no-storage state shown only as a caption. Fixed with one bordered alert.
3. A 30/40, audit 16/20, no P0 or P1; B nothing real. Stamped. CRITIQUE.md leaves a third round
   to the owner; it was run here because round 2 raised a P1 the fix batch had not touched.
