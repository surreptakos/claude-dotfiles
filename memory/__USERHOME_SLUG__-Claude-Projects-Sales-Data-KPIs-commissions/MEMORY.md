# Memory Index

- [Stub-sweep incident + fix](stub-sweep-incident.md) — marking a stub paid swept already-paid rows to a future stub; numeric Date Paid broke the `instanceof Date` lock; fixed as clasp version 1
- [Sheet REST API access](sheet-rest-api-access.md) — clasp token LACKS Drive/Sheets scope → REST 403; run fns via clasp run-function (public only) or the headless doPost web app (private/new fns, deploy+POST via PowerShell); DriveApp auth = declared-vs-granted gap
- [Pay stub model](pay-stub-model.md) — Pay Stub Key = pay month = earn month + 1; pays 2nd Friday
- [Paid Stub Ledger](paid-stub-ledger.md) — immutable snapshot of paid stubs; sticky corrections + NET≥0 floor; freeze on mark (auto) + manual for historical (repair first)
- [Running Balance build](running-balance-build.md) — issues 01-06 SHIPPED to production + reconciled clean (42 frozen stubs, 0 mismatches); merged into master 2026-07-21, feature branch deleted (single-branch repo now)
- [Verify exit codes, not pipes](verify-exit-codes-not-pipes.md) — `cmd | tail` makes `$?` tail's; caused two false "success" reports in one session. Check end state, not a piped command's report
- [Zoho writes + deploy verification](zoho-write-and-deploy-verify.md) — `trigger: []` suppresses Zoho workflows, `skip_feature_execution` max 2; `runAllSilent` prints "No response." on success (returns void) so verify by reading sheets; SA reads occasionally flaky
- [Claude dotfiles](claude-dotfiles.md) — Meta/claude-dotfiles carries ~/.claude + ~/.codex/hooks between machines; `sync.ps1 -Mode push` after editing a skill or global CLAUDE.md; no remote yet
- [Unmatched-rep hardening](unmatched-rep-hardening.md) — 2026-07-30 auto-run fix SHIPPED + merged (`c3ad8cc`); the Split Credit Partner ERROR is load-bearing, do NOT mirror the severity change; open work in `.scratch/unmatched-rep-hardening/`
