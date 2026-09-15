---
name: agent-remote-isolation-runs-locally
description: "Agent tool isolation \"remote\" ran on the Windows desktop with the live home, not in a claude.ai/code container (2026-09-14); it can write ~/.claude"
metadata: 
  node_type: memory
  type: project
  originSessionId: 93aaa95e-d6c0-43fe-a591-75b0e6b0e319
  modified: 2026-09-14T20:31:46.579Z
---

On 2026-09-14 a desktop-app session launched two Agent calls with `isolation: "remote"` for cloud
probes (#166 items 1 to 4, then #175). Both executed on Dan-Inspiron15: the #175 agent quoted
Windows clone timings, hit the scratchpad `Filename too long` limit, and wrote then byte-restored
the live `~/.claude/settings.json`. No cloud container was involved. `ToolSearch` found no
session-creating tool, and `claude --cloud` refused to combine with `--print` or `--bg`.

**Why:** a probe that must run inside a claude.ai/code container cannot be delegated from the
desktop this way; the agent also treats the live home as scratch, the same hazard as
[[fleet-implementers-edit-the-live-tree]].

**How to apply:** cloud-only probes go to a claude.ai/code session started by Dan (or a Routine
with the repo as source). Never hand a remote-isolation agent a task that writes under `~/.claude`.
Re-test before relying on this note; a later CLI may change what "remote" does.
