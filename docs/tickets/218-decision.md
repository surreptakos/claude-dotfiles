# Issue 218: the harness delivers the bootstrap hook and the auto-mode posture to any repo

**Status:** built at harness **v27**. One command — project-harness step 16,
`node templates/add-cloud-plugin.js <repo-root>` — now installs the cloud bootstrap hook, wires its
`SessionStart` entry, declares the plugin and merges the auto-mode posture. Idempotent.

## What changed

| Piece | Where |
| --- | --- |
| Hook body, delivered to every repo | `agents/skills/project-harness/templates/session-start.sh` (new) |
| Generator that keeps it honest | `tools/build-harness-bootstrap-hook.js` (new) |
| Delivery | `agents/skills/project-harness/templates/add-cloud-plugin.js` (hook copy + `hooks.SessionStart` merge) |
| Version | `templates/harness-version.md` 26 → 27, upgrade row 27 in `UPGRADES.md`, this repo's marker |
| Tests | `tools/harness-bootstrap-delivery.test.js` (4 cases) |

**The template is a byte-identical copy of `.claude/hooks/session-start.sh`, not a copy with a
banner.** The delivered file *is* the target repo's `.claude/hooks/session-start.sh`, so any
difference would make a re-run in `claude-dotfiles` rewrite its own hook — and "running it again
changes nothing" is the ticket's second criterion. The don't-hand-edit notice therefore lives in
the hook's own header, where it is true in both places the file exists; the generator
(`--check` in CI-shaped use, the test file as the tripwire) is the issue-336 rule applied to a
second file: a copy nobody diffs is eventually wrong.

**Wiring is detected by command path, never by a tag.** `claude-dotfiles`' own `SessionStart` entry
predates this step and carries no tag; a tag-keyed merge would have appended a second entry and
doubled the bootstrap (the issue 166 shape).

## Proof: a scratch clone of an AAC repo

`surreptakos/aac-message-board`, shallow-cloned 2026-09-17, marker at v17, no `.claude/hooks/`,
`.claude/settings.json` holding only `extraKnownMarketplaces` + `enabledPlugins`.

Before, session-check against the v27 skill (criterion 3 — the repo has no bootstrap hook and the
`#139` line is what says so):

```
Harness
  STOP harness v17 is behind v27 — run `/project-harness` (upgrade path, step 7)
      the upgrade table lives in project-harness/SKILL.md ("Upgrading an existing install")
```

Step 16, then the marker bump:

```
bootstrap hook installed: .claude/hooks/session-start.sh
declared aac-skills@claude-dotfiles + posture (issue 245) + the SessionStart bootstrap hook in .claude/settings.json
```

```diff
--- a/.claude/settings.json
+++ b/.claude/settings.json
@@ -9,5 +9,33 @@
   "enabledPlugins": {
     "aac-skills@claude-dotfiles": true
+  },
+  "permissions": {
+    "defaultMode": "auto",
+    "allow": [ "Bash(*)", "Edit", "Write", "mcp__github__*" ]
+  },
+  "autoMode": {
+    "allow": [ "Ruling (Dan, 2026-09-15, issue 245): autoMode.allow is widened to every action an unattended session takes, destructive and irreversible included. ..." ]
+  },
+  "hooks": {
+    "SessionStart": [
+      { "hooks": [ { "type": "command",
+                     "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh",
+                     "timeout": 120,
+                     "statusMessage": "Cloud container: installing the aac-skills payload..." } ] }
+    ]
   }
 }
--- a/docs/agents/harness-version.md
+++ b/docs/agents/harness-version.md
-    harness-version: 17
+    harness-version: 27
```

Plus the untracked `.claude/hooks/session-start.sh`, mode `0755`, SHA-256
`b07344a3a1396265661b998e40fccdbb10f97dcf5a2aa15532c810d38b721ef1` — the same hash as this repo's
own `.claude/hooks/session-start.sh`.

Second run, same clone:

```
already delivered: bootstrap hook + plugin + posture in .claude/settings.json
```

Both files' hashes unchanged, `git status --short` unchanged. And session-check afterwards:

```
Harness
  ok   harness v27, current
```

The delivered copy run as a container would run it (`CLAUDE_CODE_REMOTE=true`, a fake `HOME`,
`BOOTSTRAP_SOURCE` at this branch, `BOOTSTRAP_SKIP_GH=1` because the pinned tarball is a
`linux_amd64` binary and gh is already on this PATH), from the *other* repo's checkout:

```
run 1: AAC-BOOTSTRAP MARKER: payload v2026.9.162252; skills copied=61; ...
run 2: AAC-BOOTSTRAP MARKER: payload v2026.9.162252; skills copied=0; ...
env file: export PATH="<home>/.local/bin:$PATH"   (one line after both runs)
```

## What remains (not this ticket)

The cross-repo container proof of spec #207 — one real claude.ai/code session on a repo other than
`claude-dotfiles` quoting `gh --version` and a `gh api repos/{owner}/{repo}` call — still needs a
container, and a container reads dotfiles **master**, so it can only run once this lands. Same
sequencing the issue 163 decision doc records for its own step 2. The sweep that runs step 16 over
the other seven repos is likewise a cross-repo action, in the cut-over order the spec fixes.
