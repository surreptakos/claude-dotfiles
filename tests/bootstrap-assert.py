#!/usr/bin/env python3
"""Assertions for the bootstrap gate (issue 211). Driven by tests/bootstrap-test.sh.

Reads five paths from the environment and reports one `pass`/`FAIL` line per assertion,
exiting 1 if any failed:

  BOOTSTRAP_TEST_HOME       the clean home the hook was pointed at
  BOOTSTRAP_TEST_PAYLOAD    the marketplace/aac-skills copy the hook read
  BOOTSTRAP_TEST_ENV_FILE   the $CLAUDE_ENV_FILE the hook appended its PATH export to
  BOOTSTRAP_TEST_HOOK_OUT   the hook's stdout (the SessionStart additionalContext JSON)

Everything here reads observable state only. Nothing imports the hook or the payload's code.
"""

import json
import os
import re
import sys

HOME = os.environ['BOOTSTRAP_TEST_HOME']
PAYLOAD = os.environ['BOOTSTRAP_TEST_PAYLOAD']
ENV_FILE = os.environ['BOOTSTRAP_TEST_ENV_FILE']
HOOK_OUT = os.environ['BOOTSTRAP_TEST_HOOK_OUT']

SKILLS_DIR = os.path.join(HOME, '.claude', 'skills')
SETTINGS = os.path.join(HOME, '.claude', 'settings.json')
MARKER = os.path.join(HOME, '.claude', 'hook-state', 'aac-bootstrap', 'state.json')
SOURCE_TAG = 'aac-bootstrap-plugin-hook'

# The governance hook set spec #207 names — the eight entries (session gate start and end, state
# rehydrate, state stash, governance reminder, ask-matt gate on prompt, pre-tool, post-tool and
# stop) plus the prompt gate, the memory loader, and the rules delivery: the full text at
# SessionStart and the digest per prompt (issues 209, 533).
# Hard-coded on purpose: see the header of tests/bootstrap-test.sh.
REQUIRED_HOOKS = [
    ('SessionStart', r'session-gate\.js"?\s+start', 'session gate (start)'),
    ('SessionStart', r'state-rehydrate\.js', 'state rehydrate'),
    ('SessionStart', r'repo-memory-load\.js', 'repo memory loader'),
    ('SessionStart', r'global-rules\.js"?\s+start\s+1', 'global rules, full text (part 1)'),
    ('UserPromptSubmit', r'governance-reminder\.js', 'governance reminder'),
    ('UserPromptSubmit', r'ask_matt_gate\.py"?\s+claude-prompt', 'ask-matt gate (prompt)'),
    ('UserPromptSubmit', r'session-gate\.js"?\s+prompt', 'session gate (prompt)'),
    ('UserPromptSubmit', r'global-rules\.js"?\s+digest', 'global rules digest (per prompt)'),
    ('PreToolUse', r'ask_matt_gate\.py"?\s+claude-pre-tool', 'ask-matt gate (pre-tool)'),
    ('PostToolUse', r'ask_matt_gate\.py"?\s+claude-post-tool', 'ask-matt gate (post-tool)'),
    ('Stop', r'ask_matt_gate\.py"?\s+claude-stop', 'ask-matt gate (stop)'),
    ('PreCompact', r'state-stash\.js', 'state stash (pre-compact)'),
    ('SessionEnd', r'session-gate\.js"?\s+end', 'session gate (end)'),
    ('SessionEnd', r'state-stash\.js', 'state stash (session end)'),
]

# Skills the governance and the fleet dispatch by name; a payload missing one of these is not a
# governed container even if every other skill copied.
REQUIRED_SKILLS = ['session-check', 'project-harness', 'ticket-fleet', 'caveman']

fails = []


def pass_(msg):
    print(f'  pass  {msg}')


def fail(msg):
    print(f'  FAIL  {msg}', file=sys.stderr)
    fails.append(msg)


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ----------------------------------------------------------- 1. the additionalContext line -----
try:
    doc = read_json(HOOK_OUT)
    out = doc['hookSpecificOutput']
    ctx = out['additionalContext']
    if out.get('hookEventName') != 'SessionStart':
        fail(f"hook stdout hookEventName is {out.get('hookEventName')!r}, not SessionStart")
    elif not ctx.strip():
        fail('hook stdout carries an empty additionalContext')
    elif len(ctx.encode()) > 2000:
        fail(f'additionalContext is {len(ctx.encode())} bytes, over the 2 KB platform cap')
    else:
        pass_(f'one SessionStart additionalContext line, {len(ctx.encode())} bytes')
except Exception as e:  # noqa: BLE001 - any shape problem is the same failure
    fail(f'hook stdout is not the SessionStart JSON: {e}')

# ------------------------------------------------------------------ 2. skills on disk ----------
marker = None
try:
    marker = read_json(MARKER)
except Exception as e:  # noqa: BLE001
    fail(f'no readable bootstrap marker at {MARKER}: {e}')

if marker is not None:
    named = marker.get('skills') or []
    if not named:
        fail('the marker names no skills')
    else:
        absent = [n for n in named
                  if not os.path.isfile(os.path.join(SKILLS_DIR, n, 'SKILL.md'))]
        if absent:
            fail(f'{len(absent)} skill(s) the marker names are absent from {SKILLS_DIR}: '
                 + ', '.join(absent[:8]))
        else:
            pass_(f'{len(named)} payload skills installed under {SKILLS_DIR}')

    missing_core = [s for s in REQUIRED_SKILLS
                    if not os.path.isfile(os.path.join(SKILLS_DIR, s, 'SKILL.md'))]
    if missing_core:
        fail('load-bearing skill(s) not installed: ' + ', '.join(missing_core))
    else:
        pass_('load-bearing skills installed: ' + ', '.join(REQUIRED_SKILLS))

# ------------------------------------------------------ 3. governance hooks in user settings ----
settings = None
try:
    settings = read_json(SETTINGS)
except Exception as e:  # noqa: BLE001
    fail(f'no readable user settings at {SETTINGS}: {e}')

if settings is not None:
    events = settings.get('hooks') or {}
    # Only the entries this bootstrap merged count; anything else in a container's settings is
    # not the payload's doing.
    merged = {}
    untagged = []
    for event, groups in events.items():
        for group in groups or []:
            if not isinstance(group, dict):
                continue
            commands = [h.get('command', '') for h in (group.get('hooks') or [])
                        if isinstance(h, dict)]
            if group.get('_source') == SOURCE_TAG:
                merged.setdefault(event, []).extend(commands)
            else:
                untagged.append((event, commands))

    absent = [label for event, pattern, label in REQUIRED_HOOKS
              if not any(re.search(pattern, c) for c in merged.get(event, []))]
    if absent:
        fail(f'{len(absent)} governance hook entr(y/ies) missing from {SETTINGS}: '
             + '; '.join(absent))
    else:
        pass_(f'all {len(REQUIRED_HOOKS)} governance hook entries merged into user settings, '
              f'tagged _source={SOURCE_TAG}')

    # Seated for settings.json (issue 614). Claude Code refuses a settings.json hook whose command
    # carries the literal ${CLAUDE_PLUGIN_ROOT} ("not associated with a plugin"), which is what
    # every merged entry carried from v27 to v29 while this gate reported them present. A merged
    # command that names a payload script must spell the payload's absolute path, export
    # CLAUDE_PLUGIN_ROOT for the scripts that read it, and disable the payload's dedup guard,
    # which otherwise exits silently because settings.json names the script.
    payload_abs = os.path.abspath(PAYLOAD)
    all_merged = [c for commands in merged.values() for c in commands]
    literal = [c for c in all_merged if '${CLAUDE_PLUGIN_ROOT}' in c]
    scripted = [c for c in all_merged if payload_abs + '/hooks/scripts/' in c]
    unseated = [c for c in scripted
                if not c.startswith('CLAUDE_PLUGIN_ROOT=') or 'PLUGIN_HOOK_GUARD_DISABLE=1 ' not in c]
    if literal:
        fail(f'{len(literal)} merged command(s) still carry the literal ${{CLAUDE_PLUGIN_ROOT}}, '
             f'which Claude Code refuses in settings.json: {literal[0][:90]}')
    elif not scripted:
        fail(f'no merged command names a script under {payload_abs}/hooks/scripts/')
    elif unseated:
        fail(f'{len(unseated)} merged command(s) lack the CLAUDE_PLUGIN_ROOT=... '
             f'PLUGIN_HOOK_GUARD_DISABLE=1 seat: {unseated[0][:90]}')
    else:
        pass_(f'{len(scripted)} merged commands spell {payload_abs} and carry the seat '
              f'(CLAUDE_PLUGIN_ROOT + PLUGIN_HOOK_GUARD_DISABLE=1)')
    if marker is not None and marker.get('plugin_root') != payload_abs:
        fail(f"the marker records plugin_root={marker.get('plugin_root')!r}, not {payload_abs!r}")

    if untagged:
        fail(f'{len(untagged)} hook group(s) in user settings carry no {SOURCE_TAG} tag — a '
             'second bootstrap run would append duplicates instead of replacing them')
    else:
        pass_('every hook group in user settings is tagged, so a second run replaces its own')

    # A merged command is worthless if the script it names did not travel with the payload.
    dangling = set()
    for commands in merged.values():
        for command in commands:
            for hit in re.findall(re.escape(payload_abs) + r'/([A-Za-z0-9_./-]+)', command):
                if not os.path.isfile(os.path.join(payload_abs, hit)):
                    dangling.add(hit)
    if dangling:
        fail('hook command(s) name scripts the payload does not carry: '
             + ', '.join(sorted(dangling)))
    else:
        pass_('every merged hook command names a script the payload carries')

    # ask_matt_gate.py imports jev.py from its own directory (issue 723). No hook command names
    # the library, so the check above cannot see it missing; without it the gate's YES lint
    # silently falls back to the regexes in every cloud session.
    jev_lib = os.path.join(payload_abs, 'hooks', 'scripts', 'jev.py')
    if not os.path.isfile(jev_lib):
        fail(f'the payload carries no Jev helper beside ask_matt_gate.py at {jev_lib}')
    elif b'_plugin_hook_guard' in open(jev_lib, 'rb').read():
        fail(f'{jev_lib} carries the dedup guard: it is a library, not a governance hook')
    else:
        pass_('the Jev helper ships beside ask_matt_gate.py as a library (issue 723)')

# ------------------------------------------ 3b. the home-anchored seat (issue 643) -------------
# Delivery must not depend on which checkout Claude Code calls the project. The hook copies
# itself to ~/.claude/hooks/aac-bootstrap.sh and seats THAT as a SessionStart entry in user
# settings, so a session whose project dir is not a harnessed repo - a Routine-fired session with
# two repository sources, or none - still bootstraps instead of running on whatever the container
# image carried (2026-09-21: a Routine session read a 2026-09-19 clone-failure marker for two
# days and said nothing).
SELF_HOOK = os.path.join(HOME, '.claude', 'hooks', 'aac-bootstrap.sh')
CANONICAL_HOOK = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                              '.claude', 'hooks', 'session-start.sh')
if not os.path.isfile(SELF_HOOK):
    fail(f'the hook seated no copy of itself at {SELF_HOOK}')
elif not os.access(SELF_HOOK, os.X_OK):
    fail(f'{SELF_HOOK} is not executable, so its settings.json entry cannot run it')
else:
    seated = open(SELF_HOOK, 'rb').read()
    canonical = open(CANONICAL_HOOK, 'rb').read() if os.path.isfile(CANONICAL_HOOK) else b''
    if canonical and seated != canonical:
        fail(f'{SELF_HOOK} is not byte-identical to the hook that ran ({CANONICAL_HOOK})')
    else:
        pass_(f'the hook seated an executable copy of itself at {SELF_HOOK}')

if settings is not None:
    self_entries = [c for c in merged.get('SessionStart', []) if SELF_HOOK in c]
    if not self_entries:
        fail(f'no tagged SessionStart entry in {SETTINGS} runs {SELF_HOOK}, so a session whose '
             'project dir is not a harnessed repo never bootstraps')
    elif len(self_entries) > 1:
        fail(f'{len(self_entries)} SessionStart entries run {SELF_HOOK}; a second run must '
             'replace its own entry, not append another')
    elif not self_entries[0].startswith('bash '):
        fail(f'the seated entry does not invoke it through bash: {self_entries[0][:90]}')
    else:
        pass_(f'one tagged SessionStart entry runs the home-anchored copy: {self_entries[0]}')

if marker is not None and marker.get('self_hook') != SELF_HOOK:
    fail(f"the marker records self_hook={marker.get('self_hook')!r}, not {SELF_HOOK!r}")

# ------------------------------------------------------------------ 4. the rules text ----------
rules = os.path.join(PAYLOAD, 'rules', 'global-rules.md')
if not os.path.isfile(rules) or os.path.getsize(rules) == 0:
    fail(f'no global rules text in the payload at {rules}')
else:
    first = open(rules, encoding='utf-8').readline().strip()
    pass_(f'rules text present ({os.path.getsize(rules)} bytes), first line: {first!r}')
    # Issue 680: the ADHD off switch has to be named where a container session reads it.
    reminder = os.path.join(PAYLOAD, 'hooks', 'scripts', 'governance-reminder.js')
    unnamed = [p for p in (rules, reminder) if not os.path.isfile(p)
               or '"stop adhd mode"' not in open(p, encoding='utf-8').read()]
    if unnamed:
        fail('the ADHD off switch ("stop adhd mode") is not named in: ' + ', '.join(unnamed))
    else:
        pass_('the rules text and the per-turn reminder name the ADHD off switch (issue 680)')

# The per-prompt digest (issue 533). Without it every prompt would go back to carrying the whole
# rulebook, or -- worse -- carry nothing, since the UserPromptSubmit entry now asks for the digest.
DIGEST_CAP = 1500
digest = os.path.join(PAYLOAD, 'rules', 'global-rules-digest.md')
if not os.path.isfile(digest):
    fail(f'no per-prompt rules digest in the payload at {digest}')
elif os.path.getsize(digest) > DIGEST_CAP:
    fail(f'the per-prompt rules digest is {os.path.getsize(digest)} bytes, over {DIGEST_CAP}')
else:
    pass_(f'per-prompt rules digest present ({os.path.getsize(digest)} bytes, cap {DIGEST_CAP})')

# ------------------------------------------------------------------ 5. gh -----------------------
gh = os.path.join(HOME, '.local', 'bin', 'gh')
expected_export = f'export PATH="{os.path.join(HOME, ".local", "bin")}:$PATH"'
try:
    env_lines = open(ENV_FILE, encoding='utf-8').read().splitlines()
except Exception as e:  # noqa: BLE001
    env_lines = []
    fail(f'cannot read the env file {ENV_FILE}: {e}')
exports = [l for l in env_lines if l == expected_export]
if len(exports) != 1:
    fail(f'$CLAUDE_ENV_FILE carries {len(exports)} copies of {expected_export!r}, expected 1')
elif not (os.path.isfile(gh) and os.access(gh, os.X_OK)):
    fail(f'no executable gh at {gh} — the hook exported a PATH with nothing on it')
elif marker is not None and not (marker.get('gh_path') or '').startswith(HOME):
    fail(f"the marker records gh at {marker.get('gh_path')!r}, outside the bootstrapped home")
else:
    pass_(f'gh installed at {gh} and exported through $CLAUDE_ENV_FILE')

sys.exit(1 if fails else 0)
