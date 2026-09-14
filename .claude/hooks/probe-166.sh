#!/usr/bin/env bash
set -u

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
    exit 0
fi

mkdir -p "$HOME/.claude/hook-state"
echo "hook-wrote session=${CLAUDE_CODE_REMOTE_SESSION_ID:-none} at=$(date -u +%FT%TZ)" >> "$HOME/.claude/hook-state/probe-166-hook.txt"
echo "probe-166: hook-state file now has $(wc -l < "$HOME/.claude/hook-state/probe-166-hook.txt") line(s); prior marker: $(cat "$HOME/.claude/hook-state/probe-166.txt" 2>/dev/null || echo absent)"
exit 0
