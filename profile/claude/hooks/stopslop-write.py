#!/usr/bin/env python3
"""
Claude Code PostToolUse hook (matcher: Write|Edit|MultiEdit).

Lints any .md / .txt / .markdown file Claude writes. If the deterministic
stop-slop linter finds ERROR-severity hits, this exits 2, which blocks the
turn and feeds the findings back to Claude on stderr so it rewrites the file.

Portable (Windows/macOS/Linux): invoked as `python <thisfile>`; imports the
linter directly from ../tools/stopslop.py (no subprocess, no shell, no jq,
no reliance on shebangs or $HOME expansion).
"""
import sys
import os
import json

# stderr must be UTF-8 so matched tokens (em dashes, curly quotes) never raise
# UnicodeEncodeError under the Windows console code page and crash the hook.
try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(os.path.dirname(HERE), "tools")
sys.path.insert(0, TOOLS)

LINT_EXTS = (".md", ".txt", ".markdown")


def main():
    try:
        import stopslop
    except Exception as e:
        # Linter missing/broken: fail open (don't wedge the session) but say so.
        sys.stderr.write(f"stop-slop hook: could not load linter: {e}\n")
        return 0

    try:
        data = stopslop.decode_payload(sys.stdin.buffer.read())
    except Exception as e:
        # Fail open, never in silence: an unreadable payload is why the gate
        # passed everything for months (issue 620).
        sys.stderr.write(f"stop-slop hook: {e}\n")
        return 0

    tool_input = data.get("tool_input") or {}
    path = tool_input.get("file_path") or tool_input.get("filePath") or ""
    if not path:
        return 0
    if not path.lower().endswith(LINT_EXTS):
        return 0
    if not os.path.isfile(path):
        return 0

    try:
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return 0

    hits = stopslop.scan(text, technical=False)
    errors = [h for h in hits if h["severity"] == "ERROR"]
    if not errors:
        return 0

    sys.stderr.write(f"stop-slop gate FAILED on {path}\n")
    sys.stderr.write(
        f"{len(errors)} ERROR finding(s) - fix each, then rewrite the file:\n"
    )
    for h in sorted(errors, key=lambda x: (x["line"], x["col"])):
        sys.stderr.write(
            f"  L{h['line']}:{h['col']} [{h['id']}] "
            f"\"{h['match']}\" -> {h['message']} ({h['source']})\n"
        )
    return 2


if __name__ == "__main__":
    sys.exit(main())
