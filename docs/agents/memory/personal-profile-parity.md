---
name: personal-profile-parity
description: "~/.claude-personal parity is automated: sync.ps1 pull ends with Update-PersonalProfile (lib/personal.ps1). Reverse memory sync declined by default. Profile-aware hook contract keeps the two accounts separate."
metadata: 
  node_type: memory
  type: project
  originSessionId: fdad46d0-30d3-4f45-b4db-1391b3a33cfc
  modified: 2026-08-20T01:24:28.560Z
---

PARITY IS NOW AUTOMATED (issue #9, 2026-08-19): `sync.ps1 -Mode pull` ends with
`Update-PersonalProfile` (`lib/personal.ps1`), a one-way overlay from `~/.claude` onto
`~/.claude-personal` — hooks/CLAUDE.md/agents verbatim, skill junctions + real dirs, settings.json
HOOKS KEY ONLY with the `\.claude\` → `\.claude-personal\` rewrite (personal prefs preserved),
project memories union-merged (newer mtime wins, MEMORY.md unioned by pointer-line target,
personal-only files never deleted). Idempotent; overwrites are backed up to
`~/.claude-personal-refresh-backup-<stamp>`; a machine without the profile is skipped, never
created. The restore test seeds a fake personal profile and asserts all of this (checks 29 total).
The manual procedure below is history, kept for the how and the why.

REVERSE MEMORY SYNC: DECLINED BY DEFAULT 2026-08-19 (issue #9 decision b, privacy-preserving).
The 31 personal-only memories (aac-cockpit 26, task-management 4, bill-intake 1) never flow into
the work profile or the claude-dotfiles repo — push reads only `~/.claude`. Flipping this requires
an explicit owner instruction.

`~/.claude-personal` (djgatsakos@gmail.com, launched via the `claude-personal` shim) was a stale
2026-08-02 snapshot: no session-gate/state-stash/state-rehydrate hooks, no hook wiring in
settings.json beyond governance-reminder, pre-lint CLAUDE.md, drifting skill copies. Root cause of
the missing state hooks: they were never tracked in claude-dotfiles — fixed in commit 5bec0bd.

Parity procedure (2026-08-19): copy hooks + CLAUDE.md + agents verbatim; recreate the 28 skill
junctions pointing at the machine-wide `~/.agents/skills`; robocopy /MIR the real skill dirs; merge
settings.json by replacing only the `hooks` key with the work profile's, rewriting `\.claude\` to
`\.claude-personal\` in hook-file paths (`.codex` paths untouched) and keeping every personal pref
(model, fastMode, plugins, statusLine). Backup at `~/.claude-personal-backup-20260819-parity`.

`state-stash.js`, `state-rehydrate.js` and `session-gate.js` are now profile-aware: they derive
state dirs, the miner's `.credentials.json` and the check-script path from `CLAUDE_CONFIG_DIR` when
set, falling back to `~/.claude`. Without this, a personal-profile session-end mined its digest with
WORK credentials. Any new hook that touches profile state must follow the same
`process.env.CLAUDE_CONFIG_DIR || ~/.claude` pattern.

Work project memories now DO flow into the personal profile (issue #9 decision a superseded the
earlier hold-off): the union merge above copies them in on every pull. What stays out, per
decision b, is the reverse direction — personal-session content never enters the work account's
context. See also [[two-claude-profiles-work-and-personal]].
