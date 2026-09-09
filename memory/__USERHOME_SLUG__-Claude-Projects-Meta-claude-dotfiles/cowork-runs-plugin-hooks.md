---
name: cowork-runs-plugin-hooks
description: "Cowork does NOT surface plugin hooks (tested 2026-09-03 with the aac-skills marker hook); neither user-level nor plugin hooks govern it, only instruction text does"
metadata: 
  node_type: memory
  type: project
  originSessionId: 6163f97e-2557-4f4b-a19e-f45845bf9312
  modified: 2026-09-03T23:31:29.454Z
---

Cowork runs the agent in a VM, so nothing wired in `~/.claude/settings.json` or pointing at a Windows
path executes there. Plugin-carried hooks do not reach the model either: on 2026-09-03 the aac-skills
`hooks/hooks.json` SessionStart hook echoed an `AAC-SKILLS HOOK MARKER` sentence with hostname and
UTC timestamp, and a fresh Cowork session that listed the plugin's skills reported no such sentence in
its context. Cowork's own words: "project chats aren't Claude Code sessions, so repo hooks don't run
here." An earlier Cowork session had "quoted" the marker — verbatim from the hook file, with none of
the runtime values — so that was a file read or a fabrication, and the repo README briefly claimed
the opposite on its strength.

**Why:** the whole governance stack (ask-matt gate, YES lint, caveman level) lives in hooks; none of
it can be forced into Cowork. What Cowork does load: the global `~/.claude/CLAUDE.md` (memory docs
say Cowork desktop sessions read it), the plugin's skill descriptions and bodies, and its own memory.

**How to apply:** govern Cowork with text, not hooks — keep the YES and caveman rules in the global
CLAUDE.md and in Cowork memory; do not spend more time on hook ports for that surface. The marker
hook stays in the plugin as a standing probe: if a Cowork session ever quotes it with a host and
timestamp, this note is wrong and the port is back on. Open question: whether the tested Cowork
session ran plugin version 2026.9.31816 or an older build; a version check closes it. Related:
[[marketplace-is-the-distribution-spine]], [[cowork-transcripts-not-local]].
