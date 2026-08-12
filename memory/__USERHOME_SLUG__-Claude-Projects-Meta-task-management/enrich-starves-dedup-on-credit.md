---
name: enrich-starves-dedup-on-credit
description: "classify.py draws on the Console prepaid balance, NOT Claude Code usage credits — a separate wallet that can be empty while this session runs fine."
metadata: 
  node_type: memory
  type: project
  originSessionId: 1590605e-3ec6-4274-8d87-158d22da6b92
  modified: 2026-08-03T17:58:04.603Z
---

`scripts/classify.py` authenticates with the `sk-ant-api03-…` key at `~/.config/aac/anthropic_api_key`, which draws on the **console.anthropic.com prepaid balance**. That is a different wallet from the Claude Code / claude.ai subscription usage credits. Proven 2026-07-31: the key returned `Your credit balance is too low to access the Anthropic API` on a plain 8-token sync call while the Claude Code session issuing that call was running normally.

**Since `0cbbbd8` (2026-08-03) the key resolves as a CHAIN, not one credential** — `aacx/keychain.py`: `$ANTHROPIC_API_KEY`, `$ANTHROPIC_API_KEY_FILE`, `~/.config/aac/anthropic_api_key` (primary), `~/.config/aac/anthropic_api_key_backup` (fallback, override `$ANTHROPIC_API_KEY_BACKUP_FILE`). Preflight fails only when **every** candidate is rejected; `_client()` picks the first accepted key once per half. Write key files with `-Encoding ascii` — PowerShell 5.1 `Set-Content -Encoding utf8` adds a BOM (tolerated now via utf-8-sig, but it once produced a false-green preflight). As of 2026-08-03 the backup file does not exist yet, so the chain has nothing to fall back to.

**Cost is not the trigger.** The full-coverage enrich that preceded the outage (`input=2,786,304 output=196,007 cache_read=625,994`, Sonnet 5 over the Batch API) is worth roughly **$4** at the intro rate with the 50% batch discount — about $12 at worst without either. A funded balance absorbs that. When this fires, the balance was already near zero; enrich was just the call that reached the floor.

**Failure shape:** enrich (step 5-7) runs before dedup (step 10), so enrich succeeds on the last of the balance and dedup gets nothing. Both halves are `isolated` under the sweep's failure policy, so the run still exits green and still executes writes — silent unless `classify: batch failed` appears in the log.

**How to apply:** top up at console.anthropic.com → Plans & Billing; subscription usage credits will never fix it, and neither will waiting. Read the log line before trusting a create set. A dedup outage is *not* why duplicates reach the board — see [[surface-has-no-intra-run-dedup]]. Related: [[classify-script]].
