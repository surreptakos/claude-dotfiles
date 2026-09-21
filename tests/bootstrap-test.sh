#!/usr/bin/env bash
# The bootstrap gate (issue 211, spec #207 testing seam 1).
#
# What a fresh claude.ai/code container gets is produced by ONE artefact: the SessionStart
# bootstrap hook `.claude/hooks/session-start.sh`. Nothing else in this repo proves it works.
# The Windows restore test answers the other question ("can a PC be rebuilt from the mirrors?")
# and cannot run on a Linux runner at all, so a broken bootstrap used to reach a container
# before it reached a test.
#
# This script is that test, and it exercises the seam a container crosses rather than the
# hook's internals: empty home, CLAUDE_CODE_REMOTE=true, run the hook, then assert the
# observable state a governed session depends on.
#
#   1  the hook exits 0 and emits one SessionStart additionalContext JSON line
#   2  the payload's skills are on disk under <home>/.claude/skills
#   3  every governance hook entry the spec names is merged into <home>/.claude/settings.json,
#      tagged, and points at a script the payload actually carries
#   4  the global rules text file is in the payload and a UserPromptSubmit entry delivers it
#   5  gh is installed and reachable through the PATH the hook exported via $CLAUDE_ENV_FILE
#   6  session-check — the copy the bootstrap installed — exits 0 and prints its payload-version
#      line, which this script quotes; and its --end mechanical gate (issue 622) STOPs on a
#      settings file naming a hook script nothing provides
#   7  every merged SessionStart and UserPromptSubmit command RUNS from the clean home and exits 0
#      (issue 614: checks 3 and 5 passed for three harness versions while every merged command
#      carried a literal ${CLAUDE_PLUGIN_ROOT} that Claude Code refuses in settings.json — a gate
#      that only reads the entries cannot see that; this one executes them)
#
# WHY THE EXPECTATION IN CHECK 3 IS HARD-CODED HERE and not read out of the payload's
# hooks.json: a gate that compares the merged settings against the manifest they were merged
# from passes on any manifest, including one with a governance hook deleted. The list below is
# the spec's list (the eight governance entries plus the prompt gate, the rules delivery of
# issue 209 and the memory loader), so deleting an entry from the payload turns this red. That
# is acceptance criterion 2 of issue 211, and `--fault missing-hook-entry` reproduces it.
#
# USAGE
#   tests/bootstrap-test.sh                          # the gate
#   tests/bootstrap-test.sh --fault missing-hook-entry   # prove it can fail
#   tests/bootstrap-test.sh --fault verbatim-plugin-root # issue 614: the v27-v29 shape - merged
#                                                        # commands carrying the literal
#                                                        # ${CLAUDE_PLUGIN_ROOT} - must turn checks
#                                                        # 3 and 7 red
#   tests/bootstrap-test.sh --scenario clone-failure     # issue 483: an unreachable dotfiles repo
#                                                        # leaves a FAILED marker naming the cause,
#                                                        # a STOP additionalContext line, and gh;
#                                                        # session-check STOPs on the cause. Exits 0
#                                                        # when that honesty holds, 1 when it does not.
#
# ENV
#   BOOTSTRAP_TEST_SCRATCH   scratch root to use instead of a fresh mktemp -d
#   BOOTSTRAP_TEST_KEEP=1    leave the scratch tree behind for inspection
#
# Tidying up never decides the verdict (the restore suite's rule): the scratch delete runs
# after the verdict is computed and its failure cannot change the exit code.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$REPO/.claude/hooks/session-start.sh"

FAULT=""
SCENARIO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fault) FAULT="${2:-}"; shift 2 ;;
    --fault=*) FAULT="${1#*=}"; shift ;;
    --scenario) SCENARIO="${2:-}"; shift 2 ;;
    --scenario=*) SCENARIO="${1#*=}"; shift ;;
    -h|--help) sed -n '1,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "bootstrap-test: unknown argument '$1'" >&2; exit 64 ;;
  esac
done
case "$FAULT" in
  ""|missing-hook-entry|verbatim-plugin-root) ;;
  *) echo "bootstrap-test: unknown fault '$FAULT' (known: missing-hook-entry, verbatim-plugin-root)" >&2; exit 64 ;;
esac
case "$SCENARIO" in
  ""|clone-failure) ;;
  *) echo "bootstrap-test: unknown scenario '$SCENARIO' (known: clone-failure)" >&2; exit 64 ;;
esac

fails=0
pass() { echo "  pass  $1"; }
fail() { echo "  FAIL  $1" >&2; fails=$((fails + 1)); }

if [ -n "${BOOTSTRAP_TEST_SCRATCH:-}" ]; then
  SCRATCH="$BOOTSTRAP_TEST_SCRATCH/bootstrap-test-$$"
  mkdir -p "$SCRATCH"
else
  SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/bootstrap-test-XXXXXX")"
fi
CLEAN_HOME="$SCRATCH/home"
SRC="$SCRATCH/src"
PAYLOAD="$SRC/marketplace/aac-skills"
ENV_FILE="$SCRATCH/claude-env"
FIXTURE="$SCRATCH/fixture-repo"
PATH_SHIM="$SCRATCH/pathshim"

echo "bootstrap gate — scratch $SCRATCH"

# The payload the hook reads is a COPY, so a fault can be injected into it without touching the
# checkout, and so the hook's own `rm -rf`/copy steps can never write into the repo.
mkdir -p "$SRC/marketplace" "$CLEAN_HOME"
cp -r "$REPO/marketplace/aac-skills" "$PAYLOAD"

if [ "$FAULT" = "missing-hook-entry" ]; then
  # Acceptance criterion 2: one governance hook entry removed from the payload. The real-world
  # shape is a scratch branch whose committed hooks.json lost an entry; the effect on the
  # merged user settings is identical.
  python3 - "$PAYLOAD/hooks/hooks.json" <<'PY'
import json, sys
p = sys.argv[1]
doc = json.load(open(p))
groups = doc['hooks']['PreToolUse']
removed = groups.pop(0)
if not groups:
    del doc['hooks']['PreToolUse']
json.dump(doc, open(p, 'w'), indent=2)
print(f"  fault injected: removed PreToolUse entry {json.dumps(removed['hooks'][0]['command'])[:80]}")
PY
fi

# A PATH with no gh on it. The runner image ships gh, which would make the hook skip its own
# install and leave check 5 asserting the image rather than the bootstrap. Symlinking every
# other executable into one directory is the only way to drop gh without dropping /usr/bin.
mkdir -p "$PATH_SHIM"
IFS=':' read -r -a _path_dirs <<< "$PATH"
for _d in "${_path_dirs[@]}"; do
  [ -n "$_d" ] && [ -d "$_d" ] || continue
  for _f in "$_d"/*; do
    [ -x "$_f" ] || continue
    _b="${_f##*/}"
    [ "$_b" = "gh" ] && continue
    [ -e "$PATH_SHIM/$_b" ] && continue
    ln -s "$_f" "$PATH_SHIM/$_b" 2>/dev/null || true
  done
done

# The hook downloads the pinned gh tarball, so a sandbox that only reaches the network through
# an egress proxy has to keep those variables — a cloud container has them set too. Nothing else
# from this shell's environment travels (`env -i`): the point is an empty home, not this box.
passthrough=()
for _v in HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NO_PROXY no_proxy \
          SSL_CERT_FILE SSL_CERT_DIR CURL_CA_BUNDLE NODE_EXTRA_CA_CERTS REQUESTS_CA_BUNDLE; do
  [ -n "${!_v:-}" ] && passthrough+=("$_v=${!_v}")
done

# ------------------------------------------------ scenario: clone-failure (issue 483) ---------
# No BOOTSTRAP_SOURCE, and the clone URL points at a path that does not exist, so the hook has
# to clone and cannot. The real-world shape is a container whose credential injection is gone
# (`fatal: could not read Username for 'https://github.com'`, issue 519); the effect on the hook
# is the same exit from `git clone`. What must hold: the hook still exits 0 and prints ONE
# SessionStart JSON line whose additionalContext starts with `AAC-BOOTSTRAP STOP:` and names the
# clone; the marker exists with `failed: true`, `stage: clone` and git's own last line as the
# reason; and session-check (this checkout's copy, since no payload landed) STOPs on that cause
# rather than on "marker absent". gh install is skipped (offline), so the marker records
# `gh_path: missing` and that is asserted too: the field has to be present either way.
if [ "$SCENARIO" = "clone-failure" ]; then
  : > "$ENV_FILE"
  hook_out="$SCRATCH/hook-stdout.json"
  hook_err="$SCRATCH/hook-stderr.txt"
  env -i \
    PATH="$PATH_SHIM" \
    HOME="$CLEAN_HOME" \
    CLAUDE_CODE_REMOTE=true \
    BOOTSTRAP_HOME="$CLEAN_HOME" \
    BOOTSTRAP_DOTFILES_REPO="$SCRATCH/no-such-repo.git" \
    BOOTSTRAP_SKIP_GH=1 \
    CLAUDE_ENV_FILE="$ENV_FILE" \
    ${passthrough[@]+"${passthrough[@]}"} \
    bash "$HOOK" >"$hook_out" 2>"$hook_err"
  hook_status=$?
  if [ "$hook_status" -eq 0 ]; then
    pass "hook exited 0 with an unreachable dotfiles repo (a non-zero exit would drop the STOP line)"
  else
    fail "hook exited $hook_status; stderr: $(tail -3 "$hook_err" | tr '\n' ' ')"
  fi
  if grep -q 'aac-bootstrap: STOP - clone failed' "$hook_err"; then
    pass "stderr carries the STOP line: $(grep 'aac-bootstrap: STOP' "$hook_err" | head -1 | cut -c1-120)"
  else
    fail "stderr has no 'aac-bootstrap: STOP - clone failed' line"
  fi
  MARKER="$CLEAN_HOME/.claude/hook-state/aac-bootstrap/state.json"
  if BOOTSTRAP_TEST_MARKER="$MARKER" BOOTSTRAP_TEST_HOOK_OUT="$hook_out" \
     python3 "$REPO/tests/bootstrap-assert-clone-failure.py"; then :; else fails=$((fails + 1)); fi
  CHECK="$REPO/aac-skills/session-check/check.js"
  check_out="$SCRATCH/session-check.txt"
  mkdir -p "$FIXTURE/.git" "$FIXTURE/.claude"
  echo '{"harness": false}' > "$FIXTURE/.claude/session.json"
  ( cd "$FIXTURE" && env -i \
      PATH="$PATH_SHIM" \
      HOME="$CLEAN_HOME" \
      CLAUDE_CODE_REMOTE_SESSION_ID=ci-bootstrap-gate \
      node "$CHECK" ) >"$check_out" 2>&1
  check_status=$?
  if [ "$check_status" -ne 0 ] && grep -q 'STOP aac-bootstrap clone failed' "$check_out"; then
    pass "session-check exited $check_status and STOPs on the cause: $(grep 'STOP aac-bootstrap clone failed' "$check_out" | sed 's/^ *//' | cut -c1-120)"
  else
    fail "session-check exited $check_status without 'STOP aac-bootstrap clone failed' (STOP lines: $(grep -c 'STOP' "$check_out"))"
    grep -n 'STOP\|aac-bootstrap' "$check_out" | head -10 >&2
  fi
  if grep -q 'marker absent' "$check_out"; then
    fail "session-check still says 'marker absent' — the failed marker was not read"
  fi
  echo ""
  if [ "$fails" -eq 0 ]; then
    echo "bootstrap gate (clone-failure scenario): PASS"
  else
    echo "bootstrap gate (clone-failure scenario): FAIL ($fails check(s))"
  fi
  [ -n "${BOOTSTRAP_TEST_KEEP:-}" ] || rm -rf "$SCRATCH" 2>/dev/null || true
  [ "$fails" -eq 0 ] || exit 1
  exit 0
fi

# ---------------------------------------------------------------- 1. run the hook -------------
: > "$ENV_FILE"
hook_out="$SCRATCH/hook-stdout.json"
hook_err="$SCRATCH/hook-stderr.txt"
env -i \
  PATH="$PATH_SHIM" \
  HOME="$CLEAN_HOME" \
  CLAUDE_CODE_REMOTE=true \
  BOOTSTRAP_HOME="$CLEAN_HOME" \
  BOOTSTRAP_SOURCE="$SRC" \
  CLAUDE_ENV_FILE="$ENV_FILE" \
  ${passthrough[@]+"${passthrough[@]}"} \
  bash "$HOOK" >"$hook_out" 2>"$hook_err"
hook_status=$?
if [ "$hook_status" -eq 0 ]; then
  pass "hook exited 0 from an empty home"
else
  fail "hook exited $hook_status; stderr: $(tail -5 "$hook_err" | tr '\n' ' ')"
fi

if [ "$FAULT" = "verbatim-plugin-root" ]; then
  # Issue 614: what v27-v29 wrote. Un-seat every merged command after the hook has run - strip
  # the CLAUDE_PLUGIN_ROOT=... PLUGIN_HOOK_GUARD_DISABLE=1 prefix and put the literal token back
  # in place of the payload path - so the settings file is the shape three green gates accepted.
  python3 - "$CLEAN_HOME/.claude/settings.json" "$SRC/marketplace/aac-skills" <<'PYFAULT'
import json, os, re, sys
p, payload = sys.argv[1], os.path.abspath(sys.argv[2])
s = json.load(open(p))
n = 0
for groups in s.get('hooks', {}).values():
    for g in groups:
        for h in g.get('hooks', []):
            c = h.get('command', '')
            if payload in c:
                c = re.sub(r"^CLAUDE_PLUGIN_ROOT=\S+ PLUGIN_HOOK_GUARD_DISABLE=1 ", '', c)
                h['command'] = c.replace(payload, '${CLAUDE_PLUGIN_ROOT}')
                n += 1
json.dump(s, open(p, 'w'), indent=2)
print(f"  fault injected: {n} merged commands un-seated back to the literal ${{CLAUDE_PLUGIN_ROOT}}")
PYFAULT
fi

# ------------------------------------------------- 2-5. assert the installed state -------------
BOOTSTRAP_TEST_HOME="$CLEAN_HOME" \
BOOTSTRAP_TEST_PAYLOAD="$PAYLOAD" \
BOOTSTRAP_TEST_ENV_FILE="$ENV_FILE" \
BOOTSTRAP_TEST_HOOK_OUT="$hook_out" \
python3 "$REPO/tests/bootstrap-assert.py"
assert_status=$?
[ "$assert_status" -eq 0 ] || fails=$((fails + 1))

# ------------------------------- 5b. the home-anchored seat repairs a failed marker (issue 643) --
# The state the fix exists for: a container image carrying a `failed: true` marker, and a session
# whose project dir is not a harnessed repo, so the repo-anchored entry never runs. Only the copy
# the bootstrap seated in user settings can repair that, so run THAT copy - by the path a
# settings.json entry would - and require a healthy marker afterwards.
SELF_HOOK="$CLEAN_HOME/.claude/hooks/aac-bootstrap.sh"
MARKER_FILE="$CLEAN_HOME/.claude/hook-state/aac-bootstrap/state.json"
if [ ! -x "$SELF_HOOK" ]; then
  fail "no executable home-anchored hook at $SELF_HOOK to re-run"
else
  python3 - "$MARKER_FILE" <<'PYFAILED'
import json, sys
json.dump({'failed': True, 'stage': 'clone', 'skills': [],
           'reason': "could not read Username for 'https://github.com'",
           'failed_at': '2026-09-19T14:02:16Z'}, open(sys.argv[1], 'w'), indent=2)
PYFAILED
  reboot_out="$SCRATCH/self-hook-stdout.json"
  reboot_err="$SCRATCH/self-hook-stderr.txt"
  env -i \
    PATH="$PATH_SHIM" \
    HOME="$CLEAN_HOME" \
    CLAUDE_CODE_REMOTE=true \
    BOOTSTRAP_HOME="$CLEAN_HOME" \
    BOOTSTRAP_SOURCE="$SRC" \
    CLAUDE_ENV_FILE="$ENV_FILE" \
    ${passthrough[@]+"${passthrough[@]}"} \
    bash "$SELF_HOOK" >"$reboot_out" 2>"$reboot_err"
  reboot_status=$?
  if [ "$reboot_status" -ne 0 ]; then
    fail "the home-anchored hook exited $reboot_status; stderr: $(tail -3 "$reboot_err" | tr '\n' ' ')"
  elif python3 -c "import json,sys; m=json.load(open(sys.argv[1])); sys.exit(0 if m.get('failed') is not True and m.get('skills') else 1)" "$MARKER_FILE"; then
    pass "the home-anchored copy re-bootstrapped over a failed marker without any project dir"
  else
    fail "the home-anchored copy left the failed marker in place at $MARKER_FILE"
  fi
  if grep -q 'AAC-BOOTSTRAP MARKER' "$reboot_out"; then
    pass "its run printed the SessionStart marker line the model reads on prompt 1"
  else
    fail "its run printed no AAC-BOOTSTRAP MARKER line: $(head -c 160 "$reboot_out")"
  fi
  # Idempotence: a marker seconds old means a second entry firing in the same session has
  # nothing to do, and must not print a second additionalContext line.
  second_out="$SCRATCH/self-hook-second.json"
  env -i \
    PATH="$PATH_SHIM" \
    HOME="$CLEAN_HOME" \
    CLAUDE_CODE_REMOTE=true \
    BOOTSTRAP_HOME="$CLEAN_HOME" \
    BOOTSTRAP_SOURCE="$SRC" \
    CLAUDE_ENV_FILE="$ENV_FILE" \
    ${passthrough[@]+"${passthrough[@]}"} \
    bash "$SELF_HOOK" >"$second_out" 2>/dev/null
  if [ -s "$second_out" ]; then
    fail "a second run over a fresh marker printed a duplicate line: $(head -c 120 "$second_out")"
  else
    pass "a second run over a fresh marker is a silent no-op"
  fi
fi

# ------------------------------------------------------------ 6. session-check ------------------
# The copy the bootstrap installed, run against a minimal fixture repo: the subject is the
# cloud-bootstrap block, not this checkout's git state, tests or tracker.
CHECK="$CLEAN_HOME/.claude/skills/session-check/check.js"
mkdir -p "$FIXTURE/.git" "$FIXTURE/.claude"
echo '{"harness": false}' > "$FIXTURE/.claude/session.json"
if [ ! -f "$CHECK" ]; then
  fail "session-check was not installed at $CHECK"
else
  check_out="$SCRATCH/session-check.txt"
  ( cd "$FIXTURE" && env -i \
      PATH="$CLEAN_HOME/.local/bin:$PATH_SHIM" \
      HOME="$CLEAN_HOME" \
      CLAUDE_CODE_REMOTE_SESSION_ID=ci-bootstrap-gate \
      BOOTSTRAP_MASTER_MANIFEST="$PAYLOAD/.claude-plugin/plugin.json" \
      node "$CHECK" ) >"$check_out" 2>&1
  check_status=$?
  version="$(python3 -c "import json,os,sys; print(json.load(open(sys.argv[1]))['version'])" "$PAYLOAD/.claude-plugin/plugin.json")"
  if [ "$check_status" -ne 0 ]; then
    fail "session-check exited $check_status (STOP lines: $(grep -c 'STOP' "$check_out"))"
    grep -n 'STOP' "$check_out" | head -10 >&2
  else
    pass "session-check exited 0"
  fi
  if grep -qF "aac-bootstrap payload v$version" "$check_out"; then
    pass "session-check quotes the payload version: $(grep -F "aac-bootstrap payload v$version" "$check_out" | sed 's/^ *//')"
    grep -F 'payload matches dotfiles master' "$check_out" | sed 's/^ */        /'
  else
    fail "session-check printed no 'aac-bootstrap payload v$version' line"
    sed -n '1,40p' "$check_out" >&2
  fi

  # The --end mechanical gate (issue 622) ships in the payload, so the container has it too.
  # Point its hook check at a fixture profile tree naming a hook script that is not there: it must
  # STOP. A gate never seen to fail is not known to work, and "the file is missing" is the half
  # that needs no Python on this PATH to decide.
  gate_root="$SCRATCH/end-gate-fixture"
  mkdir -p "$gate_root/profile/claude/hooks"
  printf '{"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"python3 \\"$HOME/.claude/hooks/gone.py\\""}]}]}}\n' \
    > "$gate_root/profile/claude/settings.json"
  gate_out="$SCRATCH/session-check-end-gate.txt"
  ( cd "$FIXTURE" && env -i \
      PATH="$CLEAN_HOME/.local/bin:$PATH_SHIM" \
      HOME="$CLEAN_HOME" \
      CLAUDE_CODE_REMOTE_SESSION_ID=ci-bootstrap-gate \
      BOOTSTRAP_MASTER_MANIFEST="$PAYLOAD/.claude-plugin/plugin.json" \
      SESSION_END_GATE_ROOT="$gate_root" \
      node "$CHECK" --end ) >"$gate_out" 2>&1
  if grep -q 'gone.py' "$gate_out" && grep -q 'not on disk' "$gate_out"; then
    pass "the --end gate STOPs on a hook script the settings name and nothing provides"
  else
    fail "the --end gate did not report the missing hook script (issue 622)"
    sed -n '1,40p' "$gate_out" >&2
  fi
fi

# ------------------------------------------------- 7. the merged hooks actually execute ---------
# Each merged SessionStart and UserPromptSubmit command, run the way Claude Code runs a settings
# hook: `sh -c`, the hook event JSON on stdin, from the repo. The seat the bootstrap wrote
# (CLAUDE_PLUGIN_ROOT=... PLUGIN_HOOK_GUARD_DISABLE=1, absolute script paths) is the whole
# reason these exit 0 from an empty home; the v27-v29 verbatim copy could not start.
merged_cmds="$SCRATCH/merged-commands.txt"
python3 - "$CLEAN_HOME/.claude/settings.json" >"$merged_cmds" <<'PYLIST'
import json, sys
s = json.load(open(sys.argv[1]))
for event in ('SessionStart', 'UserPromptSubmit'):
    for group in s.get('hooks', {}).get(event, []):
        if group.get('_source') != 'aac-bootstrap-plugin-hook':
            continue
        for h in group.get('hooks', []):
            print(event + '\t' + h['command'])
PYLIST
ran=0; broke=0
while IFS=$'\t' read -r event cmd; do
  [ -n "$cmd" ] || continue
  ran=$((ran + 1))
  out="$SCRATCH/hook-run-$ran.txt"
  ( cd "$FIXTURE" && printf '{"session_id":"ci-bootstrap-gate","hook_event_name":"%s","prompt":"gate","cwd":"%s"}' "$event" "$FIXTURE" \
      | env -i PATH="$CLEAN_HOME/.local/bin:$PATH_SHIM" HOME="$CLEAN_HOME" \
              CLAUDE_CODE_REMOTE_SESSION_ID=ci-bootstrap-gate CLAUDE_PROJECT_DIR="$FIXTURE" \
              timeout 120 sh -c "$cmd" ) >"$out" 2>&1
  rc=$?
  short="$(printf '%s' "$cmd" | sed -E 's#^CLAUDE_PLUGIN_ROOT=[^ ]+ PLUGIN_HOOK_GUARD_DISABLE=1 ##' | sed "s#$PAYLOAD/hooks/scripts/##" | cut -c1-70)"
  if [ "$rc" -eq 0 ] && ! grep -qF '${CLAUDE_PLUGIN_ROOT}' "$out"; then
    pass "$event hook ran: $short"
  else
    broke=$((broke + 1))
    fail "$event hook exited $rc: $short — $(head -c 160 "$out" | tr '\n' ' ')"
  fi
done <"$merged_cmds"
if [ "$ran" -eq 0 ]; then
  fail "no merged SessionStart/UserPromptSubmit command found to execute"
elif [ "$broke" -eq 0 ]; then
  pass "all $ran merged SessionStart/UserPromptSubmit hooks executed from the clean home"
fi

# ------------------------------------------------------------------- verdict --------------------
echo ""
if [ "$fails" -eq 0 ]; then
  echo "bootstrap gate: PASS"
else
  echo "bootstrap gate: FAIL ($fails check(s))"
fi

if [ -z "${BOOTSTRAP_TEST_KEEP:-}" ]; then
  rm -rf "$SCRATCH" 2>/dev/null || true
fi

[ "$fails" -eq 0 ] || exit 1
exit 0
