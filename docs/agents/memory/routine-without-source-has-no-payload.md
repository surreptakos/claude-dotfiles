---
name: routine-without-source-has-no-payload
description: A Routine-fired session with no source repo gets no aac payload at all; one curl of the public bootstrap hook self-heals it
metadata:
  node_type: memory
  type: environment
  originSessionId: e4289ab4-0af8-5610-95e7-b20efc492296
  modified: 2026-09-22T10:30:00.000Z
---

A Routine created from inside a session carries no source repo, and a session it fires gets **no payload at all** — not an older one. Measured 2026-09-22 by firing one and having it report through the Todoist REST API, the only egress a bare container has:

```
ROUTINE PROBE: declaration=refused payload=none match=no seat=absent skills=2 stopslop=0 pylons=no
```

`~/.claude/hooks` did not exist, nor `~/.claude/settings.json`; `~/.claude/skills` held two entries; `session-check/check.js` was `MODULE_NOT_FOUND`; neither the response-prefix directive nor the environment-claims sentence was in its context.

**Why:** `mcp__Claude_Code_Remote__create_trigger` has no `sources` field, so the repo-anchored `bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh"` entry has no file to run. The v31 home seat at `~/.claude/hooks/aac-bootstrap.sh` is written by that same hook, so a container where it never ran has neither.

**Self-heal, no credential needed** (the repo is public since 2026-09-21):

```bash
curl -fsSL https://raw.githubusercontent.com/surreptakos/claude-dotfiles/master/.claude/hooks/session-start.sh -o /tmp/aac-bootstrap.sh && bash /tmp/aac-bootstrap.sh
```

Verified from a bare `HOME` with no project dir: 54 skills, `payload matches dotfiles master`, four stopslop entries in the merged settings, and the home seat left behind for later sessions in that container.

**How to apply:** a Routine that must run with AAC governance is created in the Routines UI or through the HTTP API **with a source repo**. When one must be minted from a session, put the self-heal line first in its prompt. The `master-*` Routines were created through the HTTP API with checkouts, so they bootstrap normally. Related: [[cloud-home-snapshot]], [[dotfiles-public-for-cloud-clone]].
