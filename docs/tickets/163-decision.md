# Issue 163: gh in every AAC cloud container — decision + proof

**Status:** hook landed on this branch; two probes captured; the two delivery-stage
probes named in the ticket await master.

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

Nothing else known to be blocked. Everything the tracker audit and session-check
call — `gh api repos/.../issues`, `.../pulls`, `.../issues/N/comments`,
`.../milestones`, `.../actions/runs`, `.../actions/workflows` — is REST and answers.

## Fresh-container proof

Captured this session (2026-09-15) with the hook exercised against a fresh clone of
`surreptakos/aac-routines` under an empty HOME. `BOOTSTRAP_SOURCE` pointed at this
branch so the container ran the code under review, not master. Verbatim from the run
log at `/tmp/aac-proof-output.txt`:

```
==== container context ====
cwd:     /tmp/aac-fresh-container/repo
repo:    https://github.com/surreptakos/aac-routines.git
HOME:    /tmp/aac-fresh-container/home
before:  ~/.claude exists? no

==== run 1 (cold) ====
exit: 0
{
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": "AAC-BOOTSTRAP MARKER: payload v2026.9.151724; skills copied=61; gh=... skills=[aac-contract-package,...,yes]"
    }
}
... 61 skill dirs installed under $HOME/.claude/skills

==== run 2 (idempotent) ====
exit: 0
additionalContext: "AAC-BOOTSTRAP MARKER: payload v2026.9.151724; skills copied=0; ..."
one SessionStart hook entry in ~/.claude/settings.json (still 1 — dedup by _source)

==== gh --version ====
gh version 2.96.0 (2026-07-02)

==== gh api repos/surreptakos/aac-routines (the OTHER repo) ====
{"default_branch":"main","full_name":"surreptakos/aac-routines","name":"aac-routines","private":true,"updated_at":"2026-09-14T21:45:10Z"}

==== session-check with the marker present, IS_CLOUD=1 ====
Cloud bootstrap
  ok   aac-bootstrap payload v2026.9.151724 — 61 skills, gh installed

==== session-check with marker MISSING, IS_CLOUD=1 ====
Cloud bootstrap
  STOP aac-bootstrap marker absent at .../nonexistent/path/state.json — the SessionStart bootstrap hook did not run
      the hook is `.claude/hooks/session-start.sh` in every AAC repo; a container reaches it via CLAUDE_CODE_REMOTE=true
```

**Environment differences from a real Linux cloud container, and why they do not
change the answer.** The proof ran under Git Bash on this Windows PC because a Linux
cloud container cannot be launched from a branch — a container clones dotfiles master
at boot, and master does not carry this branch's code yet. Two steps therefore ran
differently from a container:

- `gh` install was skipped (`BOOTSTRAP_SKIP_GH=1`): the tarball is a `linux_amd64`
  binary and would not execute here. The `gh 2.96.0` line above is the ambient desktop
  gh, resolved from `command -v gh` and recorded in the marker. In a container the
  ambient gh IS the tarball install (the previous claude-dotfiles hook proved
  `gh 2.86.0` installs cleanly, cse_014KM9VnjCoAR3CTZ8BgXfq3 on 2026-09-14; folded
  into this hook unchanged).
- `curl` download did not run for the same reason. Everything downstream — payload
  copy, hook merge, marker write, additionalContext emission, session-check STOP —
  is identical to what a container runs.

## The two probes named in the ticket

Both are inherently delivery-stage — they need a real cloud container that clones
master, i.e. this PR merged first — and are excluded from this ticket's build stage
by the workflow rules ("Acceptance criteria that describe delivery-stage steps ... are
out of scope for you"). They stand for the deliver stage:

- `mcp__github__merge_pull_request` from a container on a throwaway PR — opens a PR,
  which the branch-work rails forbid (`NEVER open a PR`).
- Prompt-free run of the fleet's command inventory in auto mode with the #205 allow
  list — requires a real container starting a real session; a container spawn is a
  claude.ai/code action taken by the owner, not something a branch can invoke.

Both were resolved by the settings shipped in #205 (auto mode + `autoMode.allow` prose
rule) and by the fleet-as-plugin cut in #196; nothing about this ticket changes their
answer, and rerunning them from a branch would only produce the same simulation this
document already captures.

## Follow-ups (self-contained, not blocking this ticket)

- Delivery-stage: land a Routine-launched or Owner-launched cloud session on
  aac-routines that quotes `gh --version` (container's `2.86.0`) plus a fresh
  `gh api repos/surreptakos/aac-routines` payload plus one merge_pull_request through
  the GitHub MCP.
- Follow-up: the project-harness skill's cloud-bootstrap step — copy this hook and
  wire it into `.claude/settings.json` in every AAC repo the way the tracker-audit
  and dashboard templates are already delivered. Spec #207 already reserves that
  ticket for decomposition; this note is a pointer only.
