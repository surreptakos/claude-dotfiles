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

**Account split (learned 2026-08-28, the hard way):** Dan's cloud Claude Code runs under
**djgatsakos@gmail.com**, a different login from the `dgatsakos@activealarm.com` session Chrome is
signed into. That Chrome login holds two workspaces — Active Alarm (team) and a personal one — and
the three plugins below went to the **team** workspace, so they reach Cowork there, NOT his cloud
Claude Code. Browser automation cannot reach the gmail account (no session, and signing in is not
ours to do), so the working handoff is: build the zip, `SendUserFile` it, Dan uploads. Stamp the
sweep only after he confirms it landed.

Done 2026-08-28 — three plugins uploaded + enabled on the Active Alarm team workspace (Customize → Plugins → Add → Upload plugin), verified by screenshot:
- **dan-skills** — all personal `~/.claude/skills` packaged by `tools/build-cloud-plugin.py` in the claude-dotfiles repo (commit `456a7b3`). Output `dist/dan-skills.zip`, `dist/` gitignored.
- **caveman** — repacked from plugin cache minus `bin/` (validator rejects top-level `bin/`).
- **i-have-adhd** — repacked from plugin cache as-is.

**claude.ai upload validator rules** (hit all three empirically):
1. SKILL.md frontmatter: ONLY `name, description, allowed-tools, license, metadata, compatibility`. Build script moves the rest (`disable-model-invocation`, `argument-hint`, `hidden`) under `metadata:` as strings.
2. Descriptions may not contain XML tags — script strips angle brackets, keeps tag name.
3. Zip may not ship top-level `bin/` ("claude.ai-hosted plugins may not ship bin/ executables").

**Invoking them in a cloud session** (docs, plugins-reference#synced-plugins): the command is
namespaced, `/dan-skills:session-start`; bare `/session-start` works only when nothing else owns the
name. Account plugin changes reach only sessions started AFTER the change — an already-running cloud
session answers `Unknown command`. Packaged bodies are path-retargeted by the builder: any
`~/.claude/skills/...` or `~/.claude/hooks/session-gate.js report` becomes
`${CLAUDE_PLUGIN_ROOT}/skills/session-check/check.js`, since a container has neither this machine's
hooks nor its skills tree (commit `4e30620`).

**Drift detector:** `~/.claude/skills/session-check/cloud-plugin-sweep.js` hashes every file the
packager would ship plus the packager itself against `~/.claude/hook-state/cloud-plugin/state.json`;
`/session-end` prints it (exit 0 in sync / 1 drift or never uploaded / 2 could not check). The
`/update-cloud-plugin` skill is the fix loop.

**Refresh workflow (skills changed = cloud copy stale):** `py -3 tools/build-cloud-plugin.py` in claude-dotfiles, then claude.ai → Customize → Plugins → delete dan-skills → re-upload `dist/dan-skills.zip`. claude.ai stores a snapshot; local edits never propagate on their own.

Caveats: cloud sessions lack Dan's hooks and global CLAUDE.md, so `disable-model-invocation` semantics are advisory-only there (moved under metadata). Headless `claude -p` auth still dead (see [[sheet-rest-api-access]] pattern — re-check before relying). Local skill junction quirk: some `~/.claude/skills` junctions read empty; script falls back to `~/.agents/skills/<name>`.

Related: [[claude-dotfiles]].
