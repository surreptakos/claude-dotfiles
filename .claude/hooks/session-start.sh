#!/bin/bash
# SessionStart hook for Claude Code on the web (claude.ai/code containers).
# A local session exits immediately: everything below already exists on the owner's machine.
#
# What a cloud container lacks that a local session has, and what this does about it:
#   - gh: not installed, but GH_TOKEN is injected and github.com is reachable, so the release
#     tarball installs cleanly. Only `gh api` (REST) works through the cloud proxy; the
#     GraphQL-backed commands (gh issue list, gh pr list, gh repo view --json) return 403.
#     Scripts that must run in both places call `gh api repos/...` (issue 130).
#   - pyyaml: the packager and tools/skill-stamps.py import it. Usually present; pip is the fallback.
# PowerShell is deliberately not installed: tests/restore-test.ps1 and sync.ps1 are Windows-only
# (junctions, C:\ paths, the py launcher) and CI's Windows runner covers them on every push.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

GH_VERSION="2.86.0"
BIN_DIR="${HOME}/.local/bin"
mkdir -p "$BIN_DIR"

if ! command -v gh >/dev/null 2>&1 && [ ! -x "$BIN_DIR/gh" ]; then
  tmp="$(mktemp -d)"
  curl -sSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C "$tmp"
  install -m 0755 "$tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$BIN_DIR/gh"
  rm -rf "$tmp"
fi

# Make it reachable for the rest of the session. The hook's own PATH change dies with the hook;
# CLAUDE_ENV_FILE is what the harness sources for later commands.
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) if [ -n "${CLAUDE_ENV_FILE:-}" ]; then echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$CLAUDE_ENV_FILE"; fi ;;
esac

python3 -c "import yaml" 2>/dev/null || pip install --quiet pyyaml

gh_bin="$(command -v gh 2>/dev/null || echo "$BIN_DIR/gh")"
echo "session-start: $("$gh_bin" --version | head -1) ready; GraphQL is blocked in this container, use gh api"
