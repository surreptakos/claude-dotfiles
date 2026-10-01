#!/bin/bash
# Cloud-container SessionStart: the third-party plugins .claude/settings.json enables
# (i-have-adhd@i-have-adhd, typesafe@typesafe-ai, travel-hacker@borski). A container sets
# SKIP_PLUGIN_MARKETPLACE=true and clones no third-party marketplace, so enabledPlugins alone
# installs nothing from them (observed 2026-09-28: only claude-plugins-official reached the plugin
# cache). caveman has its own hook (caveman-bootstrap.sh); this covers the rest the same way.
#
# Each repo is shallow-cloned at its default branch HEAD, so a session gets the current upstream
# text, and what a plugin install would have registered is copied by hand:
#   - every skills/<name>/ carrying a SKILL.md goes to ~/.claude/skills/<name>/; a copy under
#     plugins/*/skills/<name>/ wins over the root one, because the travel-hacking-toolkit keeps
#     its scripted skills there and its root skills/ tree holds SKILL.md only (2026-09-29);
#   - agents/*.md go to ~/.claude/agents/;
#   - the servers of a root .mcp.json are merged into the user-scope mcpServers of
#     ~/.claude.json, never overwriting a server already registered there. A `${VAR}` in a
#     header stays verbatim: Claude Code expands it at launch from the session environment,
#     which is where the API keys such a server needs must be set (the claude.ai environment
#     variables for a container; never this repo).
# A failed clone copies nothing and leaves the previous copies in place. Never fails the session.
#
# Second source (2026-10-01): the upstream-subset plugins of this repo's own marketplace. Since the
# verbatim copies left aac-skills/, .claude-plugin/marketplace.json (generated from UPSTREAM_PLUGINS
# in tools/build-cloud-plugin.py) carries entries whose `source` is an upstream git repo and whose
# `skills` list names the directories to load (mattpocock-skills, vercel-agent-skills, agent-browser,
# find-skills). A desktop installs those from the marketplace; a container cannot, so the same
# entries drive a clone here, and ONLY the listed directories are copied: the rest of each upstream
# tree (writing-guidelines, the mattpocock skills the AAC payload edits) stays out, so no upstream
# copy lands beside the aac-skills copy of the same name.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

UPSTREAM_HOME="${UPSTREAM_SKILLS_HOME:-$HOME}"
SKILLS_DIR="$UPSTREAM_HOME/.claude/skills"
AGENTS_DIR="$UPSTREAM_HOME/.claude/agents"
USER_CONFIG="$UPSTREAM_HOME/.claude.json"
REPOS="${UPSTREAM_SKILLS_REPOS:-https://github.com/ayghri/i-have-adhd.git https://github.com/typesafe-ai/skills.git https://github.com/borski/travel-hacking-toolkit.git}"
MARKETPLACE="${UPSTREAM_SKILLS_MARKETPLACE:-${CLAUDE_PROJECT_DIR:-.}/.claude-plugin/marketplace.json}"
mkdir -p "$SKILLS_DIR" "$AGENTS_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

copy_skill() {
  local dir="$1" name
  [ -f "$dir/SKILL.md" ] || return 0
  name="$(basename "$dir")"
  rm -rf "$SKILLS_DIR/$name"
  cp -R "$dir" "$SKILLS_DIR/$name"
}

merge_mcp() {
  # $1: the clone's .mcp.json. Adds each server absent from ~/.claude.json's mcpServers.
  [ -f "$1" ] || return 0
  command -v node >/dev/null 2>&1 || { echo "upstream-skills: node missing; MCP servers of $2 not registered" >&2; return 0; }
  node - "$USER_CONFIG" "$1" <<'EOF' || echo "upstream-skills: could not merge MCP servers of $2" >&2
const fs = require('fs');
const [cfgPath, mcpPath] = process.argv.slice(2);
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { if (fs.existsSync(cfgPath)) throw e; }
const incoming = (JSON.parse(fs.readFileSync(mcpPath, 'utf8')) || {}).mcpServers || {};
const have = cfg.mcpServers || {};
let changed = false;
for (const [name, server] of Object.entries(incoming)) {
  if (name in have) continue;
  have[name] = server;
  changed = true;
}
if (!changed) process.exit(0);
cfg.mcpServers = have;
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
EOF
}

for repo in $REPOS; do
  dest="$tmp/$(basename "$repo" .git)"
  if ! git clone -q --depth 1 "$repo" "$dest" 2>/dev/null; then
    echo "upstream-skills: clone of $repo failed; previous copies kept" >&2
    continue
  fi
  for dir in "$dest"/skills/*/; do copy_skill "$dir"; done
  for dir in "$dest"/plugins/*/skills/*/; do copy_skill "$dir"; done
  for agent in "$dest"/agents/*.md; do
    [ -f "$agent" ] && cp "$agent" "$AGENTS_DIR/$(basename "$agent")"
  done
  merge_mcp "$dest/.mcp.json" "$repo"
done

# Marketplace entries with an upstream git source: one line per entry, "<url> <ref> <path> <skills...>".
if [ -f "$MARKETPLACE" ] && command -v node >/dev/null 2>&1; then
  node - "$MARKETPLACE" <<'EOF' 2>/dev/null | while read -r url ref subdir skills; do
const fs = require('fs');
const m = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const p of m.plugins || []) {
  const s = p.source;
  if (!s || typeof s !== 'object' || !s.url || !Array.isArray(p.skills) || !p.skills.length) continue;
  console.log([s.url, s.ref || 'main', s.path || '.', ...p.skills.map((k) => k.replace(/^\.\//, ''))].join(' '));
}
EOF
    [ -n "$url" ] || continue
    dest="$tmp/mkt-$(basename "$url" .git)"
    rm -rf "$dest"
    if ! git clone -q --depth 1 --branch "$ref" "$url" "$dest" 2>/dev/null; then
      echo "upstream-skills: clone of $url failed; previous copies kept" >&2
      continue
    fi
    for skill in $skills; do
      if [ -f "$dest/$subdir/$skill/SKILL.md" ]; then
        copy_skill "$dest/$subdir/$skill"
      else
        echo "upstream-skills: $url has no $subdir/$skill/SKILL.md; skipped" >&2
      fi
    done
  done
fi
exit 0
