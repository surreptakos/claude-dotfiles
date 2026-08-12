---
name: zoho-token-cache-gotcha
description: aac-bill-intake caches the Zoho Desk access token ~55m; a re-minted grant looks wrong-scoped/wrong-org until the cache is cleared
metadata: 
  node_type: memory
  type: project
  originSessionId: 5b67bf36-f517-4beb-8b8b-906a9e45a4c0
  modified: 2026-07-23T22:30:02.409Z
---

In `aac-bill-intake/gas/Zoho.gs`, `zohoAccessToken_` caches the Desk access token in CacheService for ~55 min. After re-minting and exchanging a Zoho grant, the OLD cached access token keeps being served → every probe reports the previous org/scope ("wrong-scoped token"), even though the newly stored refresh token is correct. This burned a whole session on 2026-07-23 chasing a phantom bad grant.

**Fixed 2026-07-23:** `zohoExchangeGrant` now clears the `ZOHO_ACCESS_TOKEN` cache on success; added `zohoAccessToken_(forceRefresh)`; added `zohoTokenDiag()` (flush cache → force refresh → probe all orgs → log granted `scope`); `[zoho:grant]`/`[zoho:token]`/`[zoho:diag]` logging throughout (logs status + scope, never the token).

**Confirmed facts:** prod Desk org = **874367220** (`activealarmcompany`, sandbox:false). `875376555` is NOT a Desk org for this account (a Zoho CRM/One id — different namespace; Desk returns 422). The prod token is correctly scoped `Desk.{settings,tickets,basic,events,contacts}.ALL` and returns 200 on 874367220. See [[desk-channel-intake-progress]] [[zoho-desk-token-scope]] [[clasp-login-scope-trap]].
