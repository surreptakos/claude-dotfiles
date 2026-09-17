---
name: cloud-routine-facts-2026-09-17
description: "Verified facts about claude.ai/code routines as a runner for aac-routines; env vars unsupported, Drive read and write via proxy, no gate in cloud, Todoist REST needs a token from somewhere"
metadata: 
  node_type: memory
  type: project
  originSessionId: d1a0f4fb-01c4-43c3-b5e6-7cf5abe3d300
  modified: 2026-09-17T19:13:42.893Z
---

Probed 2026-09-17 with a one-shot routine (trig_01TJdc8GDXyufEvqyWJxJRL4, disabled after; delete at claude.ai/code/routines) in environment env_01Xfr1nCKjpSdLDytywjDAR3, source aac-routines only:

- Routines cannot carry environment variables. API rejects them: "job_config.ccr.session_context.environment_variables is not supported on triggers". Container has zero AAC_ or TODOIST vars.
- Google Drive through the agent proxy needs no credential: files list 200, files create 200, files delete 204. State files on Drive work from a routine.
- Todoist REST reachable, unauthenticated: 401 on GET, 403 on sync POST. A token must arrive some other way (environment API credential if the UI allows that host, or a file read from Drive).
- No plugins installed in the container (`plugins: {}`), no ~/.claude/hooks, so the aac-skills governance gate does not run there. Repo-level hooks of any source checkout do run; claude-dotfiles as a source brings its caveman-bootstrap SessionStart hook (landed 2026-09-16 21:54Z).
- Python 3.11, no google or docx modules preinstalled, no gh binary.
- A real routine already exists: "Todoist Triage Routine Dan-AAC" trig_01WgTYXvzFQQUFGFZgKQAa5m, weekdays 13:00 UTC, claude-opus-5, sources aac-routines plus claude-dotfiles, 13 connectors. 2026-09-15 run succeeded end to end including MCP writes after Dan replied in-session. 2026-09-16 hit the weekly usage limit. 2026-09-17 died at init with "API Error: Connection refused" twice; the aac-routines-only probe at 19:09Z reached the API fine.
- Locally, the desktop host sets ANTHROPIC_BASE_URL=https://api.anthropic.com in the process env; ~/.claude/settings.json's 127.0.0.1:8787 proxy value does not apply to desktop sessions.

**Why:** these settled the "can it be a Claude routine" question after three rounds of speculation.

**How to apply:** design cloud routines around proxy-authenticated Drive for state, a token delivery path for Todoist REST, and no reliance on env vars. See [[aacx-record-corrections]].
