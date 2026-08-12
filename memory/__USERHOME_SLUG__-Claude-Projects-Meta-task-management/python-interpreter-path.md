---
name: python-interpreter-path
description: "Bare `python` now works on this machine (resolves to real Python 3.12.10, MS Store stub no longer shadows it); `python3` still doesn't exist. Full interpreter path still valid."
metadata: 
  node_type: memory
  type: reference
  originSessionId: 9ea4bdb6-2369-4650-9b9e-7a4c8ff48269
  modified: 2026-07-23T16:49:54.039Z
---

**RESOLVED 2026-07-23 (verified in Git Bash):** bare `python` now runs the real
interpreter — `which python` → `__USERHOME__\AppData\Local\Programs\Python\
Python312\python`, `python --version` → Python 3.12.10, and it executes code
(no more "Python was not found" stub). The Python312 dir now precedes the
Microsoft Store `WindowsApps` alias on PATH, so the stub no longer shadows it.
So `python -m aacx …` and `python script.py` work directly.

Caveats:
- **`python3` does NOT exist** — `command not found` (it's absent, not a stub).
  Use `python`, never `python3`.
- The canonical full path still works and stays the safest choice for anything
  that must not depend on PATH order (scheduled tasks / cron / a fresh shell):
  `__USERHOME__\AppData\Local\Programs\Python\Python312\python.exe`
  (Python 3.12.10, with `docx`/`typer`/`yaml`/`jinja2` installed).
- Running a script FILE from outside the repo needs the repo on PYTHONPATH
  (`PYTHONPATH=<repo> python script.py`) since a `.py` file puts its own dir —
  not cwd — on sys.path; `python -m aacx` from the repo root is unaffected.

See [[o3-routines-full-playbook]].
