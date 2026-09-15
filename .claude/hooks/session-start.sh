#!/bin/bash
# Cloud-container bootstrap (SessionStart) for every AAC repo (issue 163, spec #207).
#
# A local session has ~/.claude populated (rules text, hooks, skills, memory, gh); a cloud
# session on claude.ai/code has none of it. This hook is the one per-repo artefact that closes
# that gap deterministically at session start:
#
#   1. shallow-clone dotfiles master under a stable path so every later step reads from the
#      published source of the aac-skills plugin, not whatever the container ships;
#   2. install gh from the pinned release tarball into ~/.local/bin and put it on PATH via
#      $CLAUDE_ENV_FILE (the hook process's own PATH dies with the hook);
#   3. copy the plugin payload (skills tree) into ~/.claude/skills/ so every skill is
#      invocable regardless of the account marketplace being off in cloud;
#   4. merge the plugin's hooks manifest into ~/.claude/settings.json under a source-tag so a
#      second run replaces its own entries instead of appending duplicates (issue 166 double
#      SessionStart);
#   5. record the payload version + skills fingerprint at a stable marker path so session-check
#      can STOP with a named reason when either is missing (spec #207 user story 7);
#   6. emit ONE SessionStart additionalContext line (under 2KB, the platform cap probe #175
#      measured) naming the installed skills and payload version.
#
# Local sessions exit immediately: ~/.claude is authored there, not delivered.
#
# Every step is idempotent. gh install is skipped when present; the skills copy is a no-op
# when the source fingerprint has not moved; hook merge de-duplicates by _source tag; the
# marker overwrite is the whole point.
#
# Env overrides for tests (leave unset in real runs):
#   BOOTSTRAP_HOME       write everything under this HOME instead of $HOME (fake-container test)
#   BOOTSTRAP_SOURCE     read the dotfiles tree from this local path instead of git-cloning
#                        master (branch-under-test proof; the CI bootstrap test uses this)
#   BOOTSTRAP_DOTFILES_REPO / _REF   override the clone URL and ref
#   BOOTSTRAP_GH_VERSION override the pinned gh release tarball version
#   BOOTSTRAP_SKIP_GH    do not install gh (offline CI)
set -euo pipefail

# Local session: nothing to bootstrap.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

HOME_DIR="${BOOTSTRAP_HOME:-$HOME}"
CLAUDE_DIR="$HOME_DIR/.claude"
SKILLS_DIR="$CLAUDE_DIR/skills"
STATE_DIR="$CLAUDE_DIR/hook-state/aac-bootstrap"
MARKER_FILE="$STATE_DIR/state.json"
USER_SETTINGS="$CLAUDE_DIR/settings.json"
BIN_DIR="$HOME_DIR/.local/bin"
DOTFILES_CLONE="$HOME_DIR/.aac-dotfiles"
DOTFILES_REPO="${BOOTSTRAP_DOTFILES_REPO:-https://github.com/surreptakos/claude-dotfiles.git}"
DOTFILES_REF="${BOOTSTRAP_DOTFILES_REF:-master}"
GH_VERSION="${BOOTSTRAP_GH_VERSION:-2.86.0}"

mkdir -p "$CLAUDE_DIR" "$SKILLS_DIR" "$STATE_DIR" "$BIN_DIR"

# ---------------------------------------------------------------------------
# 1. dotfiles source: local override (BOOTSTRAP_SOURCE) or a shallow clone of master.
# ---------------------------------------------------------------------------
if [ -n "${BOOTSTRAP_SOURCE:-}" ]; then
  DOTFILES_SRC="$BOOTSTRAP_SOURCE"
else
  if [ ! -d "$DOTFILES_CLONE/.git" ]; then
    rm -rf "$DOTFILES_CLONE"
    git clone --depth 1 --branch "$DOTFILES_REF" "$DOTFILES_REPO" "$DOTFILES_CLONE" >&2
  else
    git -C "$DOTFILES_CLONE" fetch --depth 1 origin "$DOTFILES_REF" >&2 || true
    git -C "$DOTFILES_CLONE" reset --hard "origin/$DOTFILES_REF" >&2 || true
  fi
  DOTFILES_SRC="$DOTFILES_CLONE"
fi

PAYLOAD="$DOTFILES_SRC/marketplace/aac-skills"
PLUGIN_MANIFEST="$PAYLOAD/.claude-plugin/plugin.json"
HOOKS_MANIFEST="$PAYLOAD/hooks/hooks.json"

if [ ! -d "$PAYLOAD/skills" ]; then
  echo "aac-bootstrap: no marketplace/aac-skills/skills under $DOTFILES_SRC" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. install gh (pinned) into ~/.local/bin and put it on PATH for the rest of the session.
# ---------------------------------------------------------------------------
if [ -z "${BOOTSTRAP_SKIP_GH:-}" ] && ! command -v gh >/dev/null 2>&1 && [ ! -x "$BIN_DIR/gh" ]; then
  tmp="$(mktemp -d)"
  curl -sSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_amd64.tar.gz" \
    | tar xz -C "$tmp"
  install -m 0755 "$tmp/gh_${GH_VERSION}_linux_amd64/bin/gh" "$BIN_DIR/gh"
  rm -rf "$tmp"
fi
# Idempotent against the double SessionStart (issue 166): the hook's own PATH never carries
# BIN_DIR, so test the env file itself, not $PATH, before appending the export line.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  env_line="export PATH=\"$BIN_DIR:\$PATH\""
  if ! { [ -f "$CLAUDE_ENV_FILE" ] && grep -qxF "$env_line" "$CLAUDE_ENV_FILE"; }; then
    echo "$env_line" >> "$CLAUDE_ENV_FILE"
  fi
fi
export PATH="$BIN_DIR:$PATH"

python3 -c "import yaml" 2>/dev/null || pip install --quiet pyyaml 2>/dev/null || true

# ---------------------------------------------------------------------------
# 3, 4, 5, 6. Everything else is JSON- and hash-shaped; hand it to Python once.
# The heredoc reads env, prints the additionalContext JSON to stdout (Claude Code parses that
# from the hook's stdout on SessionStart), and writes the marker file. bash captures the JSON
# and prints it as the hook's final output.
# ---------------------------------------------------------------------------
export BOOTSTRAP_PAYLOAD="$PAYLOAD"
export BOOTSTRAP_SKILLS_DIR="$SKILLS_DIR"
export BOOTSTRAP_MARKER_FILE="$MARKER_FILE"
export BOOTSTRAP_USER_SETTINGS="$USER_SETTINGS"
export BOOTSTRAP_HOOKS_MANIFEST="$HOOKS_MANIFEST"
export BOOTSTRAP_PLUGIN_MANIFEST="$PLUGIN_MANIFEST"
export BOOTSTRAP_DOTFILES_SRC="$DOTFILES_SRC"
export BOOTSTRAP_GH_PATH="$(command -v gh 2>/dev/null || echo missing)"

python3 <<'PY'
import hashlib, json, os, shutil, sys, time

def sha(data):
    h = hashlib.sha256()
    if isinstance(data, str):
        h.update(data.encode())
    else:
        h.update(data)
    return h.hexdigest()

def tree_hash(root):
    parts = []
    for base, dirs, files in os.walk(root):
        dirs.sort()
        for name in sorted(files):
            if name.startswith('.aac-bootstrap-'):
                continue
            p = os.path.join(base, name)
            rel = os.path.relpath(p, root).replace(os.sep, '/')
            with open(p, 'rb') as f:
                parts.append(f"{rel}:{sha(f.read())}")
    return sha('\n'.join(parts))

payload = os.environ['BOOTSTRAP_PAYLOAD']
skills_src = os.path.join(payload, 'skills')
skills_dst = os.environ['BOOTSTRAP_SKILLS_DIR']
marker_file = os.environ['BOOTSTRAP_MARKER_FILE']
user_settings = os.environ['BOOTSTRAP_USER_SETTINGS']
hooks_manifest = os.environ['BOOTSTRAP_HOOKS_MANIFEST']
plugin_manifest = os.environ['BOOTSTRAP_PLUGIN_MANIFEST']
gh_path = os.environ.get('BOOTSTRAP_GH_PATH', 'missing')

# payload version
version = 'unknown'
try:
    with open(plugin_manifest) as f:
        version = json.load(f).get('version', 'unknown')
except Exception:
    pass

# 3. skills payload: hash source tree, copy every skill dir when it has moved (idempotent)
new_hash = tree_hash(skills_src)
prior = {}
try:
    with open(marker_file) as f:
        prior = json.load(f)
except Exception:
    pass
prior_hash = prior.get('skills_hash')
copied = 0
if prior_hash != new_hash or not os.path.isdir(os.path.join(skills_dst, '.aac-bootstrap-marker')):
    for name in sorted(os.listdir(skills_src)):
        src = os.path.join(skills_src, name)
        if not os.path.isdir(src):
            continue
        dst = os.path.join(skills_dst, name)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)
        copied += 1
    os.makedirs(os.path.join(skills_dst, '.aac-bootstrap-marker'), exist_ok=True)

# Enumerate installed skills for the marker + additionalContext
skill_names = sorted(
    n for n in os.listdir(skills_dst)
    if os.path.isdir(os.path.join(skills_dst, n)) and not n.startswith('.'))

# 4. merge plugin hooks manifest into user settings, tagged so a second run replaces its entries
MARKER = 'aac-bootstrap-plugin-hook'
try:
    with open(user_settings) as f:
        settings = json.load(f)
except Exception:
    settings = {}
try:
    with open(hooks_manifest) as f:
        hooks_doc = json.load(f)
except Exception:
    hooks_doc = {}
plugin_hooks = hooks_doc.get('hooks') or {}
existing = settings.get('hooks') or {}
merged_events = []
for event, entries in plugin_hooks.items():
    kept = [e for e in existing.get(event, []) if not (
        isinstance(e, dict) and e.get('_source') == MARKER)]
    for entry in entries:
        e = json.loads(json.dumps(entry))
        e['_source'] = MARKER
        kept.append(e)
    existing[event] = kept
    merged_events.append(event)
settings['hooks'] = existing
os.makedirs(os.path.dirname(user_settings), exist_ok=True)
with open(user_settings, 'w') as f:
    json.dump(settings, f, indent=2)

# 5. write the marker file (session-check reads it; STOP when absent)
os.makedirs(os.path.dirname(marker_file), exist_ok=True)
with open(marker_file, 'w') as f:
    json.dump({
        'payload_version': version,
        'skills_hash': new_hash,
        'skills_count': len(skill_names),
        'skills': skill_names,
        'gh_path': gh_path,
        'hooks_events': merged_events,
        'dotfiles_source': os.environ.get('BOOTSTRAP_DOTFILES_SRC', ''),
        'installed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'copied_this_run': copied,
    }, f, indent=2)

# 6. one SessionStart additionalContext line, under 2KB. The names are truncated (not the
#    payload version and not the marker sentence session-check greps for) so a growing skill
#    list never overruns the cap.
sentence = f"AAC-BOOTSTRAP MARKER: payload v{version}; skills copied={copied}; gh={gh_path}"
budget = 2000 - len(sentence) - len(' skills=[]')
names_str = ','.join(skill_names)
if len(names_str) > budget:
    names_str = names_str[:budget - 1] + '+'
msg = f"{sentence} skills=[{names_str}]"

print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'SessionStart',
        'additionalContext': msg,
    }
}))
PY
