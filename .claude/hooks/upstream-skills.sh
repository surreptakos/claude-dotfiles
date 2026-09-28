#!/bin/bash
# Cloud-container SessionStart: the skills of the third-party plugins .claude/settings.json
# enables (i-have-adhd@i-have-adhd, typesafe@typesafe-ai). A container sets
# SKIP_PLUGIN_MARKETPLACE=true and clones no third-party marketplace, so enabledPlugins alone
# installs nothing from them (observed 2026-09-28: only claude-plugins-official reached the plugin
# cache). caveman has its own hook (caveman-bootstrap.sh); this covers the rest the same way.
#
# Each repo is shallow-cloned at its default branch HEAD, so a session gets the current upstream
# text, and every skills/<name>/ carrying a SKILL.md is copied to ~/.claude/skills/<name>/. A
# failed clone copies nothing and leaves the previous copies in place. Never fails the session.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

SKILLS_DIR="${UPSTREAM_SKILLS_HOME:-$HOME}/.claude/skills"
REPOS="${UPSTREAM_SKILLS_REPOS:-https://github.com/ayghri/i-have-adhd.git https://github.com/typesafe-ai/skills.git}"
mkdir -p "$SKILLS_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for repo in $REPOS; do
  dest="$tmp/$(basename "$repo" .git)"
  if ! git clone -q --depth 1 "$repo" "$dest" 2>/dev/null; then
    echo "upstream-skills: clone of $repo failed; previous copies kept" >&2
    continue
  fi
  for dir in "$dest"/skills/*/; do
    [ -f "$dir/SKILL.md" ] || continue
    name="$(basename "$dir")"
    rm -rf "$SKILLS_DIR/$name"
    cp -R "$dir" "$SKILLS_DIR/$name"
  done
done
exit 0
