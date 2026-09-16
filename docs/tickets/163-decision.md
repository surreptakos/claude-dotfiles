# Issue 163: gh in every AAC cloud container — decision + proof

**Status:** hook landed on this branch, exercised only in a desktop simulation; the
first real-container run, the cross-repo proof and the two probes are listed under
"What remains" at the end.

## Install point

The harness-delivered per-repo `SessionStart` hook — the one per-repo artefact the
scope-as-ticket-1-of-spec-#207 comment (2026-09-15) locks in. Landed here as
`.claude/hooks/session-start.sh`; the same file lands in every AAC repo through the
project-harness skill when that skill's cloud-bootstrap step is added (out of scope for
this ticket per the spec: "Tickets to file at decomposition: ... the harness step that
delivers the bootstrap hook and permission posture").

The two alternatives are ruled out for the reasons the spec records:

- **Cloud environment setup script:** runs before the session's git credentials exist, so
  a private-marketplace clone fails there. Verified 2026-09-09 on claude-dotfiles
  (`.claude/settings.json`, `_comment` field).
- **Plugin SessionStart hook:** cannot install the plugin — the plugin has to be present
  already for its own hook to run. The plugin's SessionStart hook is what the bootstrap
  merges into `~/.claude/settings.json` at step 4 so it fires on prompt 1 of the same
  session, not on the next one.

## What the hook does

1. Exit 0 unless `CLAUDE_CODE_REMOTE=true` (local sessions have `~/.claude` populated
   already).
2. Shallow-clone `surreptakos/claude-dotfiles` master to `~/.aac-dotfiles/`, or reuse the
   directory a prior run left. `BOOTSTRAP_SOURCE` overrides the clone for tests and the
   Linux CI bootstrap job (issue 174 replacement).
3. Install `gh 2.86.0` from the pinned release tarball to `~/.local/bin/gh`, add that
   directory to PATH through `$CLAUDE_ENV_FILE` (the hook's own PATH change dies with the
   hook).
4. Copy every skill dir under `marketplace/aac-skills/skills/` into `~/.claude/skills/`,
   replacing each. Skipped when the source tree's SHA-256 fingerprint is unchanged and
   the copy marker already exists — the idempotent case.
5. Merge `marketplace/aac-skills/hooks/hooks.json` into `~/.claude/settings.json`,
   tagging each merged entry with `_source: aac-bootstrap-plugin-hook`. A second run
   strips its own entries and re-adds them, so the plugin's SessionStart marker hook
   never grows a duplicate row (issue 166 double-SessionStart, folded into #207).
6. Write the marker file at `~/.claude/hook-state/aac-bootstrap/state.json` (payload
   version, skills list, skills-hash, gh path, merged hook events, installed_at,
   copied_this_run). Session-check reads it.
7. Emit one SessionStart `additionalContext` line, under 2 KB, listing the payload
   version and every installed skill by name. Truncated names, not the payload version
   or the marker sentence.

## Session-check STOP

`agents/skills/session-check/bootstrap-check.js` reads the marker; check.js calls it
under `IS_CLOUD` only, with the header `Cloud bootstrap`:

- marker absent → `STOP aac-bootstrap marker absent at <path> — the SessionStart
  bootstrap hook did not run`.
- marker's `skills` array names any skill without a `SKILL.md` on disk → `STOP N
  aac-skills skill(s) named in the marker are absent from <path>`, then each missing
  skill listed.
- ok → `ok aac-bootstrap payload vX — N skills, gh installed`, plus a note comparing
  the marker's payload version to whatever the local dotfiles clone
  (`~/.aac-dotfiles/marketplace/aac-skills/.claude-plugin/plugin.json`) says master
  offers.

Local sessions skip the whole section (the desktop authors the payload; the check would
false-STOP on every clean local run).

Tests: `agents/skills/session-check/bootstrap-check.test.js` (9 cases) plus four cases
appended to `agents/skills/session-check/check.test.js` (STOP-marker-absent,
STOP-skills-missing, ok-with-drift-line, silent-on-local).

## GraphQL-blocked list (session-end substitution table shrinks to this)

The claude-dotfiles issue 163 comment (2026-09-14) recorded that `gh api` REST works
through the proxy and GraphQL-backed commands 403. The behaviours that stay in the
substitution table after this ticket lands:

- `gh api --paginate` fails on page 2 with HTTP 403 when the Link header carries a
  `repositories/{id}/...` path. Pagination must use explicit `&page=N`.
- `gh api graphql` — refused outright. Tracker-audit's dependency query is the one
  in-repo consumer (issue 171 covers it).
- Anything under `gh issue` / `gh pr` / `gh repo view --json`. `gh api repos/...`
  reproduces every one of them.
- Branch delete via any route (`gh api -X DELETE repos/{}/git/refs/heads/{}`, and any
  gh subcommand that would). Only `delete_branch_on_merge` on the repo settings
  cleans a merged branch up.
- Any REST call whose target repo is not attached to the session — HTTP 403 `not
  enabled for this session`, with an `add_repo` remedy in the body. Attaching the
  repo is the only substitute; no path spelling works around it.
- Review threads, auto-merge, ready-for-review and convert-to-draft have no REST
  equivalent. The 403 body names the CCR-hosted route to call instead; use the path
  it quotes.

`gh auth status` reports `The token in GH_TOKEN is invalid` in a container even while
`gh api repos/...` answers on the same session — the proxy does the auth, not
GH_TOKEN. Expected noise, not a blocked command: it does not belong in the
substitution table, and an agent that chases it is chasing nothing.

Nothing else known to be blocked. Everything the tracker audit and session-check
call — `gh api repos/.../issues`, `.../pulls`, `.../issues/N/comments`,
`.../milestones`, `.../actions/runs`, `.../actions/workflows` — is REST and answers.

## Proof so far: a desktop simulation, not a container

No claude.ai/code container has run this hook yet. A container clones dotfiles master at
boot, and master does not carry this branch until it merges, so the only run available
from a branch is a simulation: Git Bash on the Windows desktop, a fresh fake HOME,
`BOOTSTRAP_SOURCE` pointed at the branch under test, `BOOTSTRAP_SKIP_GH=1` because the
pinned tarball is a `linux_amd64` binary. The `gh` lines below are the desktop's own gh
(2.96.0), resolved by `command -v gh`, not the 2.86.0 the hook installs in a container.

Script: `C:\hv17\proof163.sh` (kept outside the repo). Log, verbatim, from
`C:\hv17\proof163.log` (branch head after the env-file fix):

```
==== simulation context ====
host:    MINGW64_NT-10.0-26200 (Git Bash on the desktop, not a claude.ai/code container)
source:  /c/hv17/wt163 @ c71c256
HOME:    /c/hv17/sim163/home
before:  .claude exists? no

==== run 1 ====
exit: 0
additionalContext bytes: 1068
AAC-BOOTSTRAP MARKER: payload v2026.9.151724; skills copied=61; gh=C:/Program Files/GitHub CLI/gh skills=[aac-contract-package,aac-google-access,aac-house-writi ...
marker:  payload v2026.9.151724, 61 skills, copied_this_run=61, hooks_events=['SessionStart']
settings hooks[SessionStart]: 1 entries, tagged=1
skills dirs: 61

==== run 2 ====
exit: 0
additionalContext bytes: 1067
AAC-BOOTSTRAP MARKER: payload v2026.9.151724; skills copied=0; gh=C:/Program Files/GitHub CLI/gh skills=[aac-contract-package,aac-google-access,aac-house-writin ...
marker:  payload v2026.9.151724, 61 skills, copied_this_run=0, hooks_events=['SessionStart']
settings hooks[SessionStart]: 1 entries, tagged=1
skills dirs: 61

==== env file ====
export PATH="/c/hv17/sim163/home/.local/bin:$PATH"

==== gh --version (desktop gh, not the tarball) ====
gh version 2.96.0 (2026-07-02)

==== gh api repos/surreptakos/aac-routines ====
{"default_branch":"main","full_name":"surreptakos/aac-routines","private":true}

==== session-check, marker present (IS_CLOUD via CLAUDE_CODE_REMOTE_SESSION_ID=sim) ====
13:Cloud bootstrap
14-  ok   aac-bootstrap payload v2026.9.151724 — 61 skills, gh installed
15-      payload v2026.9.151724 loaded; master version could not be read here

==== session-check, marker MISSING ====
13:Cloud bootstrap
14-  STOP aac-bootstrap marker absent at C:\hv17\sim163\home\.claude\hook-state\aac-bootstrap\state.json — the SessionStart bootstrap hook did not run
15-      the hook is `.claude/hooks/session-start.sh` in every AAC repo; a container reaches it via CLAUDE_CODE_REMOTE=true
```

What the simulation establishes: the hook exits 0 twice on one HOME, copies the 61 payload
skills once and skips the copy on the second run, merges exactly one tagged SessionStart
entry into the user settings and does not duplicate it, writes the marker, emits an
additionalContext under 2 KB, and session-check reads the marker in both states. The
first simulation run (before the fix) appended the PATH export to `$CLAUDE_ENV_FILE` on
every run, because the hook process's own PATH never carries `~/.local/bin`; the hook now
greps the env file for the exact line before appending, and run 2 above shows one line.

What it does not establish: the `curl` tarball install of gh 2.86.0, the shallow clone of
master at boot, and `$CLAUDE_ENV_FILE` being sourced by the harness. The previous
version of this hook (master before this branch) exercised the first two in a real
container on 2026-09-14 (session cse_014KM9VnjCoAR3CTZ8BgXfq3, quoted on this issue:
`gh version 2.86.0 (2025-09-11)`); those lines are unchanged here.

One more local check, on the shape the hook writes into `~/.claude/settings.json`: a
SessionStart entry carrying the extra `_source` key. A project-level `.claude/settings.json`
with that exact shape, run through `claude -p` (Claude Code 2.1.269) from a neutral
directory, fired the hook (two `fired-<epoch>` lines, the double SessionStart of issue 166)
and printed no settings warning. The extra key does not invalidate the entry.

## What remains, in order

1. Merge this branch. Master then carries the hook.
2. One fresh claude.ai/code session on claude-dotfiles quotes, on this issue: the
   additionalContext line, `gh --version` (expected 2.86.0 from the tarball), one
   `gh api repos/surreptakos/claude-dotfiles` call, and session-check's `Cloud bootstrap`
   block. That is the first real-container run of this code.
3. Proof on a repo other than claude-dotfiles needs the hook in that repo's
   `.claude/settings.json`, which is the project-harness step (#218). The cross-repo
   `gh --version` and `gh api repos/{owner}/{repo}` quotes land there.
4. The two probes (merge_pull_request through the GitHub MCP on a throwaway PR; the fleet
   command inventory prompt-free in auto mode with the #205 allow list) run in the same
   cloud session as step 2.

The issue stays open until step 2 is quoted on it.
