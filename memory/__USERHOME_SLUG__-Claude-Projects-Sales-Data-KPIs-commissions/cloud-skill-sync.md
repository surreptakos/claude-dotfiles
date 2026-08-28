---
name: cloud-skill-sync
description: All personal skills reach Claude Code cloud containers via claude.ai uploaded plugins; rebuild with claude-dotfiles tools/build-cloud-plugin.py and re-upload after skill edits
metadata: 
  node_type: memory
  type: project
  originSessionId: 5d8598f1-43a2-4861-9dcf-7ee7aed4fda3
  modified: 2026-08-28T16:49:33.787Z
---

Claude Code cloud containers (claude.ai/code, Cowork) never read this machine's `~/.claude` — no dotfiles support, user-scope plugin installs don't transfer. Only account-wide mechanism: **plugins enabled on the claude.ai account sync into every cloud session** as `<name>@synced`, any repo. (Synced plugins do NOT load in local terminal sessions; synced skills load locally only via `CLAUDE_CODE_SYNC_SKILLS=1`.)

Done 2026-08-28 — three plugins uploaded + enabled on Dan's claude.ai account (Customize → Plugins → Add → Upload plugin), verified by screenshot:
- **dan-skills** — all personal `~/.claude/skills` packaged by `tools/build-cloud-plugin.py` in the claude-dotfiles repo (commit `456a7b3`). Output `dist/dan-skills.zip`, `dist/` gitignored.
- **caveman** — repacked from plugin cache minus `bin/` (validator rejects top-level `bin/`).
- **i-have-adhd** — repacked from plugin cache as-is.

**claude.ai upload validator rules** (hit all three empirically):
1. SKILL.md frontmatter: ONLY `name, description, allowed-tools, license, metadata, compatibility`. Build script moves the rest (`disable-model-invocation`, `argument-hint`, `hidden`) under `metadata:` as strings.
2. Descriptions may not contain XML tags — script strips angle brackets, keeps tag name.
3. Zip may not ship top-level `bin/` ("claude.ai-hosted plugins may not ship bin/ executables").

**Refresh workflow (skills changed = cloud copy stale):** `py -3 tools/build-cloud-plugin.py` in claude-dotfiles, then claude.ai → Customize → Plugins → delete dan-skills → re-upload `dist/dan-skills.zip`. claude.ai stores a snapshot; local edits never propagate on their own.

Caveats: cloud sessions lack Dan's hooks and global CLAUDE.md, so `disable-model-invocation` semantics are advisory-only there (moved under metadata). Headless `claude -p` auth still dead (see [[sheet-rest-api-access]] pattern — re-check before relying). Local skill junction quirk: some `~/.claude/skills` junctions read empty; script falls back to `~/.agents/skills/<name>`.

Related: [[claude-dotfiles]].
