# Deploys itself — no clasp (ADR-0033, since 2026-09-08)

`aac-sales-cockpit` deploys itself under its own ADR-0033 model (an endpoint deployment pulls each merge
to `main` into HEAD; HEAD schedules its own post-deploy check; `promoteProdThursday` and the Sunday
`strandGuard` promote PROD). `CLASPRC_JSON` is retired (#586); no Google credential is in GitHub. Headless
runs: `tools/self-deploy-call.js` against the endpoint, or the ops `/exec` POST. The other AAC scripts use
the generalized package in claude-dotfiles `gas/` (pull mode); the cockpit can move to it when convenient.
Older notes here that say `clasp push` / `clasp run` describe the retired path.
