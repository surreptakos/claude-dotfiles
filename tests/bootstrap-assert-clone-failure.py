"""Assertions for the bootstrap gate's clone-failure scenario (issue 483). Driven by
`tests/bootstrap-test.sh --scenario clone-failure`. Reads two paths from the environment and
reports one `pass`/`FAIL` line per assertion, exiting 1 if any failed:

  BOOTSTRAP_TEST_MARKER     the marker the hook wrote under the clean home
  BOOTSTRAP_TEST_HOOK_OUT   the hook's stdout (the SessionStart additionalContext JSON)

What a failed clone must leave behind: a marker with `failed: true`, `stage: clone`, a reason
naming the clone command and git's own last line, `failed_at`, an empty `skills` list and a
`gh_path`; and exactly one JSON line on stdout whose additionalContext is the STOP sentence
naming the fallbacks. Everything here reads observable state only.
"""
import json
import os
import sys

MARKER = os.environ['BOOTSTRAP_TEST_MARKER']
HOOK_OUT = os.environ['BOOTSTRAP_TEST_HOOK_OUT']
fails = []


def pass_(msg):
    print(f'  pass  {msg}')


def fail(msg):
    print(f'  FAIL  {msg}', file=sys.stderr)
    fails.append(msg)


try:
    with open(MARKER) as f:
        marker = json.load(f)
except Exception as e:  # noqa: BLE001
    fail(f'no readable marker at {MARKER}: {e}')
    sys.exit(1)

if marker.get('failed') is True and marker.get('stage') == 'clone':
    pass_('marker records failed=true stage=clone')
else:
    fail(f"marker is not a clone failure: failed={marker.get('failed')!r} stage={marker.get('stage')!r}")

reason = marker.get('reason') or ''
if 'git clone' in reason and 'no-such-repo.git' in reason and ('fatal' in reason or 'not' in reason.lower()):
    pass_(f"marker reason names the command and git's last line: {reason[:110]}")
else:
    fail(f"marker reason does not name the clone command and git's last line: {reason!r}")

if marker.get('failed_at') and marker.get('skills') == [] and 'gh_path' in marker:
    pass_(f"marker carries failed_at, an empty skills list and gh_path={marker['gh_path']!r}")
else:
    fail(f'marker lacks failed_at / skills=[] / gh_path: {sorted(marker)}')

with open(HOOK_OUT) as f:
    lines = [l for l in f.read().splitlines() if l.strip()]
if len(lines) != 1:
    fail(f'hook stdout is {len(lines)} non-empty lines, expected exactly one JSON line')
else:
    ctx = ''
    try:
        ctx = json.loads(lines[0])['hookSpecificOutput']['additionalContext']
    except Exception as e:  # noqa: BLE001
        fail(f'hook stdout is not the SessionStart JSON shape: {e}')
    if ctx.startswith('AAC-BOOTSTRAP STOP: clone failed') and 'push_files' in ctx and 'ANTHROPIC_BASE_URL' in ctx:
        pass_(f'additionalContext is the STOP line: {ctx[:100]}...')
    elif ctx:
        fail(f'additionalContext is not the STOP line: {ctx[:160]}')
    # Issue 614: the line is the self-heal, not just the diagnosis - it names the add_repo call
    # and the exact re-run command (this hook by its own path), since the session git proxy
    # ignores credentials in a clone URL and only an attached source authenticates.
    if 'add_repo' in ctx and 'claude-dotfiles' in ctx and 'bash "' in ctx and 'session-start' in ctx:
        pass_('the STOP line carries the self-heal: add_repo claude-dotfiles, then re-run the hook by path')
    elif ctx:
        fail(f'the STOP line lacks the add_repo / re-run self-heal: {ctx[:200]}')
    if len(ctx) > 2000:
        fail(f'additionalContext is {len(ctx)} chars, over the 2KB cap')

sys.exit(1 if fails else 0)
