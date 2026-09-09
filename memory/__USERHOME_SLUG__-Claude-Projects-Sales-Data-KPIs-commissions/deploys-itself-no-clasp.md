# Deploys itself — no clasp (since 2026-09-09)

`aac-sales-commissions` carries `gas.json` and a vendored `src|gas/SelfDeploy.js` (claude-dotfiles `gas/`, team skill
`gas-deploy`). A merge to `master` IS the release: `deploy.yml` runs the suite and moves the `deploy/test`
ref; the script's five-minute `gasDeployTick` (installed from `runAllSilent`) writes HEAD and the next tick
verifies it, marking the commit `gas/deploy` green or red and mailing the owner on red.

- `clasp push` → merge. `clasp run-function X` → `node <claude-dotfiles>/gas/cli/gas.js run surreptakos/aac-sales-commissions X '[args]' --wait 10`.
  `clasp pull` → `gas pull <scriptId>`. `clasp logs` → `gas logs --project gpt-sheets-access-475817`.
- No Google credential exists in CI or on a runner; the script holds a published-client refresh token
  (no seven-day death) and a GitHub token, seeded once through Drive. The clasp-auth gate is gone from
  `.claude/session.json`; `tools/clasp-auth.js` is kept only for a hand `clasp pull`.
- v7 is a snapshot and v4 the headless-dispatch web app, both superseded by `gas run`.
- Older notes here that say `clasp push`, `clasp run-function` or "re-auth via clasp-auth.js" describe
  the retired path; this note wins.
