# Google from a cloud container — three transports, the Gmail limit, the MCP-prefix fact

Recorded for issue 172, verified 2026-09-16 in a claude.ai/code container on the Pro/Max account.
Parent evidence: issue 164 comment 5667782333 (2026-09-14).

The code half shipped with this doc is `tools/google-rest.py` (tests: `tools/google-rest.test.py`).
It is the shared helper every Google call in this repo should go through, and it branches on
`CLAUDE_CODE_REMOTE` itself, so a caller never has to know which surface it is on.

## The three transports

| Surface | Credential | What the code does |
| --- | --- | --- |
| Pro/Max cloud session (`CLAUDE_CODE_REMOTE=true`) | environment API credential held by the agent proxy | sends **no** `Authorization` header; the proxy mints the SA token and attaches it to every `*.googleapis.com` request |
| Team / Enterprise | `GPT_SHEETS_SA_KEY_JSON` on an owner-only environment | reads the key JSON from the variable and signs (`service_account` → `AuthorizedSession`) |
| The owner's PC | key file `~/.config/gpt-sheets-access-475817-853f8648243b.json` | signs (`service_account` → `AuthorizedSession`) |

All three arrive as `gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com`, so a
workbook is reached by sharing it Editor with that address, whichever surface the session is on.

The env variable is checked **before** `CLAUDE_CODE_REMOTE`, not after: a Team cloud container sets
`CLAUDE_CODE_REMOTE=true` as well, but the API-credentials section does not exist on Team or
Enterprise plans, so its proxy attaches nothing and the ambient branch would send an
unauthenticated request into a 401.

In a Pro/Max container, building a credential is wrong twice over: there is no key to load, and a
self-signed JWT collides with the header the proxy already attached. `google-rest.py` therefore
imports `service_account` / `AuthorizedSession` only on the two key-bearing branches, and strips an
`Authorization` header a caller passes in on the cloud branch.

## The proxy replaces a header you send, it does not pass it through

```
$ curl -s -H "Authorization: Bearer not-a-real-token" "https://www.googleapis.com/drive/v3/about?fields=user"
{ "user": { ... "emailAddress": "gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com" } }
```

A deliberately bogus bearer token answered `200` as the service account. So signing in a Pro/Max
container does not fail loudly — it silently runs as a principal the code did not choose. That is
the real argument for the unauthenticated branch: the transport should be visible in the code, not
inferred from which identity came back.

It also means `gas/cli/gas.js`, which mints its own token from the clasp user credential
(`GAS_CREDENTIALS_JSON` / `~/.clasprc.json`) and talks to `script.googleapis.com`, runs as the SA —
not as `djgatsakos@gmail.com` — whenever it is invoked from a Pro/Max cloud container. It does not
match this ticket's grep (no `service_account` / `AuthorizedSession`; it is a user-credential
helper, and the SA cannot run Apps Script functions at all), and Apps Script deploys stay on their
existing GitHub-ref path, so it is left alone here and recorded as a finding instead. In CI, where
`CLAUDE_CODE_REMOTE` is unset and no agent proxy sits in front of Google, nothing changes for it.

## Gmail rides none of them

`mail.google.com` on the service-account token answers `400 Precondition check failed`: the SA has
no mailbox, and a personal @gmail.com cannot delegate. The helper refuses Gmail on every transport
rather than letting the failure read as a scope problem. Gmail from a cloud session is the
claude.ai Gmail connector; on the PC it is the clasp token.

## Verification (this container, 2026-09-16)

```
$ ls ~/.config/gpt-sheets-access-475817-853f8648243b.json; echo "GPT_SHEETS_SA_KEY_JSON=[$GPT_SHEETS_SA_KEY_JSON]"
ls: cannot access '/root/.config/gpt-sheets-access-475817-853f8648243b.json': No such file or directory
GPT_SHEETS_SA_KEY_JSON=[]

$ python3 tools/google-rest.py transport
cloud-proxy	CLAUDE_CODE_REMOTE (agent proxy attaches Authorization; we send none)

$ python3 tools/google-rest.py whoami
gpt-sheets-access@gpt-sheets-access-475817.iam.gserviceaccount.com

$ python3 tools/google-rest.py cell 1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg "Script Errors!A1"
Timestamp

$ python3 tools/google-rest.py cell 1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg A1
ATTN items (minus waiting)

$ python3 tools/google-rest.py get https://gmail.googleapis.com/gmail/v1/users/me/profile
google-rest: Gmail cannot ride the service account (mail.google.com -> 400 Precondition check failed: the SA has no mailbox, and a personal @gmail.com cannot delegate). Use the claude.ai Gmail connector from a cloud session, or the clasp token on the PC.
(exit 1)
```

The workbook is Message Board (`1dBhSYwk1lHXAosMtbdQ4qI73Rb60BBiB4S6h42ruUQg`), shared Editor with
the SA. No key file on disk, no `GPT_SHEETS_SA_KEY_JSON`, no `Authorization` header sent by the
code — the identity comes from the proxy.

## MCP tool prefixes are not stable within a session

On a fresh cloud session's **first turn** every MCP server is mounted under a UUID prefix —
`mcp__<uuid>__create_session`, and connectors likewise. The product-named prefixes
(`mcp__Claude_Code_Remote__*`, `mcp__Microsoft_365__*`) appear only on later turns; `mcp__github__*`
is the one that is stable throughout (issue 166, container C, item 10). A prompt that names a tool
by product prefix therefore works when a human tries it interactively and fails on the first turn of
the session it was written for. Refer to tools by suffix or by capability ("the issue-write tool",
"the session-create tool") in every prompt, skill and runbook. The same paragraph is in
`orchestrator/RUNBOOK.md`, which is where the fleet's prompts are written.

## Where the skill section lives, and the one owner step left

The "From a cloud container" section is in the skill itself, at
`aac-skills/aac-google-access/SKILL.md` — the hand-edited team tree, which is the only skill tree
in this repo a branch may revise. `aac-google-access` was a *personal* skill
(`~/.claude/skills/aac-google-access/`), so its only copy here was the generated `claude/` mirror,
and CLAUDE.md's one rule forbids hand-editing that. Earlier attempts at this ticket hit the two
walls that leaves: editing the mirror breaks the rule, and deleting the mirror to move the skill
breaks it too.

The move lands without touching `claude/` because the packager now resolves the overlap instead of
refusing it. `tools/build-cloud-plugin.py` used to fail the build with
`aac/<name>: name collides with a personal skill` when a name appeared in both trees, which made
the migration impossible to land in one commit. It now skips the mirrored personal copy for any
name that `aac-skills/` also holds and prints

    personal copy superseded by the aac-skills/ source (delete ~/.claude/skills/<name> and push to
    close the window): aac-google-access

so exactly one copy ships, the hand-edited one, and `claude/` is byte-identical to master on this
branch.

**Owner step (not doable from a container):** delete `~/.claude/skills/aac-google-access/` and run
`.\sync.ps1 -Mode push`. The push clears the mirrored tree, `claude/skills/aac-google-access/`
disappears, and the migration window closes. Until then the live personal copy still loads locally
and is the stale one — a local session sees the old text, a cloud session sees the new. Nothing
breaks in the meantime: the packaged plugin already carries the new section on every surface.

`codex/AGENTS.md` carries the same "service_account → AuthorizedSession" line with no cloud
caveat. It is a mirror of `~/.codex` with no hand-edited counterpart in this repo, so it needs the
same live-tree edit on the owner's machine; recorded here rather than worked around.
