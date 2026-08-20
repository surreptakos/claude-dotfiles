---
name: workflow-model-pinning
description: "Workflow tool agent() opts.model accepts full model IDs (verified claude-opus-4-7), unlike Agent tool's alias-only enum"
metadata: 
  node_type: memory
  type: reference
  originSessionId: da8b7c49-ed34-48c5-957e-60fc1ef8b28a
  modified: 2026-08-20T01:05:32.855Z
---

Workflow tool `agent()` `opts.model` accepts full model IDs and actually serves them — verified 2026-08-19, run `wf_ebb5f702-08c`: agent with `model: 'claude-opus-4-7'` ran on `claude-opus-4-7`, control with `model: 'opus'` ran on `claude-opus-5` (both confirmed via `"model":` field in agent transcript jsonl, not just self-report).

**Why:** global CLAUDE.md says in-session model pinning is impossible (Agent tool enum rejects full IDs) and headless CLI is the only path. Workflow is a second, in-session path.

**How to apply:** for interactive multi-agent work needing a pinned version, use Workflow with `opts.model: '<full-id>'`. Headless `claude -p --model <full-id>` remains the path for unattended/overnight runs. Agent tool `model` param stays alias-only.
