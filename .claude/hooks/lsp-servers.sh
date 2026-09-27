#!/bin/bash
# Cloud-container SessionStart: the language-server binaries that the pyright-lsp and
# typescript-lsp plugins (.claude/settings.json enabledPlugins) launch. The plugins carry only the
# server config, not the binary. The claude.ai/code image ships pyright-langserver but not
# typescript-language-server, so without this the TypeScript plugin has nothing to start.
#
# Installs the current npm release into ~/.local, whose bin/ is on the Claude Code process PATH
# in a container. Skipped per binary when it is already on PATH. Never fails the session.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

pkgs=()
command -v typescript-language-server >/dev/null 2>&1 || pkgs+=(typescript-language-server@latest typescript@latest)
command -v pyright-langserver >/dev/null 2>&1 || pkgs+=(pyright@latest)
[ "${#pkgs[@]}" -eq 0 ] && exit 0

if ! npm install -g --prefix "$HOME/.local" --no-fund --no-audit "${pkgs[@]}" >/dev/null 2>&1; then
  echo "lsp-servers: npm install of ${pkgs[*]} failed" >&2
fi
exit 0
