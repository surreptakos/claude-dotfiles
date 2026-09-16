#!/bin/bash
# UserPromptSubmit half of the cloud caveman install (see caveman-bootstrap.sh).
#
# The caveman plugin registers two hooks: caveman-activate.js on SessionStart (the bootstrap runs
# it and forwards its text) and caveman-mode-tracker.js on UserPromptSubmit, which is what makes
# `/caveman lite|ultra|off`, "stop caveman" and "normal mode" take effect and re-injects the
# ruleset on each turn. `caveman enable claude` wires the CLI's native hooks, not this one, so the
# project settings carry it. Local sessions have the plugin itself: exit 0, print nothing.
set -uo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
TRACKER="${CAVEMAN_BOOTSTRAP_HOME:-$HOME}/.aac-caveman/src/hooks/caveman-mode-tracker.js"
if [ -n "${CAVEMAN_BOOTSTRAP_SOURCE:-}" ]; then
  TRACKER="$CAVEMAN_BOOTSTRAP_SOURCE/src/hooks/caveman-mode-tracker.js"
fi
if [ ! -f "$TRACKER" ]; then
  # First prompt of a session whose bootstrap has not finished (or failed): stay silent rather
  # than block the prompt. The bootstrap's own context line names the failure.
  exit 0
fi
if [ -n "${CAVEMAN_BOOTSTRAP_HOME:-}" ]; then
  export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$CAVEMAN_BOOTSTRAP_HOME/.claude}"
fi
exec node "$TRACKER"
