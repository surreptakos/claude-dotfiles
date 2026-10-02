#!/usr/bin/env python3
"""Claude Code hook: the design gate. Forces every deliverable through aac-design.

    python3 designgate.py write     # PostToolUse, matcher Write|Edit|MultiEdit
    python3 designgate.py stop      # Stop

A deliverable is a .docx, .pptx, .html or .htm file inside an opted-in folder: one that
holds, or sits under a folder that holds, the marker file `.aac-design` (issue 1082). Outside
one both modes exit 0 without reading the file, so a code repository's .html sources never
meet the gate.

- **write:** lints the file just written with designlint.py. Errors exit 2, and the
  findings go back to Claude on stderr, so it fixes the file before moving on.
- **stop:** before the turn can end, collects every deliverable changed this turn: the
  files named in this turn's tool calls, plus a modified-time scan of the working
  directory and a sibling `outputs` folder. A git pull, checkout or merge gives a file a
  fresh mtime without the session touching it (issue 1151), so a candidate that is
  tracked and unmodified in its git checkout (tracked, and `git diff --quiet HEAD --
  <path>` exits 0) is dropped unless a tool call this turn wrote it: Write, Edit,
  MultiEdit or NotebookEdit naming it, or a Bash command naming it as a `>` or `>>`
  redirect target. A path only mentioned in a read-only command (`ls`, `cat`,
  `git log -- <path>`) is not a write. Untracked and modified files, and files outside a
  git checkout, keep the mtime scan. Each remaining one must
  1. lint clean, and
  2. carry a passing critique stamp, `.design/<file name>.json`, whose sha256 matches
     the file's current bytes. `score.py --stamp FILE` writes it only when the release
     gate passes.
  A missing or stale stamp exits 2 with the instruction to run the aac-design critique.

Inside a marked folder the only files skipped are temporary ones: paths under a temp,
render or .design directory below the marker, and Office lock files (~$*). Folders above
the marker do not count, so a folder marked on purpose is gated wherever it lives. The loop guard lets a turn end after three
consecutive blocks, and says so loudly, so a broken linter cannot wedge a session.
Standard library only; fails open (exit 0, message on stderr) when it cannot read its
own input.
"""
import hashlib, json, os, re, subprocess, sys, tempfile, time

try:
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
EXTS = ('.docx', '.pptx', '.html', '.htm')
SKIP_PARTS = re.compile(r'[\\/](tmp|temp|render|\.design|node_modules|\.git)[\\/]', re.I)
MAX_BLOCKS = 3
MARKER = '.aac-design'
STATE = os.path.join(tempfile.gettempdir(), 'aac-design-gate')


def payload():
    raw = sys.stdin.buffer.read()
    for enc in ('utf-8', 'utf-8-sig', 'utf-16'):
        try:
            return json.loads(raw.decode(enc) or '{}')
        except Exception:
            continue
    raise ValueError('design gate: hook payload is not JSON')


def marked_root(p):
    """The nearest folder at or above the file's own that holds the MARKER file, else None."""
    d = os.path.dirname(os.path.abspath(p))
    while True:
        if os.path.isfile(os.path.join(d, MARKER)):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def is_deliverable(p):
    base = os.path.basename(p)
    if not (p.lower().endswith(EXTS) and not base.startswith('~$') and os.path.isfile(p)):
        return False
    root = marked_root(p)
    return root is not None and not SKIP_PARTS.search(os.sep + os.path.relpath(os.path.abspath(p), root))


def sha256(p):
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def stamp_path(p):
    return os.path.join(os.path.dirname(os.path.abspath(p)), '.design', os.path.basename(p) + '.json')


def stamp_ok(p):
    sp = stamp_path(p)
    try:
        s = json.load(open(sp, encoding='utf-8'))
    except (OSError, ValueError):
        return False, 'no critique stamp'
    if s.get('sha256') != sha256(p):
        return False, 'critique stamp is for an earlier version of the file'
    if not s.get('passes'):
        return False, 'critique stamp records a failed gate'
    return True, ''


def lint_errors(p):
    import designlint
    try:
        found = designlint.lint(p)
    except Exception as e:
        return [{'rule': 'READ', 'what': f'cannot lint: {e}', 'where': p, 'detail': '', 'why': ''}]
    return [x for x in found if x['severity'] == 'error']


def fmt(errors):
    """One line per rule: count, the fix to look up, and up to three examples."""
    by = {}
    for x in errors:
        by.setdefault(x['rule'], []).append(x)
    out = []
    for rule, xs in sorted(by.items()):
        ex = '; '.join(f'"{x["where"][:50]}"' for x in xs[:3])
        out.append(f"  [{rule}] {xs[0]['what']} x{len(xs)} ({xs[0]['why']}): {ex}")
    return '\n'.join(out)


# ------------------------------------------------------------------ write
def on_write(data):
    ti = data.get('tool_input') or {}
    p = ti.get('file_path') or ti.get('filePath') or ''
    if not p or not is_deliverable(p):
        return 0
    errs = lint_errors(p)
    if not errs:
        return 0
    sys.stderr.write(f'design gate FAILED on {p}\n{len(errs)} design error(s). Fix each, then rewrite the file '
                     f'(rules and fixes: aac-design TELLS.md):\n{fmt(errs)}\n')
    return 2


# ------------------------------------------------------------------ stop
def turn_entries(transcript):
    """Entries after the last real user message, and that message's timestamp."""
    try:
        lines = open(transcript, encoding='utf-8').read().splitlines()
    except OSError:
        return [], None
    entries = []
    for line in lines:
        try:
            entries.append(json.loads(line))
        except Exception:
            pass
    start, ts = 0, None
    for i, e in enumerate(entries):
        if e.get('type') == 'user':
            c = (e.get('message') or {}).get('content')
            is_tool_result = isinstance(c, list) and any(isinstance(x, dict) and x.get('type') == 'tool_result' for x in c)
            if not is_tool_result:
                start, ts = i, e.get('timestamp')
    return entries[start:], ts


def paths_in(obj):
    out = set()
    if isinstance(obj, dict):
        for v in obj.values():
            out |= paths_in(v)
    elif isinstance(obj, list):
        for v in obj:
            out |= paths_in(v)
    elif isinstance(obj, str):
        for m in re.finditer(r'([A-Za-z]:[\\/][^\s"\'<>|*?]+?\.(?:docx|pptx|html?)|/[^\s"\'<>|*?]+?\.(?:docx|pptx|html?))\b', obj, re.I):
            out.add(m.group(1))
    return out


WRITE_TOOLS = ('Write', 'Edit', 'MultiEdit', 'NotebookEdit')
REDIRECT = re.compile(r'>>?\s*(?:"([^"]+)"|\'([^\']+)\'|([^\s"\'<>|;&]+))')


def norm(p, cwd):
    return os.path.normcase(os.path.abspath(os.path.join(cwd, p)))


def written_paths(x, cwd):
    """The paths one tool_use block wrote: a write tool's target, or a Bash redirect target."""
    ti = x.get('input') if isinstance(x.get('input'), dict) else {}
    if x.get('name') in WRITE_TOOLS:
        p = ti.get('file_path') or ti.get('filePath') or ti.get('notebook_path') or ''
        return {norm(p, cwd)} if p else set()
    if x.get('name') == 'Bash':
        return {norm(next(g for g in m.groups() if g), cwd) for m in REDIRECT.finditer(ti.get('command') or '')}
    return set()


def git_clean(p):
    """True when the file is tracked in its git checkout and matches HEAD. Any git failure,
    no checkout at all included, reads as not clean, so the file stays gated."""
    d, f = os.path.split(os.path.abspath(p))
    try:
        for args in (['ls-files', '--error-unmatch', '--', f], ['diff', '--quiet', 'HEAD', '--', f]):
            r = subprocess.run(['git', '-C', d] + args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            if r.returncode != 0:
                return False
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def to_epoch(ts):
    if not ts:
        return time.time() - 3 * 3600
    try:
        from datetime import datetime
        return datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp()
    except Exception:
        return time.time() - 3 * 3600


def recent_files(roots, since):
    out = set()
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if not x.startswith('.') and x.lower() not in ('node_modules', 'tmp', 'temp', 'render')]
            if d.count(os.sep) - root.count(os.sep) >= 3:
                dirs[:] = []
            for fn in files:
                p = os.path.join(d, fn)
                try:
                    if fn.lower().endswith(EXTS) and os.path.getmtime(p) >= since:
                        out.add(p)
                except OSError:
                    pass
    return out


def block_count(session, reset=False):
    os.makedirs(STATE, exist_ok=True)
    f = os.path.join(STATE, re.sub(r'[^A-Za-z0-9_-]', '_', session or 'none') + '.count')
    if reset:
        try: os.remove(f)
        except OSError: pass
        return 0
    n = int(open(f).read() or 0) + 1 if os.path.exists(f) else 1
    open(f, 'w').write(str(n))
    return n


def on_stop(data):
    session = data.get('session_id', '')
    entries, ts = turn_entries(data.get('transcript_path') or '')
    cwd = data.get('cwd') or os.getcwd()
    named, written = set(), set()
    for e in entries:
        c = (e.get('message') or {}).get('content')
        if isinstance(c, list):
            for x in c:
                if isinstance(x, dict) and x.get('type') == 'tool_use':
                    named |= paths_in(x.get('input'))
                    written |= written_paths(x, cwd)
    roots = {cwd, os.environ.get('CLAUDE_PROJECT_DIR', ''), os.path.join(os.path.dirname(cwd), 'outputs')}
    roots |= {r for r in os.environ.get('DESIGN_GATE_DIRS', '').split(os.pathsep) if r}
    candidates = {p for p in named | recent_files(roots, to_epoch(ts) - 5) if is_deliverable(p)}
    # A tracked file that matches HEAD changed only through git (a pull, checkout or merge)
    # unless this turn wrote it (issue 1151).
    candidates = {p for p in candidates if norm(p, cwd) in written or not git_clean(p)}
    problems = []
    for p in sorted(candidates):
        errs = lint_errors(p)
        ok, why = stamp_ok(p)
        if errs or not ok:
            problems.append((p, errs, why))
    if not problems:
        block_count(session, reset=True)
        return 0
    n = block_count(session)
    msg = ['design gate: these deliverables changed this turn and are not cleared for release.',
           'Load the aac-design skill and finish its steps for each file: fix every design error, run the',
           'critique, and let score.py --stamp write the passing stamp. Then end the turn.']
    for p, errs, why in problems:
        msg.append(f'- {p}')
        if errs:
            msg.append(f'  {len(errs)} design error(s):\n{fmt(errs)}')
        if why:
            msg.append(f'  critique: {why} (expected {stamp_path(p)})')
    if n > MAX_BLOCKS:
        block_count(session, reset=True)
        sys.stderr.write('\n'.join(msg) + f'\nDESIGN GATE OVERRIDDEN after {MAX_BLOCKS} blocks. Tell the user, in the reply, '
                         'which files shipped without clearing the gate and why.\n')
        return 0
    sys.stderr.write('\n'.join(msg) + '\n')
    return 2


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        data = payload()
    except Exception as e:
        sys.stderr.write(f'{e}\n')
        return 0
    if mode == 'write':
        return on_write(data)
    if mode == 'stop':
        return on_stop(data)
    sys.stderr.write('design gate: mode must be "write" or "stop"\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
