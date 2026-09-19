#!/bin/bash
# Cloud-container bootstrap (SessionStart) for every AAC repo (issue 163, spec #207).
#
# CANONICAL COPY. The project-harness skill delivers this exact file to every harnessed repo
# as `.claude/hooks/session-start.sh` (SKILL.md step 16, harness v27, issue 218); the skill's
# `templates/session-start.sh` is generated from here, byte for byte, by this repo's
# `tools/build-harness-bootstrap-hook.js`. Fix the hook HERE and re-run that generator; a
# delivered copy edited in place is overwritten by the next harness upgrade.
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
#      a stage that fails (clone, payload) writes a failed marker naming its cause instead
#      (issue 483), so "marker absent" is never the only signal;
#   6. emit ONE SessionStart additionalContext line (under 2KB, the platform cap probe #175
#      measured) naming the installed skills and payload version.
#
# Local sessions exit immediately: ~/.claude is authored there, not delivered.
#
# What this hook deliberately does NOT deliver: custom agent types (`profile/claude/agents/` in the
# dotfiles repo). Custom agent types are a desktop-only facility and no plugin-served script
# may pin a dotfiles-defined `agentType` for a cloud session. The reason is timing, not
# paths: Claude Code reads the agent registry BEFORE SessionStart hooks run, so anything this
# hook writes into ~/.claude/agents/ is invisible to the very session that ran it. Measured in
# a real container on 2026-09-16 (issue 339, full transcript in docs/tickets/339-decision.md):
# a control session with the agent file already on disk resolved the type; a session whose
# SessionStart hook wrote the identical file answered "Agent type 'exp-probe' not found.
# Available agents: claude, claude-code-guide, Explore, general-purpose, Plan,
# statusline-setup" although the file was on disk when the run ended; a second session over
# that same config dir resolved it. Copying profile/claude/agents/ here would therefore buy a
# capability that works only from the second session onward in a container - exactly the
# "looks available and silently is not" state issue 339 was filed against. Step 6 states the
# limitation in the additionalContext line instead.
#
# Every step is idempotent. gh install is skipped when present; the skills copy is a no-op
# when the source fingerprint has not moved; hook merge de-duplicates by _source tag; the
# marker overwrite is the whole point.
#
# Harness v30 (issue 614) fixed the two ways this file was silently not working. (1) The delivered
# copy ran as `$CLAUDE_PROJECT_DIR/.claude/hooks/session-start.sh`, so a Windows commit that lost
# the executable bit (git core.fileMode=false ignores fs.chmod) gave every cloud session exit 126
# in 5 ms, before this line: no marker, and "marker absent" already meant two other things.
# The installer now wires `bash "<path>"` and stages the file 100755. (2) Step 4 copied the
# manifest's commands verbatim, and Claude Code refuses `${CLAUDE_PLUGIN_ROOT}` in settings.json
# ("not associated with a plugin"): 16 of 17 governance hooks failed on every event, and the one
# plain echo among them printed "plugin hooks execute on this surface". See step 4.
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
# This file's own path, for the STOP line's re-run instruction: the model's shell has no
# $CLAUDE_PROJECT_DIR, so the line names the file as this run was invoked.
HOOK_SELF="$(readlink -f "$0" 2>/dev/null || echo "$0")"
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
SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$SCRATCH_DIR"' EXIT

# A named failure is a marker too (issue 483). Before this, a clone that could not authenticate
# (`fatal: could not read Username for 'https://github.com'`, every container of 2026-09-16/17
# whose environment carried a caveman ANTHROPIC_BASE_URL, issue 519) killed the hook under
# `set -e` with no marker written, so session-check could only say "marker absent" and two
# sessions read that as a platform outage. Now the failing stage writes `{"failed": true,
# "stage", "reason"}` at the marker path, bootstrap-check.js reports the cause as its STOP, and
# the SessionStart additionalContext carries the same line so the model reads it on prompt 1.
# Exit 0 on purpose: Claude Code parses hookSpecificOutput only from a hook that exits 0, and a
# non-zero exit would drop this line and leave stderr as the only trace, the old shape.
bootstrap_fail() {
  local stage="$1" reason="$2"
  echo "aac-bootstrap: STOP - $stage failed: $reason" >&2
  BOOTSTRAP_FAIL_MARKER="$MARKER_FILE" BOOTSTRAP_FAIL_STAGE="$stage" BOOTSTRAP_FAIL_REASON="$reason" \
  BOOTSTRAP_FAIL_REPO="$DOTFILES_REPO" BOOTSTRAP_FAIL_REF="$DOTFILES_REF" \
  BOOTSTRAP_FAIL_GH="$(command -v gh 2>/dev/null || echo missing)" BOOTSTRAP_FAIL_SELF="$HOOK_SELF" \
  python3 - <<'PYFAIL'
import json, os, time
e = os.environ
marker = e['BOOTSTRAP_FAIL_MARKER']
os.makedirs(os.path.dirname(marker), exist_ok=True)
with open(marker, 'w') as f:
    json.dump({
        'failed': True,
        'stage': e['BOOTSTRAP_FAIL_STAGE'],
        'reason': e['BOOTSTRAP_FAIL_REASON'],
        'dotfiles_repo': e['BOOTSTRAP_FAIL_REPO'],
        'dotfiles_ref': e['BOOTSTRAP_FAIL_REF'],
        'gh_path': e['BOOTSTRAP_FAIL_GH'],
        'skills': [],
        'failed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }, f, indent=2)
# The line is an instruction, not a report (issue 614): a session that reads it can repair the
# container itself in two tool calls, and until claude-dotfiles is a source of the environment
# every session has to. The three assertion tokens the clone-failure gate greps for stay:
# `AAC-BOOTSTRAP STOP: <stage> failed`, `push_files`, `ANTHROPIC_BASE_URL`.
msg = (
    f"AAC-BOOTSTRAP STOP: {e['BOOTSTRAP_FAIL_STAGE']} failed - {e['BOOTSTRAP_FAIL_REASON']};"
    f" no aac payload, skills or governance hooks landed in this container;"
    f" gh={e['BOOTSTRAP_FAIL_GH']}; git push falls back to GitHub MCP push_files."
    f" SELF-HEAL NOW, before any other work: if git could not read a username for github.com,"
    f" the dotfiles repo is not a source of this session - call the Claude_Code_Remote add_repo"
    f" tool (owner surreptakos, repo claude-dotfiles, access read), then re-run this hook with"
    f" `bash \"{e['BOOTSTRAP_FAIL_SELF']}\"` and quote its AAC-BOOTSTRAP MARKER line; the"
    f" durable fix is {e['BOOTSTRAP_FAIL_REPO']} as a second source of the environment"
    f" (claude-dotfiles issue 614). If ANTHROPIC_BASE_URL is not https://api.anthropic.com, a"
    f" caveman proxy URL stripped credential injection instead (`env | grep ANTHROPIC_BASE_URL`,"
    f" issues 483, 519)"
)
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': msg}}))
PYFAIL
  exit 0
}

# ---------------------------------------------------------------------------
# 1. install gh (pinned) into ~/.local/bin and put it on PATH for the rest of the session.
#    Runs BEFORE the clone on purpose (issue 483): the gh tarball is a public download that
#    passes the proxy even when credential injection is broken, so a failed clone still leaves
#    gh on PATH for the REST fallbacks the STOP line names.
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
# 2. dotfiles source: local override (BOOTSTRAP_SOURCE) or a shallow clone of master.
# ---------------------------------------------------------------------------
if [ -n "${BOOTSTRAP_SOURCE:-}" ]; then
  DOTFILES_SRC="$BOOTSTRAP_SOURCE"
else
  # Issue 241: the previous shape was `git fetch --depth 1 ... || true; git reset --hard ...
  # || true`, so a failed fetch — or a force-push / orphan-reroot on origin that leaves the
  # local <ref> with NO merge-base against origin/<ref> — was silently swallowed. The next
  # step then read plugin.json out of a stale checkout. Repair-in-place at bootstrap time:
  # after fetch, classify the local vs origin <ref> pair BEFORE reset. If fetch failed, or
  # either ref is unresolved, or the two share no history (deepen once first to
  # distinguish a healthy shallow fast-forward from a real orphan-reroot), print the named
  # reason and rebuild the clone from origin — the "reset to origin" branch of the ticket's
  # acceptance criterion. Otherwise proceed to reset --hard as before.
  _bootstrap_needs_reclone=""
  _bootstrap_reclone_reason=""
  if [ ! -d "$DOTFILES_CLONE/.git" ]; then
    _bootstrap_needs_reclone=1
    _bootstrap_reclone_reason="no cached clone yet"
  else
    if ! git -C "$DOTFILES_CLONE" fetch --depth 1 origin "$DOTFILES_REF" >&2; then
      _bootstrap_needs_reclone=1
      _bootstrap_reclone_reason="git fetch --depth 1 origin $DOTFILES_REF failed"
    else
      _local_ref="$(git -C "$DOTFILES_CLONE" rev-parse --verify "refs/heads/$DOTFILES_REF" 2>/dev/null || echo "")"
      _origin_ref="$(git -C "$DOTFILES_CLONE" rev-parse --verify "refs/remotes/origin/$DOTFILES_REF" 2>/dev/null || echo "")"
      if [ -z "$_origin_ref" ]; then
        _bootstrap_needs_reclone=1
        _bootstrap_reclone_reason="origin/$DOTFILES_REF ref missing after fetch"
      elif [ -z "$_local_ref" ]; then
        _bootstrap_needs_reclone=1
        _bootstrap_reclone_reason="local $DOTFILES_REF ref missing (issue 241)"
      elif [ "$_local_ref" != "$_origin_ref" ]; then
        # Shallow clones (--depth 1) hide merge-base for perfectly linear fast-forward
        # history — the local tip is a shallow boundary and merge-base cannot walk past
        # it. Deepen once so a real fast-forward reads as one, and only a true
        # unrelated-history case surfaces below.
        git -C "$DOTFILES_CLONE" fetch --deepen=100 origin "$DOTFILES_REF" >&2 || true
        if ! git -C "$DOTFILES_CLONE" merge-base "$_local_ref" "$_origin_ref" >/dev/null 2>&1; then
          _bootstrap_needs_reclone=1
          _bootstrap_reclone_reason="local $DOTFILES_REF has no merge-base with origin/$DOTFILES_REF (issue 241)"
        fi
      fi
    fi
    if [ -z "$_bootstrap_needs_reclone" ]; then
      if ! git -C "$DOTFILES_CLONE" reset --hard "origin/$DOTFILES_REF" >&2; then
        _bootstrap_needs_reclone=1
        _bootstrap_reclone_reason="git reset --hard origin/$DOTFILES_REF failed"
      fi
    fi
  fi
  if [ -n "$_bootstrap_needs_reclone" ]; then
    if [ -d "$DOTFILES_CLONE/.git" ]; then
      echo "aac-bootstrap: rebuilding cached clone at $DOTFILES_CLONE — $_bootstrap_reclone_reason" >&2
    fi
    rm -rf "$DOTFILES_CLONE"
    _clone_err="$SCRATCH_DIR/clone.err"
    if ! git clone --depth 1 --branch "$DOTFILES_REF" "$DOTFILES_REPO" "$DOTFILES_CLONE" 2>"$_clone_err" >&2; then
      cat "$_clone_err" >&2
      bootstrap_fail clone "git clone --depth 1 --branch $DOTFILES_REF $DOTFILES_REPO: $(tail -n 1 "$_clone_err" | tr -d '\r')"
    fi
    cat "$_clone_err" >&2
  fi
  DOTFILES_SRC="$DOTFILES_CLONE"
fi

PAYLOAD="$DOTFILES_SRC/marketplace/aac-skills"
PLUGIN_MANIFEST="$PAYLOAD/.claude-plugin/plugin.json"
HOOKS_MANIFEST="$PAYLOAD/hooks/hooks.json"

if [ ! -d "$PAYLOAD/skills" ]; then
  bootstrap_fail payload "no marketplace/aac-skills/skills under $DOTFILES_SRC"
fi

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
import hashlib, json, os, shlex, shutil, sys, time

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

# Enumerate the payload's skills for the marker + additionalContext. The source tree, not the
# destination: ~/.claude/skills also holds Claude Code's own `synced/` bucket and any skill a
# harness installed, and session-check STOPs when a marker name has no SKILL.md on disk
# (first container run, 2026-09-15: `synced` was listed and every session STOPped).
skill_names = sorted(
    n for n in os.listdir(skills_src)
    if os.path.isfile(os.path.join(skills_src, n, 'SKILL.md')))

# 4. merge plugin hooks manifest into user settings, tagged so a second run replaces its entries.
#    The manifest is written for a plugin Claude Code installed itself: its commands invoke the
#    scripts through ${CLAUDE_PLUGIN_ROOT}, and Claude Code resolves that variable ONLY for hooks
#    registered from a plugin's own hooks.json. Copied verbatim into settings.json (v27-v29), the
#    16 entries that use it all failed on every event - "Hook command references
#    ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin", 114 times in one
#    session's log on 2026-09-19 - while the one plain echo entry printed its "plugin hooks
#    execute on this surface" marker and read as proof for the rest (issue 614). So each command
#    is rewritten for the seat it runs from here: the token becomes the payload's absolute path,
#    and the command carries CLAUDE_PLUGIN_ROOT for the scripts that read it from the environment
#    (global-rules.js, governance-reminder.js, session-gate.js) plus PLUGIN_HOOK_GUARD_DISABLE=1,
#    because the payload's dedup guard exits silently whenever settings.json names the script -
#    which is now exactly the case. Entries are also recognised by their command when a later
#    `claude plugin` command has stripped the _source tags (it rewrites settings.json without
#    unknown keys): the payload path, the literal token a pre-v30 run left behind, or the echo
#    marker text - nothing else in a container writes any of the three - so a second run still
#    replaces instead of appending (seen live on 2026-09-19: 16 dead literal entries beside the
#    16 seated ones after a plugin command had dropped the tags).
MARKER = 'aac-bootstrap-plugin-hook'
PLUGIN_ROOT_TOKEN = '${CLAUDE_PLUGIN_ROOT}'
HOOK_MARKER_TEXT = 'AAC-SKILLS HOOK MARKER'
payload_abs = os.path.abspath(payload)
seat_prefix = 'CLAUDE_PLUGIN_ROOT=' + shlex.quote(payload_abs) + ' PLUGIN_HOOK_GUARD_DISABLE=1 '

def seat_command(command):
    if PLUGIN_ROOT_TOKEN not in command:
        return command
    return seat_prefix + command.replace(PLUGIN_ROOT_TOKEN, payload_abs)

def is_ours(entry):
    if not isinstance(entry, dict):
        return False
    if entry.get('_source') == MARKER:
        return True
    for h in entry.get('hooks') or []:
        c = h.get('command', '') if isinstance(h, dict) else ''
        if payload_abs in c or PLUGIN_ROOT_TOKEN in c or HOOK_MARKER_TEXT in c:
            return True
    return False
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
    kept = [e for e in existing.get(event, []) if not is_ours(e)]
    for entry in entries:
        e = json.loads(json.dumps(entry))
        for h in e.get('hooks') or []:
            if isinstance(h, dict) and isinstance(h.get('command'), str):
                h['command'] = seat_command(h['command'])
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
        'plugin_root': payload_abs,
        'dotfiles_source': os.environ.get('BOOTSTRAP_DOTFILES_SRC', ''),
        'installed_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'copied_this_run': copied,
    }, f, indent=2)

# 6. one SessionStart additionalContext line, under 2KB. The names are truncated (not the
#    payload version, not the marker sentence session-check greps for, and not the
#    invoke-as clause the model reads on prompt 1) so a growing skill list never overruns
#    the cap.
#    The invoke-as clause is load-bearing (issue 242): step 3 copies each skill into
#    ~/.claude/skills/<bare-name>/, so it invokes as /<bare-name>. The marketplace-style
#    /aac-skills:<skill> form has nothing to resolve to in a bootstrapped container
#    because the bootstrap does not register the plugin — only its skills, under bare
#    names (the issue 242 body records the owner cloud session that hit that on
#    2026-09-15; the evidence recap is at docs/tickets/242-decision.md). Naming the
#    working spelling here removes the coin-flip for the model on prompt 1.
#    The agent-type clause is load-bearing too (issue 339): no custom agent type is
#    installed here, and none could be - the agent registry is read before this hook runs,
#    so a SessionStart write to ~/.claude/agents/ is invisible to this session. A script
#    that pins a dotfiles-defined agentType fails with "Agent type '<name>' not found",
#    an error that names the type and not the cause; saying so here removes the guess.
sentence = (
    f"AAC-BOOTSTRAP MARKER: payload v{version}; skills copied={copied}; gh={gh_path};"
    f" invoke skills as /<skill> (bare name) - the plugin-namespaced /aac-skills:<skill>"
    f" form does not resolve in a bootstrapped container (issue 242);"
    f" no custom agent types here - pinning a dotfiles-defined agentType does not work in a"
    f" cloud session, the agent registry is read before this hook runs (issue 339)"
)
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
