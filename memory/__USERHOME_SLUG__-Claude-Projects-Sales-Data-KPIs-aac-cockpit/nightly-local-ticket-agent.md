---
name: nightly-local-ticket-agent
description: "Windows Task Scheduler task \"AAC nightly ticket agent\" runs headless claude -p nightly at 11:05pm CT on ready-for-agent+backend tickets; cloud routine trig_01WoV66mpZFy3Wf3Z4MvGpuz exists but is disabled."
metadata: 
  node_type: memory
  type: project
  originSessionId: caed4690-20fa-4c8b-871e-797bc5542b44
  modified: 2026-08-18T15:00:39.434Z
---

Set up 2026-08-18. Local nightly autonomous ticket agent:

- **Task Scheduler task** "AAC nightly ticket agent", daily 23:05 local, WakeToRun, 6h execution limit. Runs only while Dan is logged in (locked screen OK).
- **Files:** `__USERHOME__\.claude\nightly-aac-agent\` — `prompt.md` (agent instructions), `run-nightly.ps1` (runner), `token.txt` (long-lived `sk-ant-oat01` token from `claude setup-token`, ~1yr; runner exports it as `CLAUDE_CODE_OAUTH_TOKEN`), `logs\run-<stamp>.json` per run.
- **Behavior (rewritten 2026-08-18 per Dan's orchestrator contract):** prompt.md is now an ORCHESTRATOR brief. Orchestrator runs Fable 5 (`claude-fable-5`, runner default); it spawns one Opus 4.7 sub-session per ticket via `cat .agent-prompt.md | claude -p --model claude-opus-4-7 --dangerously-skip-permissions --strict-mcp-config --output-format json` inside a per-ticket worktree (Agent-tool `opus` alias = Opus 5, can't pin 4.7, so CLI is the only path). Full autonomy contract: two stop states (complete success verified / proven impossible), force-it, test-before-conclude, no proxies. Tools it's told to use for VERIFICATION: SA JWT REST, `clasp run`/`pull`/`logs`, out-of-band `doPost` dispatcher (build/use/remove, never commit, secret never in git), Outlook/Gmail read.
- **Discovered issues (Dan, 2026-08-18):** overnight agent never creates chips or new GitHub issues for out-of-scope findings — appends self-contained entries to `nightly-aac-agent\FOLLOW-UPS.md` (append-only, per-run heading); Dan reviews then runs /to-tickets on it.
- **Hard rail (amended by Dan, 2026-08-18, #485):** the agent MAY merge its own PRs to `main` (`gh pr merge --squash --delete-branch`, only after its own verification pass; merge = TEST deploy only). Still never push `main` directly, never deploy prod (CI promote.yml Thursday + Mon-Wed freeze owns prod). clasp allowed for verification only, not `deploy`/`push`. Only `ready-for-agent`+`backend`, dependency order, never generated files. Token exposure from the 2026-08-18 transcript: Dan accepted it, no rotation (#486).
- **Verified headless:** fable-5 exit 0, opus-4-7 exit 0 with the shared token. Headless runs still fire Dan's global CLAUDE.md + settings.json hooks (pylon prefix, governance) — non-blocking (exit 0).
- **Cloud twin:** routine `trig_01WoV66mpZFy3Wf3Z4MvGpuz` ("Nightly ticket agent — aac-cockpit", cron `0 4 * * *` UTC) created same day, now `enabled: false`. Fallback if PC won't be on — re-enable at https://claude.ai/code/routines/trig_01WoV66mpZFy3Wf3Z4MvGpuz, but disable one of the two: both fire ~11pm CT and would duplicate PRs.
- **Gotchas learned:** stored CLI OAuth credential (`~/.claude/.credentials.json`) died with `expiresAt: 0` and could not refresh while desktop app kept working — desktop and CLI auth are separate. `claude setup-token` prints its token only in a real interactive terminal, after browser approval, and saves it nowhere. First `token.txt` paste was corrupted (wrong from char 14); a 401 from a hand-pasted token means diff the file against the source before re-running the flow. Dan's token from this setup is exposed in the 2026-08-18 session transcript — rotation is his call.

Related: [[subagent-model-sonnet]] (agent runs claude-sonnet-5), [[prod-freeze-thursday-promote]] (merged PRs still only ship TEST until Thursday promote).
