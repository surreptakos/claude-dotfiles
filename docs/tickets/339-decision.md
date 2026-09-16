# Issue 339: is a SessionStart hook's write to `~/.claude/agents/` visible to that session? — experiment + decision

**Answer: no.** The agent registry is read before `SessionStart` hooks run. A hook that writes
an agent file lands the file on disk, but the session that ran the hook cannot resolve the type;
the next session over the same config dir can.

**Decision:** route 2 of the ticket's disjunctive criterion. The bootstrap hook does **not**
install `claude/agents/`; instead `.claude/hooks/session-start.sh` and
`aac-skills/ticket-fleet/SKILL.md` both state that pinning a dotfiles-defined `agentType` does
not work in a cloud session, and the additionalContext line says so to the model on prompt 1.
Installing the tree would buy a capability that works only from the *second* session onward in a
container — exactly the "looks available and silently is not" state the ticket was filed against.

## The experiment

Run on 2026-09-16 inside a claude.ai/code container (`CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE=cloud_default`,
`Linux 6.18.44-fc-v33 x86_64`), driving the container's own CLI — `claude --version` →
`2.1.273 (Claude Code)` — headless with `CLAUDE_CONFIG_DIR` pointed at a scratch directory, so
nothing touched the live `~/.claude`. Each arm launched:

```
CLAUDE_CONFIG_DIR=<arm>/cfg claude -p \
  "Use the Task tool once with subagent_type set to exp-probe and prompt 'reply PROBE_AGENT_RAN'.
   If that subagent_type is not available, reply with exactly UNRESOLVED followed by the error text.
   Do nothing else." \
  --allowedTools Task --max-turns 4 --output-format json
```

The agent under test, identical in all three arms:

```markdown
---
name: exp-probe
description: experiment probe agent for issue 339
tools: Bash
---
You are the issue-339 probe agent. Reply with exactly: PROBE_AGENT_RAN
```

### Arm A — control: file on disk before the session starts

`cfg/settings.json` is `{}`; `cfg/agents/exp-probe.md` written before launch.

```
--- control: agents dir BEFORE launch:
-rw-r--r-- 1 root root  157 Sep 16 05:31 exp-probe.md
CLAUDE_EXIT=0
--- control: result:
PROBE_AGENT_RAN
```

The type resolves. The file, the config dir and the invocation are good.

### Arm B — the question: a `SessionStart` hook writes the file

`cfg/agents/` empty at launch; `cfg/settings.json`:

```json
{ "hooks": { "SessionStart": [ { "hooks": [ { "type": "command", "command": "bash .../hook/write-agent.sh", "timeout": 10 } ] } ] } }
```

`write-agent.sh` writes the same `exp-probe.md` and prints a `SessionStart` `additionalContext`
line — the shape the AAC bootstrap hook uses.

```
--- hook: agents dir BEFORE launch:
total 8
drwxr-xr-x 2 root root 4096 Sep 16 05:31 .
drwxr-xr-x 3 root root 4096 Sep 16 05:31 ..
CLAUDE_EXIT=0
--- hook: agents dir AFTER:
-rw-r--r-- 1 root root  157 Sep 16 05:31 exp-probe.md
--- hook: result:
UNRESOLVED Agent type 'exp-probe' not found. Available agents: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup
```

The hook ran and the file is on disk when the run ends — and the session that ran the hook still
does not have the type. The available-agents list is the container's built-ins only.

### Arm C — control for the file itself: a second session over arm B's config dir

Nothing rewritten; the same bytes arm B's hook produced are simply already there at launch.

```
--- armC: agents dir BEFORE launch:
-rw-r--r-- 1 root root  157 Sep 16 05:31 exp-probe.md
CLAUDE_EXIT=0
--- armC: result:
PROBE_AGENT_RAN
```

So the hook-written file is well-formed and the config dir is right. Timing is the only variable
between arm B and arm C, which is what makes the answer a timing answer and not a paths answer.

## What changed because of it

- `.claude/hooks/session-start.sh` — header block records the finding and why `claude/agents/`
  is deliberately not delivered; the step-6 `additionalContext` sentence now carries
  `no custom agent types here - pinning a dotfiles-defined agentType does not work in a cloud
  session, the agent registry is read before this hook runs (issue 339)`. Pinned by
  `tools/session-start-hook.test.js`.
- `aac-skills/ticket-fleet/SKILL.md` — section "Custom agent types are desktop-only".
- `aac-skills/ticket-fleet/ticket-fleet.js` — the `fleet-verifier` pin is decided by
  `pickVerifierAgent(remote, agentFilePresent)` from measured facts, not by the tracker
  instrument. Conflating the two is what made issue 316's container, which picked `gh`, try to
  launch a type it could never have had.
- The same run's env probe removes the other half of that workaround: `instrument: 'mcp'` no
  longer has to be passed by hand from a container (issue 322).
