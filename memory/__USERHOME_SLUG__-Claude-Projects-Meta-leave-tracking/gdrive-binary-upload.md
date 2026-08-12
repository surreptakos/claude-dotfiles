---
name: gdrive-binary-upload
description: "How to upload binary files (xlsx, zip) to Dan's Google Drive — working path vs dead ends"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9cddf3e3-b997-4753-8bd7-90d2308275cc
  modified: 2026-07-23T14:33:34.602Z
---

To put files on Dan's personal Google Drive (djgatsakos@gmail.com), which he uses to host work stuff:

**WORKS — clasp token + Python/urllib (use this):** `~/.clasprc.json` → `tokens.default` holds `client_id`, `client_secret`, `refresh_token`. Refresh at `https://oauth2.googleapis.com/token` (grant_type=refresh_token), then Drive API v3 `uploadType=multipart` with `urllib` (no `requests`/google libs installed). Reads file bytes off disk, so binaries are fine. Scope is `drive.file`, which is enough to create files/folders AND to write into folders owned by the same user even if another app created them (confirmed: uploaded into the MCP-connector-created folder). Builder: scratchpad `build_upload.py`.

**DEAD ENDS:**
- **MCP Drive connector** `mcp__a4745102...__create_file` only takes inline `textContent`/`base64Content`. Fine for text/markdown; impractical for binaries (can't hand-author base64). It runs as djgatsakos@gmail.com.
- **Service account** (`gpt-sheets-access@...`, key in `~/.config/`) has full Drive scope but **no My Drive storage quota**, so it cannot host binary uploads (My Drive) — quota error. Good only for operating on files shared TO it, per [[leave-audit-method]] / CLAUDE.md.
- **Claude-in-Chrome** extension was not connected this session.

Governance note: I initially told Dan binaries "couldn't" be uploaded before trying the documented clasp path — violated the CLAUDE.md "attempt before claiming you can't" rule. Try the clasp/Python path first next time.
