# Cloud connectors and OneDrive — research for ticket #156

Part of #154. Dan's ruling: cloud sessions need OneDrive and Google Drive access equal to the PC.
This session (a `claude.ai/code` container worktree session) carries a live Microsoft 365 connector
and a live Google Drive connector, so several bullets below are answered by a live probe run from
inside a cloud session in this same session, not just by reading docs — each such finding is marked
**live probe**.

## 1. Are claude.ai connectors available to claude.ai/code container sessions, and to Routine-launched sessions?

**Docs.** code.claude.com/docs/en/mcp carries a table, "How connectors reach Claude Code," with one
row per session kind:

> | Where the session runs | How connectors arrive | What governs them |
> | Terminal, VS Code, JetBrains, and Agent SDK sessions | Claude Code fetches them from claude.ai | ... |
> | Cloud sessions | The remote host passes them in | Your claude.ai organization settings, plus the allowlist and denylist settings ... |
> | The desktop app's local and SSH sessions | The desktop app delivers them in-process | ... |

— quoted from https://code.claude.com/docs/en/mcp (fetched 2026-09-14). A **cloud session** (the
doc's term for a `claude.ai/code` container) does not fetch connectors itself; the remote host
injects them, filtered by `allowedMcpServers`/`deniedMcpServers` reaching the session and any
`managed-mcp.json` on the host. Same page, on re-auth inside a cloud session:

> "For a connector delivered to a cloud session, Claude Code doesn't run a sign-in flow, because the
> session's proxy authenticates to the connector with the authorization you granted in claude.ai."

**Live probe (this session).** `mcp__ccd_connectors__session_connectors_status` — a tool built for
exactly this question — returned, among ~90 rows, both target connectors already `connected`:

```
{"name":"Microsoft 365","id":"3e069be3-...","kind":"connector","status":"connected","tool_count":50}
{"name":"Google Drive","id":"489f0310-...","kind":"connector","status":"connected","tool_count":11}
```

Both connectors' tools (`sharepoint_search`, `search_files`, etc.) were then called live in this
session and returned real data (below) — direct proof the container carries a working, already-
authenticated MCP session for each, matching the doc's "remote host passes them in" description.

**Routine-launched sessions.** WebSearch surfaced Anthropic's own Routines material (arcade.dev
summary of Anthropic's docs, not independently re-fetched from an Anthropic-owned domain, so treat
as secondary corroboration, not primary): "A routine is a saved Claude Code configuration (prompt,
repositories, and connectors) packaged to run automatically on Anthropic-managed cloud
infrastructure. All your connected MCP connectors are included by default." That is consistent with
Routines running as a species of cloud session and inheriting the same connector-passing mechanism
as any other cloud session (docs page above), but I did not find an Anthropic-domain page stating
this for Routines specifically — **docs are silent on Routines by name**. Live probe to settle it:
from inside a Routine-launched session, call `mcp__ccd_connectors__session_connectors_status` (the
same tool used above) and check whether the Microsoft 365 / Google Drive rows show `connected`.

A live GitHub issue (anthropics/claude-code#92999, title: "Scheduled routines (RemoteTrigger) report
'no connectors' despite connectors showing as Connected in claude.ai") reports the opposite in
practice for at least some users/versions — a routine's connector-availability check returning empty
despite claude.ai showing the connector connected. This is a bug report, not documentation, and not
independently reproduced here — but it means "docs describe it as included by default" and "it works
in practice for every routine" are not the same claim, and the discrepancy is exactly the kind a live
probe (above) settles per-account/per-version rather than a doc citation.

## 2. Does the M365 connector's SharePoint tool set reach personal OneDrive (Graph `/me/drive`), or only SharePoint sites? Which tools read, which write?

**Docs.** support.claude.com/en/articles/15183774-connect-to-microsoft-365 states the connector
"Access[es] files stored in your OneDrive and have Claude analyze content without manually uploading
them" — i.e. OneDrive is documented as in scope, not just SharePoint sites — but requires a **work**
Microsoft 365 / Entra tenant account: "Personal Microsoft accounts (such as @outlook.com,
@hotmail.com, or @live.com) can't be used." The connector installed here is against the work tenant
`activealarm.com`, so this restriction does not block Dan's own OneDrive.

**Live probe.** Called `sharepoint_search` (query `"a"`, limit 5) live in this session. Every result
that came back was a personal OneDrive item, not a site library: e.g.

```
"webUrl":"https://activealarm-my.sharepoint.com/personal/dgatsakos_activealarm_com/Documents/Downloads/..."
```

The `-my.sharepoint.com/personal/<user>` host+path is the SharePoint front-end for a user's personal
OneDrive for Business drive (Graph's `/me/drive` backing store) — this is the pattern Microsoft Graph
docs describe for `/me/drive` / `/drives/{drive-id}` where the drive's `driveType` is `personal`, as
distinct from a `documentLibrary`-type drive under `/sites/{site-id}/drive`. So: **confirmed live —
`sharepoint_search` does reach personal OneDrive content**, not only SharePoint team-site libraries.
`get_granted_scopes` (called live) returned the actual delegated Graph scopes for this connector:

```
Calendars.Read, Calendars.Read.Shared, Channel.ReadBasic.All, ChannelMessage.Read.All, Chat.Read,
Chat.ReadBasic, ChatMember.Read, ChatMessage.Read, Files.Read, Files.Read.All, Mail.Read,
Mail.Read.Shared, Mail.ReadBasic, MailboxFolder.Read, MailboxItem.Read, OnlineMeetingAiInsight.Read.All,
OnlineMeetingArtifact.Read.All, OnlineMeetingRecording.Read.All, OnlineMeetings.Read,
OnlineMeetingTranscript.Read.All, Sites.Read.All, User.Read, User.ReadBasic.All
```

Every scope in that list ends `.Read` or `.Read.All` / `.ReadBasic`. **No write scope is present**
(no `Files.ReadWrite`, `Sites.ReadWrite.All`, `Mail.Send`, `Calendars.ReadWrite`, etc.). This is data
from a live call, quoted verbatim above; the inference from it is: for the Entra app registration
behind this org's connector, as currently consented, write calls would be rejected by Graph with
insufficient-privilege regardless of which MCP tool is invoked — I did not call a write tool to
confirm this (doing so would create/modify a real file in Dan's OneDrive, which needs explicit
permission first and is out of scope for a research ticket), so this is inference from the granted-
scopes list, not a second live-tested fact.

**Tool inventory (from the MCP tool schemas, all `mcp__3e069be3-...__*`):**

Read tools: `sharepoint_search`, `sharepoint_folder_search`, `outlook_email_search`,
`outlook_calendar_search`, `chat_message_search`, `teams_list_*`, `search_people`, `get_me`,
`get_granted_scopes`, `find_meeting_availability`, `read_resource` (fetch full content of a search
hit by URI).

Write tools (schema-declared, gated behind org admin enabling write tools per the support article —
"If your admin has enabled write tools, Claude can also draft and send emails, manage calendar
events, create and update files, and send Teams messages"): `sharepoint_upload_file`,
`sharepoint_update_file`, `sharepoint_create_folder`, `sharepoint_copy_item`,
`sharepoint_move_item`, `sharepoint_rename_item`, `sharepoint_delete_item`, `outlook_send_mail`,
`outlook_create_draft`, `outlook_create_event`, `outlook_update_event`, `outlook_delete_event`,
`teams_send_channel_message`, `teams_send_chat_message`, and more of the same shape.

`sharepoint_upload_file`'s own schema description names OneDrive explicitly: "Create a new file in a
**SharePoint document library or OneDrive folder**" — so the write-tool set is documented (by the
tool itself) to target OneDrive as well as SharePoint libraries, addressed by Graph `driveId`, the
same way the read side already proved out live. Given no write scope shows up in
`get_granted_scopes` for this account, whether that OneDrive-write path actually succeeds here is
unverified — live probe to settle it: with the user's explicit go-ahead, call
`sharepoint_upload_file` against a disposable test file/folder and read the result (success vs Graph
403).

## 3. Does the Google Drive connector cover the AAC shared drives, or is the service-account REST path still required for Sheets/Drive writes?

**Docs.** support.claude.com/en/articles/10166901-use-google-workspace-connectors does not mention
shared drives or Claude Code/cloud sessions at all — confirmed by a direct fetch; the page only says
Drive is "available for all users on Claude and Claude Desktop" and describes a code-execution
save-to-Drive feature. **Docs are silent on shared-drive coverage.**

**Live probe.** Called `search_files` live (`fullText contains 'AAC'`). Results included a folder
"AAC Shared" and several spreadsheets ("AAC Reports Dashboard", "AAC AP Intake — Log",
"AAC_Deal_Snapshots_2026", "AAC 2026 Sales Commissions Workbook") with `parentId` values including
`0ACLXiL9lkoWHUk9PVA`. A Google Drive resource ID beginning `0A` is the Shared Drive (Team Drive)
root ID pattern in the Drive API (regular My Drive folder/file IDs don't start `0A`). So: **confirmed
live — the connector's search reaches into at least one Shared Drive**, not only the connecting
user's My Drive, and it read spreadsheet body content (`contentSnippet` included live cell data),
i.e. read access to Sheets content works through this connector.

**Write capability — confirmed absent for existing files.** The full Google Drive connector tool set
(11 tools, all `mcp__489f0310-...__*`) is: `search_files`, `list_recent_files`, `read_file_content`,
`get_file_metadata`, `get_file_permissions`, `create_file`, `update_file`, `copy_file`, `share_file`,
`trash_file`, `download_file_content`. `update_file`'s own schema says, verbatim: "Request to update
a file (**currently only title and parent_id are supported**)" — it cannot write new content into an
existing file (no cell-level or whole-body write to an existing Sheet/Doc). `create_file` can create
a brand-new file/Sheet, but that is a new document, not an edit to `AAC Reports Dashboard` or the
other live-referenced workbooks above.

**Conclusion:** for reading AAC shared-drive Sheets/Docs content, the Google Drive connector is
sufficient (proved live). For **writing into an existing AAC Sheet** (appending rows, updating
cells — the shape of work `aac-google-access`'s service-account REST path exists for), the connector
has no tool that does it; `~/.claude/skills/aac-google-access/SKILL.md` (read directly, this
machine) documents the service-account path — key at
`~/.config/gpt-sheets-access-475817-853f8648243b.json`, used "for direct Sheets/Drive REST — bypasses
the gen-AI-ineligible flag and never expires" — as the mechanism for exactly that. **The
service-account REST path is still required for Sheets/Drive writes to existing files**; this is not
inference from absence alone, it's the connector's own schema stating what `update_file` does and
does not cover.

## 4. Any per-session auth step a Routine cannot perform?

**Docs**, same code.claude.com/docs/en/mcp page: "For a connector delivered to a cloud session,
Claude Code doesn't run a sign-in flow, because the session's proxy authenticates to the connector
with the authorization you granted in claude.ai. When a connector there needs authorizing again,
**reconnect it at claude.ai/customize/connectors rather than from the session.**"

**Live probe corroboration.** `session_connectors_status`'s own tool description (loaded and called
live in this session) says the same thing operationally: "Servers that need authentication can only
be signed in by the user: ask them to type `/mcp` in this session (or open Settings → Connectors) and
connect there." In this session's actual connector list, dozens of plugin-provided connectors sit in
`needs_auth` (Slack, Box, Notion, Asana, Linear, HubSpot, GitHub, etc. — full list in the raw tool
output) precisely because no OAuth consent flow runs inside the session.

**Answer:** the (re-)authorization / OAuth-consent step is the one a session — Routine or otherwise —
cannot perform on its own; it requires the account owner to act in the claude.ai web UI
(`claude.ai/customize/connectors` or `/mcp`). A Routine, being unattended by definition, cannot
recover from an M365 or Google Drive connector landing in `needs_auth` or `failed` mid-run; it can
only detect that state (`session_connectors_status`) and stop or fall back (e.g. to
`aac-google-access`'s service-account path, which needs no interactive consent per
`~/.claude/skills/aac-google-access/SKILL.md`). Live probe to fully close this: run
`session_connectors_status` from inside an actual Routine-launched session (not this manually-started
worktree session) to confirm the M365/Google Drive rows arrive pre-`connected` there the same way
they did here — settles bullet 1's Routine question and this one together.

## Supporting citation: cloud sessions already use MCP tools in this repo

`orchestrator/RUNBOOK.md` documents a cloud worker session using MCP tools in place of the `gh` CLI,
independent of the claude.ai-connector question above but confirming cloud sessions can hold and use
MCP tool sets generally:

> "**Fleet** — `orchestrator/ticket-fleet-cloud.js`, run by the worker via the Workflow tool. The
> cloud port of `.claude/workflows/ticket-fleet.js`: same scout / pinned implementer / blind
> refuting verifier / deliver shape, with GitHub MCP tools replacing the `gh` CLI." (`orchestrator/RUNBOOK.md`, lines 27–29)

That GitHub MCP server is a **plugin**-kind server (`plugin:engineering:github` in this session's own
`session_connectors_status` output, currently `needs_auth` here), not a claude.ai **connector** —
same delivery question, different server kind; the RUNBOOK line is evidence cloud/worker sessions
carry and use MCP tool sets as a matter of course, not itself proof about connector-kind servers.

## Sources

- https://code.claude.com/docs/en/mcp — connector delivery table, cloud-session re-auth behavior
- https://support.claude.com/en/articles/15183774-connect-to-microsoft-365 — M365 connector OneDrive/SharePoint coverage, work-tenant-only restriction, read vs. write tool lists
- https://support.claude.com/en/articles/10166901-use-google-workspace-connectors — Google Drive connector, availability, silent on shared drives and Claude Code
- `orchestrator/RUNBOOK.md` (this repo, lines 3–29)
- `C:/Users/Dan/.claude/skills/aac-google-access/SKILL.md` (this machine, read directly)
- Live tool calls in this session: `mcp__ccd_connectors__session_connectors_status`,
  `mcp__3e069be3-3fa6-4242-bad7-d8c0847e0abb__sharepoint_search`,
  `mcp__3e069be3-3fa6-4242-bad7-d8c0847e0abb__get_granted_scopes`,
  `mcp__3e069be3-3fa6-4242-bad7-d8c0847e0abb__get_me`,
  `mcp__489f0310-8d01-4462-b90d-7fea667fd442__search_files`
- anthropics/claude-code#92999 (GitHub issue, secondary — bug report, not docs) — routine connector-availability check reported empty despite claude.ai showing connected
