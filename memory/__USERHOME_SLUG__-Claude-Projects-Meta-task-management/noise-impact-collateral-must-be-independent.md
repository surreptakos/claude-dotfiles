---
name: noise-impact-collateral-must-be-independent
description: aacx noise-impact judges an entry only on evidence formed independently of the surfacer; inferred loops are circular.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6b0f9795-d748-4ce6-a1b2-9fae4b98af30
  modified: 2026-08-10T15:44:50.896Z
---

`aacx noise-impact <entry>` (shipped 2026-08-10, #116) measures a proposed
`config/noise.yaml` entry before it ships, per the standing rule from
2026-08-03. Contract `{target, collateral, safe}`, ported from `aliasImpact()`.

**Why:** the first cut counted an inferred commitment or a `create` action as
proof an item mattered, and every one of #116's eight proposed entries came back
`safe: false`. That is circular — those items carry inferred loops *because* the
noise gate failed to deny them. Judging the surfacer's gate by the surfacer's own
output makes every correct entry unshippable.

**How to apply:** collateral rests only on evidence formed independently of the
loop surfacer — an `origin='enrich'` commitment, a p1/p2 enrichment, or a Todoist
task Dan completed. The circular class is reported as `inferred_only`, never as a
reason to refuse. `safe` is a floor, not a certificate: read the sample anyway,
because on 2026-08-03 the engine had not recognised the CVS Sev 1 escalation
either.

It earned its keep on first use: `hello@leavedates.com` looked like pure noise and
carries staff leave approvals (collateral 2); `rippling.com` would have silenced
5 p1/p2 task notifications. Both refused; narrower entries shipped instead.

Related: [[live-writes-on-noise-gate-open]], [[surface-has-no-intra-run-dedup]],
[[verify-inferences-against-the-store]].
