#!/usr/bin/env python3
"""
Claude Code Stop hook.

Lints the text of Claude's final assistant message each turn. If the linter
finds ERROR-severity hits, this exits 2, which forces Claude to keep working
and rewrite the message before finishing. Guards the infinite-loop case via
`stop_hook_active`.

Portable (Windows/macOS/Linux): invoked as `python <thisfile>`; imports the
linter directly from ../tools/stopslop.py.

The final message text is resolved from `last_assistant_message` if the hook
payload provides it; otherwise it is parsed out of the JSONL transcript at
`transcript_path`. Works regardless of which the Claude Code build supplies.
"""
import sys
import os
import json

try:
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.join(os.path.dirname(HERE), "tools")
sys.path.insert(0, TOOLS)


def text_from_transcript(path):
    """Return the text of the last assistant message in a JSONL transcript."""
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return ""
    for line in reversed(lines):
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if obj.get("type") != "assistant":
            continue
        message = obj.get("message") or {}
        content = message.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [
                c.get("text", "")
                for c in content
                if isinstance(c, dict) and c.get("type") == "text"
            ]
            if parts:
                return "\n".join(parts)
    return ""


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    # Loop guard: if we already forced one revision this turn, let it finish.
    if data.get("stop_hook_active"):
        return 0

    msg = data.get("last_assistant_message") or ""
    if not msg:
        transcript = data.get("transcript_path") or ""
        if transcript:
            msg = text_from_transcript(transcript)
    if not msg.strip():
        return 0

    try:
        import stopslop
    except Exception as e:
        sys.stderr.write(f"stop-slop hook: could not load linter: {e}\n")
        return 0

    hits = stopslop.scan(msg, technical=False)
    errors = [h for h in hits if h["severity"] == "ERROR"]
    if not errors:
        return 0

    sys.stderr.write(
        "stop-slop gate: your last message contains slop. "
        "Rewrite it to clear these, then finish:\n"
    )
    for h in sorted(errors, key=lambda x: (x["line"], x["col"])):
        sys.stderr.write(
            f"  L{h['line']}:{h['col']} [{h['id']}] "
            f"\"{h['match']}\" -> {h['message']}\n"
        )
    return 2


if __name__ == "__main__":
    sys.exit(main())
