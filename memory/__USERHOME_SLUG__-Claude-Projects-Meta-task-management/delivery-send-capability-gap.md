---
name: delivery-send-capability-gap
description: sweep step 15 self-send WORKS via the clasp Gmail token (mail.google.com scope) — send from djgatsakos@gmail.com to dgatsakos@activealarm.com. MCP connectors are read-only.
metadata: 
  node_type: memory
  type: reference
  originSessionId: f1f29b8d-a5d4-4a36-8f49-8c6357011f21
  modified: 2026-07-23T20:35:29.339Z
---

The daily-sweep step 15 "self-send the delivery payload to Dan" **is achievable** — do NOT claim it can't be done. The path (verified working 2026-07-23, Gmail msg id 19f90b06c27cac25):

- **Use the clasp token** at `~/.clasprc.json` (`tokens.default`: client_id, client_secret, refresh_token). Refresh at `https://oauth2.googleapis.com/token` (grant_type=refresh_token), then send via `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with a base64url RFC822 message and `Authorization: Bearer <access_token>`. The token's granted scopes **include `https://mail.google.com/`** (verify via `oauth2.googleapis.com/tokeninfo?access_token=`, don't assume). Owner is **djgatsakos@gmail.com**, so From = that Gmail; To = **dgatsakos@activealarm.com** (Dan's work address). This is a self-send (Dan→Dan). Use Python + urllib/stdlib; print status + message id only, never the token.
- The email body is `data/briefs/Morning Brief {date} (Delivery).md`.

What does NOT work: the **Outlook M365 MCP connector (server d905df72) is read-only** (search/read only, no send/reply/draft), and there is no Teams send tool. The Gmail MCP (5811a9c7) only creates drafts. So the clasp-Gmail-API route above is the delivery channel. My earlier-in-session claim that no send capability existed was wrong — it overlooked the clasp Gmail token in [[the global CLAUDE.md]]. Related: [[python-interpreter-path]].
