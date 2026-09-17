#!/bin/bash
# Cloud-container bootstrap (SessionStart) for the caveman suite - https://github.com/JuliusBrussee/caveman
#
# The desktop runs caveman as a Claude Code plugin (caveman@caveman in ~/.claude/settings.json) plus
# the @caveman-ai/cli proxy. A cloud container on claude.ai/code has neither: the account-level
# plugin sync installs nothing here (installed_plugins.json stays empty, same as the aac-skills
# marketplace entry - see .claude/settings.json), so the only deterministic path is the same one
# session-start.sh uses for the aac-skills payload: install at SessionStart, every session, pinned.
#
# What this hook delivers, in order (every step idempotent, none may fail the session):
#
#   1. a checkout of JuliusBrussee/caveman at the pinned tag under ~/.aac-caveman - the plugin's own
#      hooks read their skills and agents relative to that tree, so it stays plugin-shaped;
#   2. the "small rock": every skill in the checkout (caveman, caveman-commit, caveman-review,
#      caveman-compress, caveman-stats, caveman-help, cavecrew, caveman-setup/discover/learn/
#      manage/optimize/explore/evidence-review and the six work patterns) copied into
#      ~/.claude/skills/<name>/, AFTER the aac-skills bootstrap has finished copying its payload:
#      that payload carries the desktop's older copy of `caveman`, and the plugin's newer one has
#      to land second so it wins;
#   3. the "big rock": @caveman-ai/cli installed under ~/.local (on PATH through $CLAUDE_ENV_FILE),
#      its signed Go binaries fetched by `caveman setup --install` into ~/.caveman/bin, the local
#      proxy started in compress mode, and `caveman enable claude` run - which wires the shrink
#      hook (PreToolUse rewrites noisy Bash commands through `caveman shrink`, byte-recoverable with
#      `caveman retrieve <handle>`), the native lifecycle hooks and the recovery MCP into
#      ~/.claude/settings.json and ~/.claude.json. Claude Code hot-loads hooks written to the user
#      settings file, so the shrink hook is live from prompt 1 of the session that ran this
#      (measured 2026-09-16, docs/caveman-cloud-2026-09-16.md);
#   4. a marker at ~/.claude/hook-state/caveman-bootstrap/state.json;
#   5. ONE SessionStart additionalContext line, under the 2 KB cap probe #175 measured: the
#      bootstrap status, then the plugin's own activation text (mode banner + rules) from
#      src/hooks/caveman-activate.js, which resolves the level from the repo's .caveman.json.
#
# What it deliberately does NOT do:
#
#   - route this session's own model traffic through the proxy. `caveman enable claude` writes
#     ANTHROPIC_BASE_URL into ~/.claude/settings.json, and a cloud session ignores that: the host
#     sets ANTHROPIC_BASE_URL in the process environment and settings do not override it (probed
#     2026-09-16: a nested `claude -p` routed through the proxy only when the variable was forced in
#     its environment). Do NOT set ANTHROPIC_BASE_URL / _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL in
#     the claude.ai environment's variables either: tried 2026-09-17, it strips the platform's
#     github.com credential injection and every container loses gh, the dotfiles clone and the
#     governance hooks (issues 483, 519). This hook starts the proxy for nested callers that set
#     the variable themselves; it never sets it for the session (a route with no proxy behind it
#     is a dead session, and a hook that can fail on the network must not hold that switch).
#   - copy the cavecrew agents into ~/.claude/agents/: the agent registry is read before
#     SessionStart hooks run, so they would resolve only from the second session on (issue 339).
#     The cavecrew skill is installed; its subagents are not.
#
# Env overrides for tests (leave unset in real runs):
#   CAVEMAN_BOOTSTRAP_HOME      write everything under this HOME instead of $HOME
#   CAVEMAN_BOOTSTRAP_SOURCE    use this local caveman checkout instead of cloning the tag
#   CAVEMAN_BOOTSTRAP_SKIP_CLI  1 = skip npm, binaries, proxy and enable (offline CI)
#   CAVEMAN_BOOTSTRAP_AAC_WAIT  seconds to wait for the aac-skills marker (default 120; 0 = none)
#   CAVEMAN_BOOTSTRAP_REF / CAVEMAN_BOOTSTRAP_REPO / CAVEMAN_BOOTSTRAP_CLI_VERSION   pins
#   CAVEMAN_CLOUD_PROXY         0 = install skills and CLI only; no proxy, no `enable claude`
set -uo pipefail

# Local session: the plugin is installed there; nothing to bootstrap.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

HOME_DIR="${CAVEMAN_BOOTSTRAP_HOME:-$HOME}"
CLAUDE_DIR="$HOME_DIR/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
STATE_DIR="$CLAUDE_DIR/hook-state/caveman-bootstrap"
MARKER_FILE="$STATE_DIR/state.json"
AAC_MARKER="$CLAUDE_DIR/hook-state/aac-bootstrap/state.json"
CHECKOUT="$HOME_DIR/.aac-caveman"
REPO="${CAVEMAN_BOOTSTRAP_REPO:-https://github.com/JuliusBrussee/caveman.git}"
REF="${CAVEMAN_BOOTSTRAP_REF:-v2.7.0}"
CLI_VERSION="${CAVEMAN_BOOTSTRAP_CLI_VERSION:-1.3.4}"
LOCAL_PREFIX="$HOME_DIR/.local"
BIN_DIR="$LOCAL_PREFIX/bin"
AAC_WAIT="${CAVEMAN_BOOTSTRAP_AAC_WAIT:-120}"
PROXY_PORT=8787

# Hook payload from Claude Code (session_id, source, cwd) - forwarded to the plugin's activate hook.
HOOK_INPUT=""
if [ ! -t 0 ]; then
  HOOK_INPUT="$(cat 2>/dev/null || true)"
fi

mkdir -p "$CLAUDE_DIR" "$SKILLS_DIR" "$STATE_DIR" "$BIN_DIR"

problems=()
note() { echo "caveman-bootstrap: $*" >&2; }
problem() { problems+=("$1"); note "$1"; }

# ---------------------------------------------------------------------------
# 1. checkout at the pinned tag (or the local source override).
# ---------------------------------------------------------------------------
SRC=""
if [ -n "${CAVEMAN_BOOTSTRAP_SOURCE:-}" ]; then
  SRC="$CAVEMAN_BOOTSTRAP_SOURCE"
else
  want="$(git ls-remote --tags "$REPO" "refs/tags/$REF" 2>/dev/null | head -1 | cut -f1 || true)"
  have=""
  if [ -d "$CHECKOUT/.git" ]; then
    have="$(git -C "$CHECKOUT" rev-parse HEAD 2>/dev/null || true)"
    tagged="$(git -C "$CHECKOUT" rev-parse "$REF^{commit}" 2>/dev/null || true)"
  fi
  # A tag object's ls-remote hash is the tag, not the commit; compare against the checkout's own
  # resolution of the same ref instead of the remote hash when both are present.
  if [ -n "$have" ] && [ -n "${tagged:-}" ] && [ "$have" = "$tagged" ] && { [ -z "$want" ] || [ -n "$have" ]; }; then
    :
  else
    rm -rf "$CHECKOUT"
    if git clone -q --depth 1 --branch "$REF" "$REPO" "$CHECKOUT" 2>&1 | sed 's/^/caveman-bootstrap: git: /' >&2; then
      :
    fi
  fi
  SRC="$CHECKOUT"
fi

if [ ! -d "$SRC/skills" ] || [ ! -f "$SRC/src/hooks/caveman-activate.js" ]; then
  problem "no caveman checkout at $SRC (skills/ and src/hooks/caveman-activate.js required)"
fi

# ---------------------------------------------------------------------------
# 2. skills - after the aac-skills payload landed, so the plugin's caveman copy wins.
#    SessionStart hooks run concurrently, and session-start.sh ends with a read-modify-write of
#    ~/.claude/settings.json (its plugin-hook merge) right before it writes its marker; waiting
#    for that marker also keeps `caveman enable claude` (step 3, same file) from racing it.
# ---------------------------------------------------------------------------
waited=0
while [ "$waited" -lt "$AAC_WAIT" ] && [ ! -f "$AAC_MARKER" ]; do
  sleep 1
  waited=$((waited + 1))
done
if [ "$AAC_WAIT" -gt 0 ] && [ ! -f "$AAC_MARKER" ]; then
  note "aac-skills marker not seen after ${AAC_WAIT}s; copying skills anyway"
fi

copied=0
skill_names=()
if [ -d "$SRC/skills" ]; then
  for dir in "$SRC"/skills/*/; do
    [ -f "$dir/SKILL.md" ] || continue
    name="$(basename "$dir")"
    skill_names+=("$name")
    if [ -d "$SKILLS_DIR/$name" ] && diff -rq "$dir" "$SKILLS_DIR/$name" >/dev/null 2>&1; then
      continue
    fi
    rm -rf "$SKILLS_DIR/$name"
    if cp -R "$dir" "$SKILLS_DIR/$name"; then
      copied=$((copied + 1))
    else
      problem "copy of skill $name failed"
    fi
  done
fi

# ---------------------------------------------------------------------------
# 3. CLI, binaries, proxy, enable.
# ---------------------------------------------------------------------------
cli_state="skipped"
proxy_state="skipped"
enable_state="skipped"
if [ -z "${CAVEMAN_BOOTSTRAP_SKIP_CLI:-}" ]; then
  # Keep the CLI on PATH for the rest of the session (the hook's own PATH dies with it), guarded
  # against the double SessionStart of issue 166 exactly like session-start.sh does.
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    env_line="export PATH=\"$BIN_DIR:\$PATH\""
    if ! { [ -f "$CLAUDE_ENV_FILE" ] && grep -qxF "$env_line" "$CLAUDE_ENV_FILE"; }; then
      echo "$env_line" >> "$CLAUDE_ENV_FILE"
    fi
  fi
  export PATH="$BIN_DIR:$PATH"
  # `caveman enable claude` refuses when it cannot find `claude` on PATH.
  if [ -n "${CLAUDE_CODE_EXECPATH:-}" ]; then
    export PATH="$(dirname "$CLAUDE_CODE_EXECPATH"):$PATH"
  fi

  installed=""
  if [ -x "$BIN_DIR/caveman" ]; then
    installed="$("$BIN_DIR/caveman" --version 2>/dev/null | grep -o '"version": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
  fi
  if [ "$installed" != "$CLI_VERSION" ]; then
    if npm install -g --prefix "$LOCAL_PREFIX" --no-fund --no-audit "@caveman-ai/cli@$CLI_VERSION" >/dev/null 2>&1; then
      cli_state="installed $CLI_VERSION"
    else
      problem "npm install of @caveman-ai/cli@$CLI_VERSION failed"
      cli_state="npm failed"
    fi
  else
    cli_state="present $CLI_VERSION"
  fi

  if [ -x "$BIN_DIR/caveman" ]; then
    export CAVEMAN_HOME="${CAVEMAN_HOME:-$HOME_DIR/.caveman}"
    ready="$("$BIN_DIR/caveman" setup --json 2>/dev/null | grep -o '"ready": *[a-z]*' | head -1 || true)"
    if [ "$ready" != '"ready": true' ]; then
      if "$BIN_DIR/caveman" setup --install >/dev/null 2>&1; then
        cli_state="$cli_state, binaries installed"
      else
        problem "caveman setup --install failed (signed binaries not fetched)"
        cli_state="$cli_state, binaries missing"
      fi
    else
      cli_state="$cli_state, binaries present"
    fi

    if [ "${CAVEMAN_CLOUD_PROXY:-1}" != "0" ] && [ -x "$CAVEMAN_HOME/bin/caveman-proxy" ]; then
      if (echo > "/dev/tcp/127.0.0.1/$PROXY_PORT") 2>/dev/null; then
        proxy_state="already listening on 127.0.0.1:$PROXY_PORT"
      else
        CAVEMAN_MODE=compress setsid nohup "$BIN_DIR/caveman" start \
          >"$CAVEMAN_HOME/proxy-cloud.log" 2>&1 </dev/null &
        for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
          if (echo > "/dev/tcp/127.0.0.1/$PROXY_PORT") 2>/dev/null; then break; fi
          sleep 1
        done
        if (echo > "/dev/tcp/127.0.0.1/$PROXY_PORT") 2>/dev/null; then
          proxy_state="started on 127.0.0.1:$PROXY_PORT (compress, record-only until routed)"
        else
          problem "caveman proxy did not come up on 127.0.0.1:$PROXY_PORT (see $CAVEMAN_HOME/proxy-cloud.log)"
          proxy_state="failed to start"
        fi
      fi

      enable_out="$("$BIN_DIR/caveman" enable claude 2>&1 || true)"
      if printf '%s' "$enable_out" | grep -q 'native Caveman enabled\|already'; then
        enable_state="enabled (shrink hook + native hooks + recovery MCP in ~/.claude)"
      else
        problem "caveman enable claude did not confirm: $(printf '%s' "$enable_out" | tail -1)"
        enable_state="failed"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 4. marker.
# ---------------------------------------------------------------------------
{
  printf '{\n'
  printf '  "ref": "%s",\n' "$REF"
  printf '  "source": "%s",\n' "$SRC"
  printf '  "cli_version": "%s",\n' "$CLI_VERSION"
  printf '  "cli": "%s",\n' "$cli_state"
  printf '  "proxy": "%s",\n' "$proxy_state"
  printf '  "enable": "%s",\n' "$enable_state"
  printf '  "skills_count": %s,\n' "${#skill_names[@]}"
  printf '  "skills": ['
  first=1
  for n in "${skill_names[@]+"${skill_names[@]}"}"; do
    if [ $first -eq 1 ]; then first=0; else printf ', '; fi
    printf '"%s"' "$n"
  done
  printf '],\n'
  printf '  "copied_this_run": %s,\n' "$copied"
  printf '  "problems": %s,\n' "${#problems[@]}"
  printf '  "installed_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '}\n'
} > "$MARKER_FILE"

# ---------------------------------------------------------------------------
# 5. one additionalContext line: status, then the plugin's activation text, capped at 2 KB.
# ---------------------------------------------------------------------------
activation=""
if [ -f "$SRC/src/hooks/caveman-activate.js" ]; then
  activation="$(cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null && printf '%s' "$HOOK_INPUT" \
    | CLAUDE_CONFIG_DIR="$CLAUDE_DIR" node "$SRC/src/hooks/caveman-activate.js" 2>/dev/null || true)"
fi

export CB_STATUS="CAVEMAN-BOOTSTRAP MARKER: ref $REF; skills copied=$copied of ${#skill_names[@]}; cli: $cli_state; proxy: $proxy_state; enable: $enable_state; problems=${#problems[@]}"
CB_PROBLEMS=""
if [ "${#problems[@]}" -gt 0 ]; then
  CB_PROBLEMS="$(printf '%s; ' "${problems[@]}")"
fi
export CB_PROBLEMS
export CB_ACTIVATION="$activation"
node -e '
  const status = process.env.CB_STATUS;
  const problems = process.env.CB_PROBLEMS.trim();
  let text = status;
  if (problems) text += " PROBLEMS: " + problems;
  text += " Shrunk Bash output ends with a caveman footer naming a recovery handle; `caveman retrieve <handle>` prints the original.";
  // The statusline nudge is desktop advice; the cloud surface has no statusline.
  const activation = process.env.CB_ACTIVATION.replace(/\n+STATUSLINE SETUP NEEDED:[\s\S]*$/, "").trim();
  // The activation text is ~5.8 KB; the cap keeps the banner and the core rules and points at
  // the installed skill for the rest.
  const tail = " [+ rest of the rules: ~/.claude/skills/caveman/SKILL.md]";
  const budget = 2000 - text.length - 2;
  if (activation && budget > 200) {
    text += "\n\n" + (activation.length > budget
      ? activation.slice(0, budget - tail.length) + tail
      : activation);
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
'
exit 0
