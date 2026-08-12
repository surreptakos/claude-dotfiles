---
name: subagent-model-sonnet
description: "Spawn orchestration subagents with Sonnet, not Opus"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 96518c0d-fd59-4461-9bb6-8cec4b9d569a
---

When orchestrating this build with the Agent tool, spawn subagents with `model: "sonnet"`, not Opus.

**Why:** Dan directed this during the deal-rot build (2026-07-17) — Opus subagents cost too much for the fan-out work.

**How to apply:** Pass `model: "sonnet"` on every Agent call (builders, code-review axes, verifiers). The orchestrator/main loop can stay on its default model. /caveman and /yes discipline apply throughout.
