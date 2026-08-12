---
name: tax-exempt-property-spelling
description: "TAX_EXEMPT_CUSTOMERS Script Property now includes \"Chicago Park District\" — property overrides core default, which lacks it"
metadata: 
  node_type: memory
  type: project
  originSessionId: 53abe6ea-c9c1-4c7f-81be-a658ee95927a
  modified: 2026-08-05T20:20:02.646Z
---

Set 2026-08-05 via `opsSetProperty`: `TAX_EXEMPT_CUSTOMERS = "CPD, Chicago Park District, Iron
Mountain, Clearbrook, Marklund"`. Both JobData and CRM spell CPD out, and `aliasKeyMatches` is
whole-token, so the `CPD` token alone misses 19 of 21 CPD work orders — the spelled form is what
lifts #54's exempt coverage from 126 to 145 of 821.

**Why:** the core.js:264 default list still reads `['CPD', 'Iron Mountain', 'Clearbrook',
'Marklund']` — no spelled form. The property overrides it at runtime, so deleting the property
silently drops back to CPD-token-only (safe direction: more holds, never a wrong exemption).
**How to apply:** treat the Script Property as the authoritative list; read it before reasoning
about exemption coverage, and re-set the spelled form if the property is ever rebuilt.
