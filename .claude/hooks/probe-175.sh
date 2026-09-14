#!/usr/bin/env bash
# Probe for issue 175: does a SessionStart hook's write into ~/.claude reach the
# same session? Cloud containers only (CLAUDE_CODE_REMOTE=true) so a desktop
# checkout of this branch never touches the live ~/.claude. Evidence goes to
# ~/.claude/probe-175.log and to the SessionStart additionalContext channel.
set -u
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

LOG="$HOME/.claude/probe-175.log"
mkdir -p "$HOME/.claude/skills/probe-skill"
echo "$(date -u +%FT%TZ) probe-175 SessionStart hook ran (pid $$) HOME=$HOME" >> "$LOG"

# 1. skill
cat > "$HOME/.claude/skills/probe-skill/SKILL.md" <<'EOF'
---
name: probe-skill
description: Probe skill 175, reply PROBE-175-SKILL-LOADED when invoked
---

Reply with the exact text PROBE-175-SKILL-LOADED and nothing else.
EOF
echo "skill: $(ls -l "$HOME/.claude/skills/probe-skill/SKILL.md")" >> "$LOG"

# 2. user-level settings.json with one UserPromptSubmit hook that emits a marker
#    and logs each firing, so "ran but was not shown" is distinguishable from "never ran".
SETTINGS="$HOME/.claude/settings.json"
[ -f "$SETTINGS" ] && cp "$SETTINGS" "$SETTINGS.bak-175"
python3 - "$SETTINGS" <<'PY'
import json, os, sys
path = sys.argv[1]
try:
    with open(path) as f: s = json.load(f)
except Exception:
    s = {}
cmd = ("echo \"$(date -u +%FT%TZ) probe-175 UserPromptSubmit fired (pid $$)\" >> \"$HOME/.claude/probe-175.log\"; "
       "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"PROBE-175-USER-HOOK-MARKER\"}}'")
s.setdefault("hooks", {}).setdefault("UserPromptSubmit", []).append({"hooks": [{"type": "command", "command": cmd}]})
with open(path, "w") as f: json.dump(s, f, indent=2)
PY
echo "settings.json bytes: $(stat -c %s "$SETTINGS")" >> "$LOG"

# 4. clone + copy timing, in the container
rm -rf /tmp/p175-hook
{ time ( git clone -q --depth 1 https://github.com/surreptakos/claude-dotfiles /tmp/p175-hook/dot-probe \
         && cp -r /tmp/p175-hook/dot-probe/marketplace/aac-skills/skills /tmp/p175-hook/skills ) ; } >> "$LOG" 2>&1
echo "item4 exit: $? ; skills copied: $(ls /tmp/p175-hook/skills 2>/dev/null | wc -l)" >> "$LOG"

# 3. 200-line additionalContext block, first and last lines are markers
python3 - <<'PY'
import json
lines = ["PROBE-175-CTX-START"]
lines += [f"PROBE-175 filler rule {i:03d}: placeholder rules text for the context-size probe." for i in range(1, 199)]
lines.append("PROBE-175-CTX-END")
print(json.dumps({"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "\n".join(lines)}}))
PY
exit 0
