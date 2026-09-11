---
name: gas-cli-run-quirks
description: "Where the gas CLI lives on Dan's PC, what `gas run` truncates, which subcommands need a local login, and which functions refuse to run"
metadata: 
  node_type: memory
  type: project
  originSessionId: 84c74f31-7707-4588-bd53-d08a972edaf8
  modified: 2026-09-10T17:32:44.285Z
---

Measured 2026-09-10 in aac-bill-intake (build a6e7764).

- CLI path on Dan's PC: `__USERHOME__\Claude\Projects\Meta\claude-dotfiles\gas\cli\gas.js` (layout 6 in
  `tools/prepush-layout-preflight.js`). Not on PATH; call `node <path> run surreptakos/aac-bill-intake <fn> '[args]' --wait 10`.
- `gas run` needs only `gh` auth (it pushes `deploy/run` and reads a commit status). Each run polls ~2-3 minutes.
  Its `--wait` summary line truncates the result at ~100 chars with `…`; the FULL result is the fenced block in
  the commit comment on the `deploy/run` sha: `gh api repos/<o>/<r>/commits/<sha>/comments --jq '.[].body'`.
- Runs are serialised on one ref: never launch two `gas run` in parallel (force-push collision).
- `gas logs`, `gas deployments`, `gas versions`, `gas whoami` need a LOCAL credential at
  `~/.config/gas/credentials.json`. `gas import-clasprc` from `~/.clasprc.json` failed `invalid_grant`
  (token dead, 2026-09-04 file). Minting one is `gas login` = browser OAuth = owner action.
- `gasStatus` (SelfDeploy.js) is refused by `gas run`: "is not runnable: it ends in an underscore or is outside
  gas.json `runnable`". Library functions are not runnable even without an underscore.
- `billGetById` reports a phantom `isPaid`; payment truth is `probeBillPaymentFields` (`paymentStatus`,
  `dueAmount`). Issue 604 tracks the fix.
- Promotion of the /exec webhook deployment: `gh workflow run promote.yml --ref main` works from any checkout
  (owner's gh token has `workflow` scope); result lands as the `deploy/prod` row in `gas status`.

**Why:** three of these cost real minutes this session, and one produced a false "bill unpaid" claim to the owner.

**How to apply:** read the commit comment, not the summary line; run diagnostics sequentially; do not chase
`gas logs` without a login. See [[deploys-itself-no-clasp]] and [[stubbed-dup-gate-diagnostic-trap]].
