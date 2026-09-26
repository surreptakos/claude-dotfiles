#!/usr/bin/env python3
"""Global Codex hook that requires an Ask Matt route on every turn."""

from __future__ import annotations
# issue 208: plugin/live-tree dedup -- see _plugin_hook_guard.py.
try:
    import sys as _pp_sys
    from pathlib import Path as _pp_Path
    _pp_sys.path.insert(0, str(_pp_Path(__file__).resolve().parent))
    from _plugin_hook_guard import skip_if_live_tree_will_fire as _pp_dedup
    _pp_dedup(_pp_Path(__file__).resolve())
except Exception:
    pass

from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from typing import Any


SCRIPT = Path(__file__).resolve()
STATE_DIR = Path(
    os.environ.get("ASK_MATT_GATE_STATE_DIR")
    or Path.home() / ".codex" / "hook-state" / "ask-matt"
)
CLAUDE_HOME = Path(
    os.environ.get("GOVERNANCE_CLAUDE_HOME") or Path.home() / ".claude"
)
ALLOWED_FLOWS = {
    "code-review",
    "codebase-design",
    "diagnosing-bugs",
    "direct-answer",
    "domain-modeling",
    "grill-me",
    "grill-with-docs",
    "handoff",
    "implement",
    "improve-codebase-architecture",
    "project-harness",
    "prototype",
    "research",
    "session-end",
    "setup-matt-pocock-skills",
    "tdd",
    "teach",
    "to-spec",
    "to-tickets",
    "triage",
    "wayfinder",
    "writing-great-skills",
}

# ---------------------------------------------------------------------------- caveman mode
# Dan, 2026-09-03: the caveman plugin's UserPromptSubmit tracker is the ONE writer of the mode flag
# (~/.claude/.caveman-active). This gate used to overwrite it with "ultra" on every prompt, which
# made `/caveman lite` and `/caveman off` last exactly one turn. Now the gate only reads it. Missing
# flag = off, matching the tracker, which deletes the file on `/caveman off` and "stop caveman".
# The plugin's SessionStart hook writes the configured default (%APPDATA%\caveman\config.json says
# ultra) so a fresh session still opens in ultra.
CAVEMAN_FLAG = ".caveman-active"
CAVEMAN_PROSE_MODES = ("lite", "full", "ultra")


def _read_caveman_mode() -> str:
    """Prose level in force: 'off', 'lite', 'full' or 'ultra'. Never raises."""
    try:
        raw = (CLAUDE_HOME / CAVEMAN_FLAG).read_text(encoding="utf-8").strip().lower()
    except OSError:
        return "off"
    if raw.startswith("wenyan"):
        raw = raw[len("wenyan"):].lstrip("-") or "full"
    if raw in CAVEMAN_PROSE_MODES:
        return raw
    if raw in ("commit", "review", "compress"):
        return "full"  # one-shot skill turn; ordinary prose rules still frame it
    return "off"


# Hooks on one event run in parallel with no ordering (docs/hook-ordering-2026-09-03.md), so on the
# prompt that carries `/caveman lite` this gate may read the flag before the tracker has written it.
# The gate therefore recognises the tracker's explicit switch forms itself and uses the result for
# THIS turn; the flag remains the source on every other prompt. Natural-language activations
# ("be terse") are left to the tracker and take effect next turn.
_CAVEMAN_OFF_PATTERNS = (
    re.compile(r"\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b"),
    re.compile(r"\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b"),
    re.compile(r"\bturn\s+off\s+(the\s+)?caveman\b"),
    re.compile(r"^(please\s+)?(go\s+|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b"),
)
_CAVEMAN_QUESTION = re.compile(
    r"^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b"
)
# Issue 734: with no pull-written ~/.claude/skills the aac copy is aac-skills:caveman, beside the
# caveman plugin's caveman:caveman; either namespaced spelling is the same switch.
_CAVEMAN_SLASH = re.compile(r"^/(?:aac-skills:)?caveman(?::caveman)?(?:\s+(\S+))?\s*[.!]*$")


def _caveman_default_mode() -> str:
    """The plugin's own resolution, minus repo-local config: env, then user config, then full."""
    env_mode = (os.environ.get("CAVEMAN_DEFAULT_MODE") or "").lower()
    if env_mode in CAVEMAN_PROSE_MODES + ("off",):
        return env_mode
    base = os.environ.get("XDG_CONFIG_HOME") or os.environ.get("APPDATA") or ""
    try:
        cfg = json.loads((Path(base) / "caveman" / "config.json").read_text(encoding="utf-8"))
        mode = str(cfg.get("defaultMode") or "").lower()
    except (OSError, ValueError, AttributeError):
        mode = ""
    if mode.startswith("wenyan"):
        mode = mode[len("wenyan"):].lstrip("-") or "full"
    return mode if mode in CAVEMAN_PROSE_MODES + ("off",) else "full"


def _mode_from_prompt(prompt: str) -> str | None:
    """Level an explicit switch in this prompt selects, or None when the prompt is not a switch."""
    text = re.sub(r"\s+", " ", (prompt or "").strip().lower())
    if not text:
        return None
    if any(p.search(text) for p in _CAVEMAN_OFF_PATTERNS):
        return "off"
    if re.search(r"\bnormal mode\b", text) and re.search(r"\bcaveman\b", text):
        return "off"
    if _CAVEMAN_QUESTION.match(text):
        return None
    slash = _CAVEMAN_SLASH.match(text)
    if not slash:
        return None
    arg = slash.group(1) or ""
    if not arg:
        return _caveman_default_mode()
    if arg in ("off", "stop", "disable"):
        return "off"
    if arg.startswith("wenyan"):
        arg = arg[len("wenyan"):].lstrip("-") or "full"
    return arg if arg in CAVEMAN_PROSE_MODES else None


# ---------------------------------------------------------------------------- ADHD shaping
# Issue 177. `/i-have-adhd` is Dan's standing communication rule, not a per-session mode
# (2026-09-09), so unlike caveman it is ON when no flag file exists. Content decides, so the switch
# can be flipped back without deleting the file: "on"/"1" keeps the checks, anything else (an empty
# file included) turns them off. Caveman is untouched by this flag -- the two rule sets are
# independent, ADHD shaping structure and caveman shaping wording.
#
# Issue 680: the plugin's injected ruleset says "stop adhd mode" turns it off, but nothing wrote
# the flag -- the i-have-adhd plugin has no tracker, unlike caveman. So this gate is the ONE writer,
# and it writes only on a prompt that carries an explicit switch phrase (the 2026-09-03 lesson: a
# writer that re-arms every turn makes a switch last one prompt). "stop adhd mode" writes "off";
# "start adhd mode" or a bare `/i-have-adhd` deletes the flag. Every other prompt only reads it.
ADHD_FLAG = ".adhd-off"
ADHD_ON_WORDS = ("on", "1", "enforced", "active")


def _adhd_state() -> str:
    """'on' or 'off' for THIS turn. Missing flag file = 'on'. Never raises."""
    try:
        raw = (CLAUDE_HOME / ADHD_FLAG).read_text(encoding="utf-8").strip().lower()
    except OSError:
        return "on"
    return "on" if raw in ADHD_ON_WORDS else "off"


_ADHD_NAME = r"(?:the\s+)?(?:i-have-)?adhd(?:\s+(?:mode|shaping|rules?))?"
_ADHD_OFF_PATTERNS = (
    re.compile(r"\b(?:stop|disable|deactivate|quit|exit|kill|end|pause)\s+" + _ADHD_NAME + r"\b"),
    re.compile(r"\bturn\s+(?:off\s+" + _ADHD_NAME + r"|" + _ADHD_NAME + r"\s+off)\b"),
    re.compile(r"\badhd(?:\s+mode)?\s+(?:off|stop|disabled?)\b"),
)
_ADHD_ON_PATTERNS = (
    re.compile(r"\b(?:start|enable|activate|resume|restart)\s+" + _ADHD_NAME + r"\b"),
    re.compile(r"\bturn\s+(?:on\s+" + _ADHD_NAME + r"|" + _ADHD_NAME + r"\s+(?:back\s+)?on)\b"),
    re.compile(r"\badhd(?:\s+mode)?\s+(?:on|enabled?)\b"),
    re.compile(r"^/i-have-adhd(?::i-have-adhd)?\s*[.!]*$"),
)


def _adhd_switch_from_prompt(prompt: str) -> str | None:
    """'off' or 'on' when this prompt is an explicit ADHD switch, else None. A question about the
    switch ("how do I stop adhd mode?") is not a switch."""
    text = re.sub(r"\s+", " ", (prompt or "").strip().lower())
    if not text or _CAVEMAN_QUESTION.match(text):
        return None
    if any(p.search(text) for p in _ADHD_OFF_PATTERNS):
        return "off"
    if any(p.search(text) for p in _ADHD_ON_PATTERNS):
        return "on"
    return None


def _apply_adhd_switch(prompt: str) -> str:
    """Write the flag when this prompt is an explicit switch; return the state for THIS turn.
    Never raises: a flag that cannot be written leaves the state the file still says."""
    switch = _adhd_switch_from_prompt(prompt)
    try:
        if switch == "off":
            CLAUDE_HOME.mkdir(parents=True, exist_ok=True)
            (CLAUDE_HOME / ADHD_FLAG).write_text("off\n", encoding="utf-8")
        elif switch == "on":
            (CLAUDE_HOME / ADHD_FLAG).unlink(missing_ok=True)
    except OSError:
        pass
    return _adhd_state()


ADHD_CONTEXT = {
    "on": (
        "I-HAVE-ADHD: ENFORCED. Lead with the next action, not context; number multi-step work; "
        "restate state (\"step 3 of 5 done: X. Next: Y\"); end with ONE action he can do in under "
        "two minutes; concrete time estimates, never \"some work\"; cap lists at five, ranked; no "
        "preamble, no recap, no closer. Structure, not wording; it does not compete with caveman. "
        "Dan switches it off by saying \"stop adhd mode\" (writes ~/.claude/.adhd-off)."
    ),
    "off": (
        "ADHD shaping is off (~/.claude/.adhd-off, written by \"stop adhd mode\"); the pre-send "
        "lint skips those checks. \"start adhd mode\" or /i-have-adhd turns it back on."
    ),
}


# Lint thresholds per level. Ultra keeps the numbers Dan tuned on 2026-09-02 (see the comments on
# WORD_CAP and friends). Full and lite are looser; monospace, paths and filler stay on at every
# level because those rules were about what a reply is for, not how terse it is.
LINT_PROFILES = {
    "ultra": {"word_cap": 250, "articles_cap": 12.0, "sentence_cap": 28},
    "full": {"word_cap": 350, "articles_cap": 15.0, "sentence_cap": 32},
    "lite": {"word_cap": 500, "articles_cap": None, "sentence_cap": 40},
}

CAVEMAN_CONTEXT = {
    "ultra": (
        "CAVEMAN ULTRA: ENFORCED. Minimum words; one fact once; fragments; no filler, pleasantries, "
        "hedging, tool narration, self-reference, invented abbreviations, or causal arrows. Lists, "
        "tables and bold when asked or when parallel/multifaceted content helps (findings, steps, "
        "options, files); plain prose otherwise. Preserve technical terms, code, exact errors. "
        "Plain language only when safety or ambiguity requires it."
    ),
    "full": (
        "CAVEMAN FULL: ENFORCED. Terse; drop articles, filler, pleasantries, hedging; fragments fine; "
        "no tool narration or self-reference. Lists, tables and bold when asked or when multifaceted "
        "content helps; plain prose otherwise. Preserve technical terms, code, exact errors. "
        "Plain language when safety or ambiguity requires it."
    ),
    "lite": (
        "CAVEMAN LITE: ENFORCED. Concise plain English; complete sentences allowed; drop filler, "
        "pleasantries, hedging and tool narration. Preserve technical terms, code, exact errors."
    ),
    "off": (
        "CAVEMAN: OFF for now (flag cleared by /caveman off or \"stop caveman\"). Normal prose; the "
        "pre-send lint still runs, for the YES rules only. Re-enable with /caveman ultra|full|lite."
    ),
}


def _read_event() -> dict[str, Any]:
    payload = json.load(sys.stdin)
    if not isinstance(payload, dict):
        raise ValueError("hook input must be an object")
    return payload


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value)


def _state_path(session_id: str, turn_id: str) -> Path:
    return STATE_DIR / f"{_safe_id(session_id)}--{_safe_id(turn_id)}.json"


def _write_state(session_id: str, turn_id: str, state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    destination = _state_path(session_id, turn_id)
    temporary_name = ""
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=STATE_DIR,
            prefix=f"{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary.write(json.dumps(state, indent=2))
            temporary_name = temporary.name
        os.replace(temporary_name, destination)
    finally:
        if temporary_name:
            Path(temporary_name).unlink(missing_ok=True)


def _read_state(session_id: str, turn_id: str) -> dict[str, Any] | None:
    try:
        value = json.loads(
            _state_path(session_id, turn_id).read_text(encoding="utf-8")
        )
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _deny(reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


# The runner spelling is the environment's, not ours. Accepting `python` alone denied `python3` --
# the only spelling a Linux container ships, the one the payload's own hooks.json uses on Unix, and
# therefore the one a cloud session reaches for first. The gate then refused the declaration AND
# every tool it gates, leaving the session no way to satisfy it: a probe spawned on 2026-09-21
# reported "deadlock: every tool blocked by safety gate; declaration itself requires Bash". An
# absolute path to the interpreter (/usr/local/bin/python3) is the same story.
DECLARE_RUNNER = r"(?:[\w./\\:+-]*\bpython(?:3(?:\.\d+)?)?(?:\.exe)?|py(?:\.exe)?\s+-3)"


# What the gate PRINTS has to be a runner the session can actually execute. The accept pattern
# above is deliberately tolerant, but a printed `python` is a dead command on an image that ships
# only `python3`, and a printed `py -3` is dead on every POSIX image -- measured 2026-09-22 in a
# claude.ai/code container, where the printed lint command returned `py: command not found`. A turn
# that cannot run its declaration is a turn with every tool denied, so the spelling is resolved
# from the environment the hook runs in rather than hardcoded.
def _runner_spelling() -> str:
    if os.name == "nt":
        return "py -3"
    for name in ("python3", "python"):
        if shutil.which(name):
            return name
    return sys.executable or "python3"


def _claude_declaration(session_id: str, nonce: str) -> str:
    """The exact declare-claude command for THIS session and nonce, as the prompt and deny print it."""
    return f'{_runner_spelling()} "{SCRIPT}" declare-claude "{session_id}" "{nonce}" <flow>'


def _is_exact_declaration_command(command: str, turn_id: str) -> bool:
    if not isinstance(command, str):
        return False
    flows = "|".join(sorted(map(re.escape, ALLOWED_FLOWS)))
    script_paths = "|".join(
        re.escape(path) for path in {str(SCRIPT), SCRIPT.as_posix()}
    )
    pattern = (
        rf"\s*{DECLARE_RUNNER}\s+"
        rf"[\"']?(?:{script_paths})[\"']?\s+declare\s+"
        rf"[\"']?{re.escape(turn_id)}[\"']?\s+(?:{flows})\s*"
    )
    return re.fullmatch(pattern, command, flags=re.IGNORECASE) is not None


def _is_declaration_command(event: dict[str, Any]) -> bool:
    turn_id = str(event.get("turn_id") or "")
    tool_name = str(event.get("tool_name") or "")
    tool_input = event.get("tool_input")
    if not turn_id or not isinstance(tool_input, dict):
        return False
    if tool_name == "Bash":
        command = tool_input.get("command")
        return isinstance(command, str) and _is_exact_declaration_command(
            command, turn_id
        )
    if tool_name == "functions.exec":
        code = tool_input.get("code")
        if not isinstance(code, str):
            return False
        wrapper = re.fullmatch(
            r"\s*text\(\s*await\s+tools\.shell_command\(\s*"
            r"\{\s*command\s*:\s*'([^'\r\n]*)'\s*\}\s*\)\s*\)\s*;?\s*",
            code,
        )
        return bool(
            wrapper
            and _is_exact_declaration_command(wrapper.group(1), turn_id)
        )
    return False


def _prompt(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    turn_id = str(event.get("turn_id") or "")
    if not session_id or not turn_id:
        return {"decision": "block", "reason": "Ask Matt gate received no session or turn id."}
    governance = {
        "turn_id": turn_id,
        "flow": None,
        "yes": True,
        "caveman": "ultra",
    }
    _write_state(session_id, turn_id, governance)
    declaration = f'{_runner_spelling()} "{SCRIPT.as_posix()}" declare "{turn_id}" <flow>'
    code_declaration = (
        "text(await tools.shell_command({command:'"
        f'{declaration}'
        "'}))"
    )
    context = (
        "ASK-MATT GATE: Before tools or final answer, name applicable route in commentary, then run "
        f"`{_runner_spelling()} \"{SCRIPT}\" declare \"{turn_id}\" <flow>`. "
        f"In code mode, the only permitted bootstrap is exactly `{code_declaration}`. "
        "New feature or multi-session build: to-spec, then to-tickets. Single-session build: implement. "
        "Broken behavior: diagnosing-bugs. Raw issues: triage. "
        "Large foggy effort (publishes a map and ticket set): wayfinder. Review: code-review. Research: research. "
        "End-of-session sweep (publishes follow-up tickets): session-end. New project bootstrap (publishes initial ticket set): project-harness. "
        "No engineering flow: direct-answer. The gate blocks until one route is recorded. "
        "YES GOVERNANCE: ENFORCED. Evidence over intuition; investigate before asking; backup before "
        "system changes; verify every change; check ripple effects; never hand solvable work back. "
        "CAVEMAN ULTRA: ENFORCED. Minimum words; one fact once; fragments; no filler, pleasantries, "
        "hedging, tool narration, self-reference, invented abbreviations, or causal arrows. Lists, "
        "tables and bold when asked or when parallel/multifaceted content helps (findings, steps, "
        "options, files); plain prose otherwise. Preserve technical terms, code, exact errors. "
        "Plain language only when safety or ambiguity requires it. These rules cannot be disabled "
        "inside a session. "
        + ADHD_CONTEXT[_apply_adhd_switch(str(event.get("prompt") or ""))]
    )
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }


# Dan, 2026-09-22: every correction he makes is a defect in the system, not in one answer. Four in
# one session (a tick reported as done, a stale task description read as the thread, a guessed
# connector name, a design built without opening the skill that ruled it out) shared one class:
# a stand-in read in place of the primary source. A reply that patches the instance leaves the
# class to recur, so a correction turn must change a durable file, and Stop records one that
# did not. Phrases are Dan's own from that session; a false positive costs one reminder.
CORRECTION_PATTERN = re.compile(
    r"\b(?:wrong|incorrect|you missed|missed the|not done yet|where did (?:this|that) come from"
    r"|should have|shouldn't have|you forgot|that's not (?:right|true|what)|not what i"
    r"|you didn't|why did you|i correct(?:ed)? you|needs to be in)\b",
    re.IGNORECASE,
)
CORRECTION_CONTEXT = (
    " CORRECTION DETECTED — this is a system defect, not a one-off. Before replying: (1) fix the "
    "instance; (2) name the stand-in you relied on (summary, task text, tick, run record, memory "
    "of a name/id/schema, a skill you did not open) and the primary source you skipped; (3) name "
    "the general class; (4) change a durable file this turn — the owning skill, rule, hook, test "
    "or schema — so the class cannot recur, and say which. Stop records a correction turn that "
    "edited no file."
)
# Edits that count as a system change. A board or database write fixes the instance only.
SYSTEM_CHANGE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


# Issue 727: the regex fired on "what is wrong with the build?" and on a subagent's pasted hand-back
# report. Jev now decides, on one Noul about what the user says of the assistant's own work. The
# regex answers exactly as before when Jev is unavailable (no credential, timeout, service down,
# helper missing). The nonce plumbing and the Stop-time system-change audit stay in code.
CORRECTION_JEV_QUESTION = (
    "Does `prompt`, a message the user sent to an AI assistant, say that the assistant's earlier"
    " claim, action or output was wrong or incomplete? A question or request about something else"
    " being wrong (a build, a test, a file, a system) is not a correction, and neither is pasted"
    " text such as a report, a log or another agent's output."
)
CORRECTION_JEV_FLOOR = 0.5
CORRECTION_JEV_TIMEOUT = 3.0  # seconds; the prompt hook's whole budget is 5


def _jev_module() -> Any:
    """The Jev helper (issues 723, 727), or None when it cannot be imported."""
    try:
        if str(SCRIPT.parent) not in sys.path:
            sys.path.insert(0, str(SCRIPT.parent))
        import jev  # ships beside this script, in ~/.codex/hooks and in the plugin payload alike
    except Exception:
        return None
    return jev


# Issue 839: Jev picks the ask-matt route, not the model (ADR 0002, glossary `CONTEXT.md`). The route
# tree is this one table: each level is one pick-one (Choice) question, and each option either
# names the next level ("then") or ends the walk at a route ("route"; None = no route, the gate
# stays as it was before Jev). Every level is asked in the same request as the correction Noul and
# the tree is walked in code afterwards, so the prompt hook spends one Jev call of at most
# PROMPT_JEV_TIMEOUT seconds inside its 5-second budget. Adding a route or a level is one edit here.
ROUTE_TREE_ROOT = "scope"
ROUTE_TREE: dict[str, dict[str, Any]] = {
    "scope": {
        "instructions": "Is `prompt`, a message the user sent to an AI coding assistant, about software"
        " work in a code repository (code, scripts, hooks, skills, tooling, tests, an app's behaviour),"
        " or about other work?",
        "options": {
            "software": {"means": "Software work in a repository: building, changing, fixing, reviewing"
                         " or asking about code, tooling or an app.", "then": "kind"},
            "other": {"means": "Other work: business documents, contract packages, performance reviews,"
                      " email, task lists, or anything that is not software work.", "route": None},
        },
    },
    "kind": {
        "instructions": "What does `prompt` ask the assistant for?",
        "options": {
            "question": {"means": "An answer or explanation only: a question about how something works,"
                         " what happened, or what something means, with nothing to build or change.",
                         "route": "direct-answer"},
            "build": {"means": "Something to be built, designed, added or changed, including a need"
                      " stated with no settled way to meet it (\"I need to be able to ...\").",
                      "then": "settled"},
            "broken": {"means": "Something is broken, failing, erroring or slow and needs diagnosing.",
                       "route": "diagnosing-bugs"},
            "issues": {"means": "Raw incoming issues or tickets to sort and make ready for work.",
                       "route": "triage"},
            "review": {"means": "A review of existing changes, a branch or a pull request.",
                       "route": "code-review"},
            "research": {"means": "Investigating a topic against outside sources and writing it up.",
                         "route": "research"},
        },
    },
    "settled": {
        "instructions": "How settled is what `prompt` asks to build or change?",
        "options": {
            "unsettled": {"means": "The idea is not settled: how to do it, or what exactly is wanted,"
                          " is still open.", "then": "codebase"},
            "single": {"means": "Settled and small: what to do is clear and fits in one working"
                       " session.", "route": "implement"},
            "multi": {"means": "Settled and large: what to do is clear but it needs several working"
                      " sessions.", "route": "to-spec"},
            "foggy": {"means": "A huge, foggy effort with many open decisions before any deliverable"
                      " is clear.", "route": "wayfinder"},
        },
    },
    "codebase": {
        "instructions": "Does the unsettled idea in `prompt` concern an existing codebase?"
        " `in_repository` says whether the assistant is working inside a code repository.",
        "options": {
            "repo": {"means": "Yes: it changes or extends an existing repository.", "route": "grill-with-docs"},
            "none": {"means": "No: there is no codebase yet.", "route": "grill-me"},
        },
    },
}
PROMPT_JEV_TIMEOUT = 3.0  # seconds; the prompt hook's whole budget is 5
# A scheduled run's prompt carries its task file inside this block; it gets no route (for now).
SCHEDULED_TASK_PATTERN = re.compile(r"<scheduled-task\b", re.IGNORECASE)
# A message that opens with a route's own slash command (`/to-spec`, `/aac-skills:session-end`), or
# invokes /session-end anywhere, names its route itself: Jev is not asked for a route and the
# declaration works as before. The tree has no leaf for session-end or project-harness, so a Jev
# pick would refuse the very route the user typed.
SLASH_ROUTE_PATTERN = re.compile(r"^\s*/(?:aac-skills:)?([\w-]+)")


# Issue 841: the route gate settings (glossary `CONTEXT.md`) are ONE committed file beside this
# script, so a change is a commit that reaches every machine and cloud session alike, never a
# per-machine flag. `appeals` (default on) lets the model appeal Jev's route once per turn; off
# makes Jev's pick final. A missing or unreadable file means the committed default.
ROUTE_GATE_SETTINGS = Path(
    os.environ.get("ASK_MATT_ROUTE_SETTINGS") or SCRIPT.parent / "route-gate.json"
)
ROUTE_GATE_DEFAULTS = {"appeals": True}


def _route_gate_setting(name: str) -> Any:
    try:
        value = json.loads(ROUTE_GATE_SETTINGS.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        value = {}
    if not isinstance(value, dict) or name not in value:
        return ROUTE_GATE_DEFAULTS[name]
    return value[name]


def _appeal_line(appeal: dict[str, Any]) -> str:
    """The reply's first line on an appealed turn, as the lint demands it and Dan reads it."""
    return (
        f"Route appeal: {appeal['wanted']} instead of {appeal['jev_route']}, "
        f"because {appeal['reason']}"
    )


def _current_appeal(state: dict[str, Any] | None) -> dict[str, Any] | None:
    """This turn's appeal, or None. Keyed to the nonce so an earlier turn's appeal never counts."""
    state = state or {}
    appeal = state.get("appeal")
    if isinstance(appeal, dict) and appeal.get("nonce") and appeal["nonce"] == state.get("nonce"):
        return appeal
    return None


def _user_named_route(prompt: str) -> bool:
    match = SLASH_ROUTE_PATTERN.match(prompt)
    named = bool(match and match.group(1) in ALLOWED_FLOWS)
    return named or SESSION_END_INVOKED.search(prompt) is not None


def _route_questions() -> dict[str, Any]:
    return {
        f"route.{level}": {
            "type": "choice",
            "instructions": spec["instructions"],
            "criteria": {option: leaf["means"] for option, leaf in spec["options"].items()},
        }
        for level, spec in ROUTE_TREE.items()
    }


def _walk_route_tree(answers: dict[str, Any]) -> dict[str, Any] | None:
    """Jev's route from the answers, walked from the root; None when an answer is missing."""
    level, path = ROUTE_TREE_ROOT, []
    while level:
        answer = answers.get(f"route.{level}")
        option = answer.get("choice") if isinstance(answer, dict) else None
        leaf = ROUTE_TREE[level]["options"].get(option)
        if leaf is None:
            return None
        path.append(f"{level}={option}")
        if "route" in leaf:
            return {"route": leaf["route"], "path": path}
        level = leaf["then"]
    return None


def _in_repository(cwd: str) -> bool:
    """Whether the session's working directory is inside a git checkout (a `.git` above it)."""
    try:
        folder = Path(cwd).resolve() if cwd else None
    except (OSError, RuntimeError):
        return False
    while folder is not None:
        if (folder / ".git").exists():
            return True
        folder = folder.parent if folder.parent != folder else None
    return False


def _prompt_verdicts(prompt: str, in_repository: bool = False) -> tuple[bool, dict[str, Any] | None]:
    """(correction?, Jev's route pick) from ONE Jev request; the pick is None when Jev is unavailable.

    A scheduled run, or a message naming its route by slash command, is not routed, so its request
    carries the correction question alone. When Jev cannot answer, the correction verdict is the
    regex and there is no pick.
    """
    prompt = prompt or ""
    if not prompt.strip():
        return False, None
    unrouted = SCHEDULED_TASK_PATTERN.search(prompt) is not None or _user_named_route(prompt)
    questions: dict[str, Any] = {"correction": CORRECTION_JEV_QUESTION}
    if not unrouted:
        questions.update(_route_questions())
    jev = _jev_module()
    answers = None if jev is None else jev.ask(
        {"prompt": prompt, "in_repository": in_repository}, questions, timeout=PROMPT_JEV_TIMEOUT
    )
    if answers is None:
        return CORRECTION_PATTERN.search(prompt) is not None, None
    correction = answers["correction"] >= CORRECTION_JEV_FLOOR
    if unrouted:
        return correction, {"route": None, "path": ["not routed"]}
    return correction, _walk_route_tree(answers)


def _is_correction(prompt: str) -> bool:
    return _prompt_verdicts(prompt)[0]


def _claude_prompt(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    if not session_id:
        return {"decision": "block", "reason": "Governance gate received no session id."}
    nonce = secrets.token_hex(8)
    # Carry the previous declaration forward as last_flow. PreToolUse honours it, so a user message
    # arriving mid-turn no longer denies in-flight tool calls — subagents share the session id, their
    # calls hit the same PreToolUse gate, and they can never see the new nonce, so the old behaviour
    # fed them the deny string in place of real tool output. The Stop hook still refuses to end the
    # turn until a fresh declaration for THIS nonce lands, which is where the per-turn rigor lives.
    previous = _read_state("claude", session_id)
    mode = _mode_from_prompt(str(event.get("prompt") or "")) or _read_caveman_mode()
    state = {
        "nonce": nonce,
        "flow": None,
        "last_flow": (previous or {}).get("flow") or (previous or {}).get("last_flow"),
        "yes": True,
        "caveman": mode,
        # Issue 608: the once-per-session release for a shell-less surface survives the turn.
        "unknown_tool_denied": (previous or {}).get("unknown_tool_denied"),
    }
    correction, pick = _prompt_verdicts(
        str(event.get("prompt") or ""), _in_repository(str(event.get("cwd") or ""))
    )
    if correction:
        state["correction_nonce"] = nonce
    jev_route = (pick or {}).get("route")
    if pick is not None:
        # Recorded for the turn by the gate itself; the model's declaration cannot change it.
        state["route_path"] = pick["path"]
        if jev_route:
            state["jev_route"] = jev_route
            state["flow"] = jev_route
    # Issue 716: typing /session-end is the approval for its ticket batch (#704). Recorded per turn,
    # so the next user message clears it and the ticket-SET round applies again outside session-end.
    if SESSION_END_INVOKED.search(str(event.get("prompt") or "")):
        state["session_end_invoked"] = True
    _write_state("claude", session_id, state)
    pending_correction = (previous or {}).get("pending_correction")
    # Style violations from the previous turn are carried here rather than blocked at Stop. A Stop
    # block cannot retract the message it is judging — it only makes the model emit a second one —
    # so the correction lands where it can still change the output: before the next message.
    pending_lint = (previous or {}).get("pending_lint") or []
    context = (
        "ASK-MATT GATE: Before tools or final answer, name applicable route, then run "
        f"`{_claude_declaration(session_id, nonce)}` — as the ONLY "
        "command in that shell call, nothing chained after it, or the call is denied. "
        "New feature or multi-session build: to-spec, then to-tickets. Single-session build: implement. "
        "Broken behavior: diagnosing-bugs. Raw issues: triage. "
        "Large foggy effort (publishes a map and ticket set): wayfinder. Review: code-review. Research: research. "
        "End-of-session sweep (publishes follow-up tickets): session-end. New project bootstrap (publishes initial ticket set): project-harness. "
        "No engineering flow: direct-answer. YES GOVERNANCE: ENFORCED. Evidence over intuition; "
        "investigate before asking; backup before system changes; verify every change; check ripple "
        "effects; never hand solvable work back. "
        + CAVEMAN_CONTEXT[mode]
        + " Level follows the caveman flag: /caveman ultra|full|lite|off switches it for the "
        "session; nothing else can. "
        + ADHD_CONTEXT[_apply_adhd_switch(str(event.get("prompt") or ""))]
        + " "
    )
    if jev_route:
        context += (
            f"ROUTE PICKED BY JEV: {jev_route} (recorded; no declaration needed). Open and follow "
            f"the {jev_route} route; declaring any other route is refused. "
        )
        if _route_gate_setting("appeals"):
            context += (
                "Jev wrong? Appeal ONCE this turn: `"
                f'{_runner_spelling()} "{SCRIPT}" appeal-claude "{session_id}" "{nonce}" <route> "<reason>"'
                "`; the reply's first line must then read `Route appeal: <route> instead of "
                f"{jev_route}, because <reason>`. "
            )
        else:
            context += "Appeals are off: Jev's pick is final. "
    # The pre-send lint, standing on every turn (owner instruction, 2026-08-12). It carries the YES
    # rules at every caveman level, off included, plus the style rules for the level in force. It is
    # the only enforcement point that can stop the offending message rather than report it: no hook
    # event sees assistant text before the user does.
    context += (
        "PRE-SEND LINT REQUIRED, EVERY REPLY: write your final reply to a file, run "
        f"`{_runner_spelling()} \"{SCRIPT}\" lint <file> \"{session_id}\"`, and rewrite until it exits 0. Send "
        "only the linted text. It checks YES (no deflection, no unverified claims, no conclusions "
        "without data, no characterising unread sources) plus the caveman level. Skipping this is "
        "recorded at Stop and reported back to you next turn."
    )
    if correction:
        context += CORRECTION_CONTEXT
    if pending_correction:
        context += " " + pending_correction
    if pending_lint:
        context += (
            " CAVEMAN VIOLATION IN YOUR LAST MESSAGE — fix in this one, do not repeat it: "
            + "; ".join(pending_lint)
            + "."
        )
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        },
        "suppressOutput": True,
    }


# Issue 608: Cowork's shell is `mcp__workspace__bash`, not `Bash`, so a name check that knows
# only Claude Code's two shells denied the declaration itself and every later call with it. A
# shell tool is any of the two, or an MCP shell (`mcp__<server>__bash|shell|powershell`).
SHELL_TOOL_PATTERN = re.compile(r"^(?:Bash|PowerShell|mcp__[^_].*__(?:bash|shell|powershell))$")


def _is_shell_tool(tool_name: Any) -> bool:
    return SHELL_TOOL_PATTERN.match(str(tool_name or "")) is not None


def _is_claude_declaration_command(
    event: dict[str, Any], session_id: str, nonce: str
) -> bool:
    if not _is_shell_tool(event.get("tool_name")):
        return False
    tool_input = event.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str):
        return False
    flows = "|".join(sorted(map(re.escape, ALLOWED_FLOWS)))
    script_paths = "|".join(
        re.escape(path) for path in {str(SCRIPT), SCRIPT.as_posix()}
    )
    pattern = (
        rf"\s*{DECLARE_RUNNER}\s+"
        rf"[\"']?(?:{script_paths})[\"']?\s+declare-claude\s+"
        rf"[\"']?{re.escape(session_id)}[\"']?\s+"
        rf"[\"']?{re.escape(nonce)}[\"']?\s+(?:{flows})"
        rf"(?:\s+2>&1)?(?:\s*;\s*echo\s+[\"']?exit=\$\?[\"']?)?\s*"
    )
    return re.fullmatch(pattern, command, flags=re.IGNORECASE) is not None


# Owner audit (issue 165, extended by issue 200): every ALLOWED_FLOWS route that creates issues by
# design belongs here, otherwise the gate refuses a `gh issue create` the route is meant to
# produce. wayfinder publishes its map and ticket set; diagnosing-bugs files the closure ticket
# after a fix; implement records discoveries. session-end's ticket sweep and project-harness's
# initial ticket set are also publishing routes in their own right (issue 200), so a session that
# declared either flow is allowed to publish under it without re-declaring as to-tickets.
TICKET_FLOWS = {
    "to-tickets",
    "to-spec",
    "triage",
    "wayfinder",
    "diagnosing-bugs",
    "implement",
    "session-end",
    "project-harness",
}
ISSUE_CREATE_PATTERN = re.compile(
    # Anchored: this is matched against ONE segment of a command line, so it fires on a command
    # actually being run, not on the same words appearing inside quoted text. `/issues` must also END
    # the path — `issues/19/sub_issues` and `issues/15/dependencies/...` link issues that exist.
    r"gh\s+issue\s+create\b"
    r"|gh\s+api\b[^\n]*--method\s+POST[^\n]*?/issues(?![/\w])",
    re.IGNORECASE,
)
HEREDOC_PATTERN = re.compile(
    r"<<-?\s*[\"']?(?P<tag>[A-Za-z_][A-Za-z0-9_]*)[\"']?\n.*?^(?P=tag)\s*$",
    re.DOTALL | re.MULTILINE,
)


def _command_segments(command: str) -> list[str]:
    """Split a shell command into the segments a shell would actually execute.

    Heredoc bodies come out first. Writing a file whose CONTENT mentions `gh issue create` is not
    running it — that false positive blocked a plain `cat > file` the first time this gate ran, which
    is the whole reason this function exists rather than a bare substring search.
    """
    stripped = HEREDOC_PATTERN.sub(" ", command)
    # Blank the CONTENT of quoted strings before splitting. Without this, a separator inside an
    # argument splits the line and the tail reads as a command of its own: `mk 'cd /tmp && gh issue
    # create -t x'` produced a segment starting with `gh`. A real command still keeps its head,
    # because the head is never inside quotes.
    stripped = re.sub(r"'[^']*'", "''", stripped)
    stripped = re.sub(r'"[^"]*"', '""', stripped)
    return [seg.strip() for seg in re.split(r"[\n;]|&&|\|\||\|", stripped) if seg.strip()]


def _command_of(event: dict[str, Any]) -> str:
    if not _is_shell_tool(event.get("tool_name")):
        return ""
    tool_input = event.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    return command if isinstance(command, str) else ""


def _publish_count_path(session_id: str) -> Path:
    return STATE_DIR / f"{_safe_id(session_id)}--published.json"


def _read_publish_count(session_id: str) -> int:
    try:
        with open(_publish_count_path(session_id), encoding="utf-8") as handle:
            return int(json.load(handle).get("issues_created") or 0)
    except Exception:
        return 0


def _bump_publish_count(session_id: str) -> None:
    """Survives a turn boundary on purpose. `declare-claude` rewrites the turn state from scratch
    every turn, so a counter living there resets exactly when a multi-turn ticket run needs it most."""
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        count = _read_publish_count(session_id) + 1
        with open(_publish_count_path(session_id), "w", encoding="utf-8") as handle:
            json.dump({"issues_created": count}, handle)
    except Exception:
        pass


def _transcript_used_tool(transcript_path: str, tool_name: str) -> bool:
    if not transcript_path:
        return False
    try:
        with open(transcript_path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("type") != "assistant":
                    continue
                for item in (record.get("message") or {}).get("content") or []:
                    if (
                        isinstance(item, dict)
                        and item.get("type") == "tool_use"
                        and item.get("name") == tool_name
                    ):
                        return True
    except Exception:
        return False
    return False


# Fallback for sessions where AskUserQuestion is not a registered tool: accept an explicit
# user-typed approval token in the most recent user turn. Model cannot forge user turns —
# records with type == "user" come from real user input, not tool output. The token must be
# distinctive enough that natural conversation does not trip it, so a bracketed sentinel is
# the primary signal; a very small whitelist of short go-signals is accepted only when the
# entire trimmed user message is nothing but that signal.
APPROVE_TICKETS_SENTINEL = "[approve-tickets]"
APPROVE_TICKETS_STANDALONE_TOKENS = frozenset(
    {
        "approve tickets",
        "approve-tickets",
        "approved",
        "approve",
        "publish tickets",
        "publish the tickets",
        "publish",
        "ship it",
        "lgtm",
        "looks good",
        "that's fine, go",
        "thats fine, go",
        "that's fine go",
        "thats fine go",
        "go",
    }
)


def _iter_user_text(transcript_path: str):
    """Yield each user turn's plain text, oldest → newest.

    A record with `type == "user"` and no `tool_use_id` on any content block is a real
    user-typed message, not a tool-result masquerading as one.
    """
    if not transcript_path:
        return
    try:
        with open(transcript_path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("type") != "user":
                    continue
                message = record.get("message") or {}
                content = message.get("content")
                if isinstance(content, str):
                    yield content
                    continue
                if not isinstance(content, list):
                    continue
                # Skip tool_result blocks — those are tool output routed to user role.
                if any(
                    isinstance(item, dict) and item.get("type") == "tool_result"
                    for item in content
                ):
                    continue
                text_parts = [
                    item.get("text", "")
                    for item in content
                    if isinstance(item, dict) and item.get("type") == "text"
                ]
                if text_parts:
                    yield "\n".join(text_parts)
    except Exception:
        return


def _matches_approval(text: str) -> bool:
    if not text:
        return False
    stripped = text.strip()
    if APPROVE_TICKETS_SENTINEL in stripped.lower():
        return True
    normalized = re.sub(r"\s+", " ", stripped).strip().lower().rstrip(".!")
    return normalized in APPROVE_TICKETS_STANDALONE_TOKENS


def _transcript_user_approved(transcript_path: str) -> bool:
    """Any user turn matching the approval whitelist counts, not only the newest.

    An earlier `that's fine, go` before the first publish already satisfies /to-tickets step 4;
    a later user turn that redirects work (e.g. `fix the hook instead`) does not retract that
    approval — the same ticket set is still what the user asked for.
    """
    return any(_matches_approval(text) for text in _iter_user_text(transcript_path))


# `/session-end` as a slash command, not a path segment such as `aac-skills/session-end/`. Since
# issue 734 the plugin serves the skill, so its namespaced `/aac-skills:session-end` counts too.
SESSION_END_INVOKED = re.compile(r"(?<![\w/.-])/(?:aac-skills:)?session-end\b")


def _session_end_turn(state: dict[str, Any] | None) -> bool:
    """True when THIS turn is the session-end sweep: its declared flow (not the carried last_flow)
    is session-end, or the user's prompt invoked /session-end. The session-end skill files its batch
    without an approval round (#704, Dan 2026-09-23: typing /session-end is the approval)."""
    return bool(state) and (
        state.get("flow") == "session-end" or bool(state.get("session_end_invoked"))
    )


def _autonomous_master() -> bool:
    """True only under the watchdog-launched orchestrator master (claude-dotfiles issue 81)."""
    # .strip(): master-watchdog.ps1 launches via `cmd /k set VAR=1 && claude ...`, and cmd's
    # `set` keeps the trailing space before `&&`, so the value arrives as "1 " and an exact
    # == "1" silently denied the exemption (seen 2026-09-03 in the contract-builder master).
    return os.environ.get("AAC_ORCHESTRATOR_AUTONOMOUS", "").strip() == "1"


def _publish_gate(
    event: dict[str, Any], session_id: str, state: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Filing ONE issue is triage. Filing a SET is /to-tickets, whose step 4 says the breakdown is
    approved by the user before anything is published.

    Declaring a route was never enough to enforce that: the gate only checked that a flow string
    existed, so `triage` (or any other route) published a whole ticket set unchallenged. This keys off
    what is actually happening instead of what was declared — the second `gh issue create` in a
    session IS a ticket set — and it demands evidence the user was asked, in the form of an
    AskUserQuestion in the transcript. Self-assertion is not accepted: a stamp the model writes is a
    stamp the model can write while skipping the step.
    """
    command = _command_of(event)
    if not command:
        return None
    if not any(
        ISSUE_CREATE_PATTERN.match(segment) for segment in _command_segments(command)
    ):
        return None
    flow = (state or {}).get("flow") or (state or {}).get("last_flow")
    if flow not in TICKET_FLOWS:
        return _deny(
            f"Publishing an issue under route `{flow}`. Declare one of: "
            + ", ".join(sorted(TICKET_FLOWS))
            + "."
        )
    already = _read_publish_count(session_id)
    transcript_path = str(event.get("transcript_path") or "")
    # An autonomous orchestrator master has nobody at the keyboard by design (Dan, 2026-09-02:
    # "I should not ever be asked to approve-tickets. I am not at the computer. This is meant to
    # be a completely autonomous run"). orchestrator/master-watchdog.ps1 in claude-dotfiles sets
    # AAC_ORCHESTRATOR_AUTONOMOUS=1 on exactly the launch it controls; a session cannot grant
    # itself the exemption by renaming. The route requirement above still applies; only the
    # ticket-SET approval half is skipped. Review happens after the fact: every filed ticket
    # carries its evidence and a triage label, and the master's heartbeat lists what it filed.
    if _autonomous_master():
        _bump_publish_count(session_id)
        return None
    if (
        already >= 1
        and not _session_end_turn(state)
        and not _transcript_used_tool(transcript_path, "AskUserQuestion")
        and not _transcript_user_approved(transcript_path)
    ):
        return _deny(
            f"This is issue #{already + 1} this session, so it is a ticket SET, not a one-off. "
            "/to-tickets step 4: present the numbered breakdown with each ticket's blocking edges "
            "and what it delivers, ask the user about granularity and edges via AskUserQuestion, "
            "and iterate until approved. Publish after that. "
            "AskUserQuestion is not registered in every session; when it isn't, the user's "
            "explicit typed approval satisfies the gate — either the sentinel "
            f"`{APPROVE_TICKETS_SENTINEL}` anywhere in their message, or a standalone approval "
            "token as the whole message (e.g. `approved`, `publish`, `lgtm`, `that's fine, go`)."
        )
    _bump_publish_count(session_id)
    return None


def _claude_pre_tool(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    state = _read_state("claude", session_id)
    nonce = str(state.get("nonce") or "") if state else ""
    blocked = _publish_gate(event, session_id, state)
    if blocked is not None:
        return blocked
    blocked = _backup_gate(event)
    if blocked is not None:
        return blocked
    if (
        state
        and state.get("flow")
        and state.get("yes") is True
        and state.get("caveman") in CAVEMAN_PROSE_MODES + ("off",)
    ):
        return {}
    if nonce and _is_claude_declaration_command(event, session_id, nonce):
        return {}
    # A declared flow from earlier in the session keeps tools flowing while the fresh declaration is
    # pending. Not a loophole: _claude_stop only accepts the CURRENT state's flow, so the turn cannot
    # end on the grace path — the main agent still has to declare against the new nonce. What this
    # removes is the collateral deny that used to land on whichever tool call (often a subagent's)
    # happened to be in flight when a new user prompt reset the state.
    if state and state.get("last_flow"):
        return {}
    if not state:
        # No state file at all means the UserPromptSubmit hook never ran for this session, so there
        # is no nonce and the declaration this deny demands cannot be written — the gate refuses
        # every tool call including the declaration itself, and nothing the session can do satisfies
        # it. Seen 2026-09-21 in the master-zoho-source-of-truth Routine: the payload merged these
        # hooks into live user settings mid-session, every subsequent call came back denied, and the
        # master could not even send a notification. Fail open; the next prompt writes state and the
        # gate resumes with full force.
        return {}
    # Issue 608 item 3: a surface whose tools are neither Claude Code's nor an MCP shell can never
    # run the declaration, so an unconditional deny is a permanent deadlock. Refuse ONCE per
    # session for such a tool name, record it, then let the calls through with the turn marked
    # undeclared (the issue 499 shape on the Stop side).
    tool_name = str(event.get("tool_name") or "")
    if state and not _is_shell_tool(tool_name) and tool_name not in READ_CLASS_TOOLS:
        current = dict(state)
        if current.get("unknown_tool_denied"):
            _log_governance(
                session_id, f"tool {tool_name} allowed undeclared: no shell tool to declare with"
            )
            return {}
        current["unknown_tool_denied"] = tool_name
        _write_state("claude", session_id, current)
    # The wording names the two ways a first call fails: no declaration yet, or a declaration with
    # a command chained onto it. A session that chained `; ls` onto its declaration read the old
    # text as "the declaration failed" and retried the same shape, losing two turns to the gate.
    # Issue 715: the deny names the declaration itself, with THIS session's id and nonce. After a
    # model switch restarts the session, the context still holds gate prompts naming the old id and
    # nonces; a deny that only said "run the declaration from the prompt gate" let the model copy a
    # stale one, recording state under the old id and leaving every call here denied for minutes.
    return _deny(
        "Ask Matt, Yes, and caveman ultra missing. Run exactly "
        f"`{_claude_declaration(session_id, nonce)}` (this session's id and current nonce; any "
        "id or nonce from an earlier prompt is stale) as the ONLY command in the call — a chained "
        "command after it denies the whole call."
    )


def _claude_declare(session_id: str, nonce: str, flow: str) -> int:
    if flow not in ALLOWED_FLOWS:
        print(f"Governance route rejected: {flow}", file=sys.stderr)
        return 2
    state = _read_state("claude", session_id)
    if not state or state.get("nonce") != nonce:
        print("Governance route rejected: no matching Claude turn", file=sys.stderr)
        return 2
    jev_route = state.get("jev_route")
    appeal = _current_appeal(state)
    # An appeal replaces Jev's route for the rest of the turn (issue 841).
    settled = appeal["wanted"] if appeal else jev_route
    if settled and flow != settled:
        how = f"The appeal settled {settled}" if appeal else f"Jev picked {jev_route}"
        print(
            f"Governance route rejected: {flow}. {how} for this message "
            f"({' > '.join(state.get('route_path') or [])}); it is recorded, declare nothing else.",
            file=sys.stderr,
        )
        return 2
    # The prompt hook already settled this turn's level (prompt switch or flag); keep it.
    mode = state.get("caveman")
    if mode not in CAVEMAN_PROSE_MODES + ("off",):
        mode = _read_caveman_mode()
    _write_state(
        "claude",
        session_id,
        {
            "nonce": nonce,
            "flow": flow,
            "last_flow": state.get("last_flow"),
            "yes": True,
            "caveman": mode,
            # The correction flag is the prompt's finding about this turn; declaring a route
            # must not erase it, or the Stop audit never sees a correction turn.
            "correction_nonce": state.get("correction_nonce"),
            # Likewise the prompt's /session-end finding (issue 716).
            "session_end_invoked": state.get("session_end_invoked"),
            "jev_route": jev_route,
            "route_path": state.get("route_path"),
            "appeal": state.get("appeal"),
        },
    )
    print(f"Governance recorded: {flow}; yes; caveman-{mode}")
    return 0


def _appeal_log_path() -> Path:
    return STATE_DIR / "route-appeals.log"


def _claude_appeal(session_id: str, nonce: str, wanted: str, reason: str) -> int:
    """Issue 841: the model's one appeal of Jev's route this turn (ADR 0002). Switches the turn's
    route, logs both routes and the reason, and arms the pre-send lint to refuse the reply until
    its first line states the appeal, so Dan always sees it."""
    reason = " ".join(reason.split())
    if not _route_gate_setting("appeals"):
        print(
            f"Route appeal refused: appeals are off in {ROUTE_GATE_SETTINGS.name}; "
            "Jev's pick is final.",
            file=sys.stderr,
        )
        return 2
    if wanted not in ALLOWED_FLOWS:
        print(f"Route appeal refused: {wanted} is not a route", file=sys.stderr)
        return 2
    if not reason:
        print("Route appeal refused: give the reason Jev's route is wrong", file=sys.stderr)
        return 2
    state = _read_state("claude", session_id)
    if not state or not nonce or state.get("nonce") != nonce:
        print("Route appeal refused: no matching Claude turn", file=sys.stderr)
        return 2
    jev_route = state.get("jev_route")
    if not jev_route:
        print("Route appeal refused: Jev picked no route this turn; declare yours", file=sys.stderr)
        return 2
    appeal = _current_appeal(state)
    if appeal:
        print(
            f"Route appeal refused: this turn already appealed ({_appeal_line(appeal)}); "
            "one appeal per turn.",
            file=sys.stderr,
        )
        return 2
    if wanted == jev_route:
        print(f"Route appeal refused: Jev already picked {wanted}", file=sys.stderr)
        return 2
    appeal = {"nonce": nonce, "wanted": wanted, "jev_route": jev_route, "reason": reason}
    current = dict(state)
    current["appeal"] = appeal
    current["flow"] = wanted
    _write_state("claude", session_id, current)
    _append_log(
        _appeal_log_path(), session_id, f"wanted={wanted}\tjev={jev_route}\treason={reason}"
    )
    print(
        f"Route appeal recorded: {wanted} instead of {jev_route}. Open and follow {wanted}. "
        f"The reply's first line must read: {_appeal_line(appeal)}"
    )
    return 0


def _appeal_lint(text: str, appeal: dict[str, Any] | None) -> tuple[list[str], str]:
    """(violations, text left for the ADHD shape). On an appealed turn the first line after the
    PYLONS canary must state the appeal; the ADHD opener rule then applies to the line after it."""
    if not appeal:
        return [], text
    lines = PYLONS_PREFIX_PATTERN.sub("", text, count=1).lstrip().splitlines()
    first = lines[0].strip() if lines else ""
    prefix = f"Route appeal: {appeal['wanted']} instead of {appeal['jev_route']}, because "
    if first.startswith(prefix) and first[len(prefix):].strip():
        return [], "\n".join(lines[1:])
    return [
        "route appeal not shown: this turn appealed Jev's route, so the reply's first line must "
        f'read "{_appeal_line(appeal)}"'
    ], text


FILLER_PATTERN = re.compile(
    r"\b(just|really|basically|actually|simply|certainly|obviously|probably|likely)\b"
    r"|\bof course\b|\bhappy to\b|\bfeel free\b|\bmight be\b|\bseems like\b|\bi think\b",
    re.IGNORECASE,
)
ARTICLE_PATTERN = re.compile(r"\b(the|a|an)\b", re.IGNORECASE)
# Lowered 500 -> 250 on 2026-09-02: Dan approved a 98-word reply and rejected a
# 179-word one as not concise. Article density did NOT separate the two (1.0 vs
# 0.6 per 100), so length is the lever that tracks his judgement. 150 was tried
# first and Dan set 250, keeping room for a real report in one message.
WORD_CAP = 250
# Raised 7 -> 12 on 2026-09-02. Dan asked for plain English, and a ceiling of 7
# is what was forcing replies into telegram-speak: ordinary explanatory prose
# runs about 9 per 100. The ceiling still catches genuine padding.
ARTICLES_PER_100_CAP = 12.0
# Plain English is mostly short sentences. Replies Dan accepted topped out at 22
# words; the long-form report he did not want ran 60 words in one sentence.
SENTENCE_WORD_CAP = 28
SENTENCE_SPLIT = re.compile(r"[.!?]+(?:\s|$)")


def _lint_log_path() -> Path:
    return STATE_DIR / "caveman-lint.log"


def _append_log(path: Path, session_id: str, message: str) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{stamp}\t{session_id}\t{message}\n")
    except Exception:
        pass  # logging must never wedge a session


def _log_lint(session_id: str, violations: list[str]) -> None:
    """The lint never blocks — a blocked Stop double-renders the message it is judging — so this
    log plus the next turn's injected correction is where the enforcement actually lives."""
    _append_log(_lint_log_path(), session_id, "; ".join(violations))


def _log_governance(session_id: str, message: str) -> None:
    """Turns that ended without a declared route. Separate from the style log: this one records a
    gate that did not fire, which is the thing worth auditing."""
    _append_log(STATE_DIR / "governance.log", session_id, message)


def _last_assistant_text(transcript_path: str) -> str:
    text_blocks: list[str] = []
    with open(transcript_path, encoding="utf-8") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("type") != "assistant":
                continue
            content = (record.get("message") or {}).get("content") or []
            blocks = [
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and item.get("type") == "text"
            ]
            if blocks:
                text_blocks = blocks
    return "\n".join(text_blocks)


def _strip_code(text: str) -> str:
    text = re.sub(r"```.*?```", " ", text, flags=re.DOTALL)
    return re.sub(r"`[^`\n]*`", " ", text)


FENCE_PATTERN = re.compile(r"```")
RUNNABLE_FENCE_PATTERN = re.compile(r"```bash\n.*?```", re.DOTALL)
# The mandated reply prefix from ~/.claude/CLAUDE.md ("Standing directive — response prefix").
# Leading whitespace only; anything else before it means it is not the prefix.
# The PYLONS prefix is a CANARY, not a rule the gate enforces (Dan, 2026-09-25). It lives only in
# the global CLAUDE.md so that a session which stops opening with it shows Dan, at a glance, that
# it has started forgetting its rules. Never make the lint require it: a hook that forces the
# prefix would keep it present exactly when the session has gone dumb, and kill the signal.
# The lint strips it (so its fence is not counted as monospace) and that is all.
PYLONS_PREFIX_PATTERN = re.compile(
    r"\A\s*```diff\r?\n- YOU MUST CONSTRUCT ADDITIONAL PYLONS\r?\n```[ \t]*\r?\n?"
)
INLINE_CODE_PATTERN = re.compile(r"`[^`\n]+`")
# Dan, 2026-09-02: "I don't need to see filepaths or code or anything formatted
# in monospaced text. PRs, tickets, specs, PRDs -- those are for you." Monospace
# in a reply is a tell that the reply is carrying working material rather than a
# status. Say it in words, or put it in the artifact where it belongs.
PATH_PATTERN = re.compile(r"(?:[A-Za-z]:\\|\./|/)[\w.\\/-]{6,}|\b[\w-]+\.(?:py|json|md|ya?ml|js|ts)\b")
# Dan, 2026-09-09, flipping the 2026-09-02 rule after making /i-have-adhd standing:
# that skill's first rule is to open with the command or path he can act on, and a
# blanket ban deleted exactly that. So monospace and paths are now rationed rather
# than forbidden. A handful is the actionable opener; a pile is still the working
# material he objected to. Caps sized to the ADHD skill's own five-item list cap.
INLINE_SPAN_CAP = 4
PATH_CAP = 3


def _caveman_lint(text: str, mode: str = "ultra") -> list[str]:
    profile = LINT_PROFILES.get(mode)
    if profile is None:
        return []  # caveman off: nothing to lint
    word_cap = profile["word_cap"]
    articles_cap = profile["articles_cap"]
    sentence_cap = profile["sentence_cap"]
    # Dan, 2026-09-03: the global CLAUDE.md orders every reply to open with the PYLONS diff fence,
    # and the no-monospace rule flagged that fence on every turn. The directive wins; the lint
    # ignores that one block, at the top only, and still counts every other fence.
    text = PYLONS_PREFIX_PATTERN.sub("", text, count=1)
    prose = _strip_code(text)
    words = prose.split()
    violations: list[str] = []
    # A ```bash block is a command the user can click Run on, so it is the
    # deliverable when they ask how to do something — not working material
    # leaking into a status report. Every other fence still counts.
    runnable = len(RUNNABLE_FENCE_PATTERN.findall(text))
    fences = max(0, len(FENCE_PATTERN.findall(text)) // 2 - runnable)
    spans = len(INLINE_CODE_PATTERN.findall(text))
    if fences or spans > INLINE_SPAN_CAP:
        violations.append(
            f"monospaced text in a reply: {fences} code block(s), {spans} inline span(s)"
            f" — a lead-in command is fine, at most {INLINE_SPAN_CAP} spans and no"
            " non-runnable fence; put the rest in the artifact"
        )
    # Web links are citations, not working material — Dan objected to file paths,
    # not to sources. Strip URLs before scanning so a cited link is never flagged.
    pathless = re.sub(r"https?://\S+", " ", prose)
    paths = sorted({m.group(0) for m in PATH_PATTERN.finditer(pathless)})
    if len(paths) > PATH_CAP:
        violations.append(
            f"file paths in a reply: {len(paths)} distinct ("
            + ", ".join(paths[:4])
            + f") — at most {PATH_CAP}, the ones he acts on; name the rest in words"
        )
    fillers = sorted({m.group(0).lower() for m in FILLER_PATTERN.finditer(prose)})
    if fillers:
        violations.append("banned filler/hedge words: " + ", ".join(fillers))
    if len(words) > word_cap:
        violations.append(f"too long: {len(words)} words (cap {word_cap})")
    if articles_cap is not None and len(words) >= 50:
        density = 100.0 * len(ARTICLE_PATTERN.findall(prose)) / len(words)
        if density > articles_cap:
            violations.append(
                f"article density {density:.1f}/100 words (cap {articles_cap:g}) — drop a/an/the"
            )
    sentences = [s.strip() for s in SENTENCE_SPLIT.split(prose) if s.strip()]
    long_sentences = [s for s in sentences if len(s.split()) > sentence_cap]
    if long_sentences:
        worst = max(long_sentences, key=lambda s: len(s.split()))
        violations.append(
            f"{len(long_sentences)} sentence(s) over {sentence_cap} words"
            f" (longest {len(worst.split())}) — split them"
        )
    return violations


# ---------------------------------------------------------------------------- ADHD lint
# Issue 177. Four of the ten `/i-have-adhd` rules are structural enough for a script to see: open on
# an action or a result rather than context (rule 1), number work that runs three steps or more
# (rule 2), keep a visible list at five items (rule 9), close on one next action and never on a
# pleasantry (rules 3 and 10). The rest -- suppress tangents, concrete time estimates, make finished
# work visible -- are judgement calls and stay with the reader. Runs only while _adhd_state() is
# "on"; the caveman and YES checks do not consult that flag.
ADHD_LIST_CAP = 5
ADHD_IMPERATIVES = frozenset((
    "add", "apply", "approve", "ask", "build", "call", "cancel", "check", "choose", "clear",
    "click", "close", "commit", "compare", "confirm", "copy", "create", "delete", "deploy",
    "diff", "do", "drop", "edit", "email", "enable", "fix", "give", "go", "install", "keep",
    "land", "leave", "look", "merge", "move", "open", "paste", "pick", "point", "pull", "push",
    "read", "rebase", "reboot", "remove", "rename", "reply", "rerun", "restart", "restore",
    "retry", "review", "revert", "run", "save", "say", "see", "send", "set", "ship", "sign",
    "skip", "start", "stop", "switch", "sync", "tell", "test", "try", "turn", "update", "upload",
    "use", "verify", "wait", "watch", "write",
))
ADHD_NEXT_PREFIX = re.compile(r"^(next|do now|do this|start here|action)\s*[:\-]", re.IGNORECASE)
# A result is what just happened, in his terms: a verdict, a count, or a position in the run. The
# test is the FIRST CLAUSE only ("Queue empty. Tests pass." is a result; "The sync script reads the
# whitelist, which is where the copy list lives." is context), because a verdict word buried three
# sentences down is exactly the buried lede rule 1 exists to stop.
ADHD_RESULT_PATTERN = re.compile(
    r"\b(done|finished|complete[d]?|fixed|broke|broken|fail(s|ed|ing)?|pass(es|ed|ing)?|empty|"
    r"missing|absent|ready|blocked|merged|pushed|committed|shipped|landed|refused|rejected|denied|"
    r"stale|clean|dirty|green|red|gone|dead|works?|working|worked|exit(s|ed)?|wrong|correct|"
    r"unchanged|identical|match(es|ed)?|already|still|not\b|no\b|none|nothing|yes\b|"
    r"step\s+\d+\s+of\s+\d+|\d+\s+of\s+\d+|\d+)\b",
    re.IGNORECASE,
)
# ...and a first clause carrying a past-tense verb is a result whatever the verb is ("Hook wired",
# "Branch rebased"), which is most of how a status line actually reads.
ADHD_PAST_TENSE = re.compile(r"\b[a-z]{3,}ed\b", re.IGNORECASE)
# First clause: up to the first sentence end, and at most this many words of it.
ADHD_CLAUSE_WORDS = 12
ADHD_FORBIDDEN_OPENER = re.compile(
    r"^(great|good|nice)\s+(question|catch|point|idea)\b"
    r"|^(sure|certainly|absolutely|of course|got it|understood|no problem)\b"
    r"|^(thanks|thank you)\b|^happy to\b|^i'?d be happy\b"
    r"|^let me\b|^i'?ll\b|^i'?m going to\b|^i will\b|^i'?ve\b|^i have\b"
    r"|^(first|to start|to begin|before i|before we)\b|^as (you|we) (can see|know|requested)\b"
    r"|^here'?s (what|the|a)\b|^looking at\b|^based on\b",
    re.IGNORECASE,
)
ADHD_FORBIDDEN_CLOSER = re.compile(
    r"^(hope (this|that) helps|(is there )?anything else|feel free\b|does (that|this) (help|make sense)"
    r"|happy to help|glad to help|that'?s it\b|all set\b|you'?re all set\b|good luck\b)",
    re.IGNORECASE,
)
ADHD_LIST_MARKER = re.compile(r"^(?:[-*+]|\d+[.)])\s+")
ADHD_NUMBERED_MARKER = re.compile(r"^\d+[.)]\s+")
ADHD_BULLET_MARKER = re.compile(r"^[-*+]\s+")
ADHD_DECORATION = re.compile(r"[*_`#>\[\]]")


def _adhd_body(text: str) -> str:
    """The reply minus the mandated PYLONS prefix and minus fenced code blocks."""
    body = PYLONS_PREFIX_PATTERN.sub("", text, count=1)
    return re.sub(r"```.*?```", "\n", body, flags=re.DOTALL)


def _adhd_bare(line: str) -> str:
    """One line with its list marker and markdown decoration removed."""
    return ADHD_DECORATION.sub("", ADHD_LIST_MARKER.sub("", line)).strip()


def _adhd_is_action(line: str) -> bool:
    bare = _adhd_bare(line)
    if not bare:
        return False
    if ADHD_NEXT_PREFIX.match(bare):
        return True
    first = re.split(r"[^A-Za-z'-]+", bare, maxsplit=1)[0].lower()
    return first in ADHD_IMPERATIVES


def _adhd_is_result(line: str) -> bool:
    clause = re.split(r"[.;:!?]", _adhd_bare(line), maxsplit=1)[0]
    clause = " ".join(clause.split()[:ADHD_CLAUSE_WORDS])
    return bool(ADHD_RESULT_PATTERN.search(clause) or ADHD_PAST_TENSE.search(clause))


def _adhd_lint(text: str) -> list[str]:
    """ADHD shaping violations a script can see. Empty list when the shape is right."""
    body = _adhd_body(text)
    raw_lines = body.splitlines()
    lines = [ln.strip() for ln in raw_lines if ln.strip()]
    # A reply that opens or closes on a fenced command leads with the thing he can run, which is
    # rule 1 and rule 3 satisfied in their strongest form.
    opens_on_fence = PYLONS_PREFIX_PATTERN.sub("", text, count=1).lstrip().startswith("```")
    ends_on_fence = PYLONS_PREFIX_PATTERN.sub("", text, count=1).rstrip().endswith("```")
    violations: list[str] = []
    if not lines:
        return violations

    first, last = lines[0], lines[-1]
    if ADHD_FORBIDDEN_OPENER.match(_adhd_bare(first)):
        violations.append(
            'ADHD preamble opener: "' + first[:60]
            + '" — no preamble or narration; open on the action or on what just happened'
        )
    elif not (opens_on_fence or _adhd_is_action(first) or _adhd_is_result(first)):
        violations.append(
            'ADHD opener is context, not an action or a result: "' + first[:60]
            + '" — first line must be something he can do, or the verdict'
        )

    numbered = [ln for ln in lines if ADHD_NUMBERED_MARKER.match(ln)]
    step_bullets = [
        ln for ln in lines if ADHD_BULLET_MARKER.match(ln) and _adhd_is_action(ln)
    ]
    if len(step_bullets) >= 3 and len(numbered) < len(step_bullets):
        violations.append(
            f"ADHD unnumbered steps: {len(step_bullets)} action bullets, no numbered list"
            " — number multi-step work so he can see where he is"
        )

    run = longest = 0
    for raw in raw_lines:
        stripped = raw.strip()
        if not stripped:
            continue  # a blank line between items is still one list
        if ADHD_LIST_MARKER.match(stripped):
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    if longest > ADHD_LIST_CAP:
        violations.append(
            f"ADHD list of {longest} items (cap {ADHD_LIST_CAP})"
            " — five ranked beats ten unranked; split do-now from later"
        )

    if ADHD_FORBIDDEN_CLOSER.match(_adhd_bare(last)):
        violations.append(
            'ADHD closing pleasantry: "' + last[:60]
            + '" — end on the next action instead'
        )
    elif not (ends_on_fence or _adhd_is_action(last)):
        violations.append(
            'ADHD no next action: last line is "' + last[:60]
            + '" — end with ONE thing he can do in under two minutes, opened "Next:"'
        )
    return violations


# ---------------------------------------------------------------------------- YES gates
# Dan, 2026-09-03: "how can we force /yes adherence into the hook?" Most of YES is judgment; these
# are the parts a script can check. They run at every caveman level, off included — YES is not a
# style. Three text rules audited on the reply (pre-send lint and Stop), one PreToolUse gate on
# config-shaped edits, one PostToolUse failure counter for the escalation ladder.
READ_CLASS_TOOLS = {
    "Read", "Bash", "PowerShell", "Grep", "Glob", "WebFetch", "WebSearch", "NotebookRead",
    "LS", "Agent", "Task",
}
HEDGE_PATTERN = re.compile(
    r"\b(probably|likely|i think|i believe|i assume|i guess)\b|\bmight be\b|\bseems? like\b"
    r"|\bshould (be|work)\b",
    re.IGNORECASE,
)
DEFLECTION_PATTERN = re.compile(
    r"\b(please (check|verify|test|confirm)|you can (test|try|verify|check) (it|this|that|them)( now)?"
    r"|you may need to|you might need to|you should manually|you('ll| will) need to (run|check|verify)"
    r"|should (now )?work|let me know if (it|this|that|anything)|try it and see)\b",
    re.IGNORECASE,
)
VERIFIED_CLAIM_PATTERN = re.compile(
    r"\b(verified|confirmed|tests? pass(es|ed)?|all green|works now|now works|is working|done and tested"
    r"|passes|exit(s|ed)? 0)\b",
    re.IGNORECASE,
)
CERTAINTY_PATTERN = re.compile(
    r"\b(definitely|the culprit( is| was)?|must be the|root cause is|has to be the|without a doubt)\b"
    r"|\bcert" + r"ainly\b",
    re.IGNORECASE,
)
SOURCE_CHARACTERISATION_PATTERN = re.compile(
    r"\b(the |that |this )?(\S+\.(?:pdf|docx?|md|txt|json|ya?ml|csv|xlsx?|pptx?|html?|js|ts|py|ps1)"
    r"|document|pdf|spreadsheet|deck|file|page|ticket|issue|thread|transcript|spec|readme|runbook)"
    r"\b[^.!?\n]{0,80}\b(contains|includes|says|states|mentions|lists|shows|has no|does not (mention|contain|include|say)"
    r"|doesn'?t (mention|contain|include|say)|no mention of|is silent on|never mentions)\b",
    re.IGNORECASE,
)


# A statement that something is absent or not in a state: "not on the board", "isn't merged",
# "no review threads", "has not been shared". Dan, 2026-09-25: after a refused write (GraphQL and
# /users REST both 403) the reply told him "the issues are not on the Projects board"; board
# auto-add had placed all eleven. A refused write proves only that the write was refused.
NEGATIVE_STATE_PATTERN = re.compile(
    r"\b(is|are|was|were|has|have)(n'?t| not)( been)? (on|in|added|shared|merged|linked|attached|"
    r"created|published|deployed|synced|there|present|visible|enabled)\b"
    r"|\bnot (yet )?(on|in) the\b|\bno (review|reviews|review threads|comments|checks|cards?|items?)\b",
    re.IGNORECASE,
)
# "No review threads", "no reviews left", "there are no review comments" said about a PR: this is
# its own rule (not gated on a refusal, unlike NEGATIVE_STATE_PATTERN's "absence" above) because
# nothing needs to have been refused for the claim to be premature — the reply just never read the
# reviews. Dan, 2026-09-25: a draft said "no review threads" without ever calling get_reviews.
REVIEW_ABSENCE_PATTERN = re.compile(
    r"\bno review threads?\b|\breview threads?:?\s*none\b|\bno (unresolved )?review comments\b"
    r"|\bno (open )?review(er)?s?( left| pending)?\b(?!\s*(process|policy|guideline))",
    re.IGNORECASE,
)
# What a refused call looks like in a tool result: an HTTP 401/403/404/405/407, or the proxy's and
# the tool layer's refusal wording. Read from the tool_result blocks of the current turn.
REFUSED_RESULT_PATTERN = re.compile(
    r"\b(40[1357])\b|not available|not permitted|permission denied|denied by|access denied"
    r"|forbidden|refused|unauthori[sz]ed",
    re.IGNORECASE,
)


def _turn_refusals(transcript_path: str) -> list[str] | None:
    """Tool results since the last real user prompt that read as a refused call. None = unreadable."""
    if not transcript_path:
        return None
    refused: list[str] = []
    try:
        with open(transcript_path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("type") != "user":
                    continue
                content = (record.get("message") or {}).get("content")
                blocks = content if isinstance(content, list) else []
                results = [b for b in blocks if isinstance(b, dict) and b.get("type") == "tool_result"]
                if not results:
                    refused = []  # a real user prompt starts a new turn
                    continue
                for block in results:
                    body = block.get("content")
                    if isinstance(body, list):
                        body = " ".join(str(part.get("text", "")) for part in body if isinstance(part, dict))
                    body = str(body or "")
                    if block.get("is_error") or REFUSED_RESULT_PATTERN.search(body):
                        refused.append(body[:120])
    except Exception:
        return None
    return refused


# A "get_reviews"/"get_review_comments" call is the GitHub MCP tool `pull_request_read` (or the
# equivalent `gh` wrapper) invoked with that method, not a distinct tool name — so _turn_tool_names
# also folds the method argument in, as its own entry, whenever this tool is the one called.
PR_REVIEW_READ_TOOL_NAMES = {"pull_request_read", "mcp__github__pull_request_read"}
PR_REVIEW_READ_METHODS = {"get_reviews", "get_review_comments"}


def _turn_tool_names(transcript_path: str) -> set[str] | None:
    """Tools the assistant called since the last real user prompt. None when unreadable.
    For `pull_request_read`, the `method` argument is folded in too (e.g. "get_reviews"), so a
    caller can tell a review read apart from any other use of that one multi-method tool."""
    if not transcript_path:
        return None
    names: set[str] = set()
    try:
        with open(transcript_path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                kind = record.get("type")
                message = record.get("message") or {}
                content = message.get("content")
                if kind == "user":
                    blocks = content if isinstance(content, list) else []
                    if not any(isinstance(b, dict) and b.get("tool_use_id") for b in blocks):
                        names = set()  # a real user prompt starts a new turn
                    continue
                if kind != "assistant":
                    continue
                for item in content if isinstance(content, list) else []:
                    if isinstance(item, dict) and item.get("type") == "tool_use":
                        name = str(item.get("name") or "")
                        names.add(name)
                        if name in PR_REVIEW_READ_TOOL_NAMES:
                            method = str((item.get("input") or {}).get("method") or "")
                            if method in PR_REVIEW_READ_METHODS:
                                names.add(method)
    except Exception:
        return None
    return names


def _find_transcript(session_id: str) -> str:
    """The session's transcript under ~/.claude/projects, or '' when not found."""
    if not session_id or not _safe_id(session_id):
        return ""
    root = CLAUDE_HOME / "projects"
    try:
        matches = list(root.glob(f"*/{session_id}.jsonl"))
    except OSError:
        return ""
    return str(matches[0]) if matches else ""


# Issue 723: the five regexes above are keyword matches, so a reply that QUOTES a banned word ("the
# rule bans words like probably") was flagged. Each regex hit is now put to a TypeSafe Jev Noul
# about the reply's own voice, and a hit Jev says the reply does not itself commit is dropped. Jev
# only suppresses; it never adds a finding the regex missed. The tool-ran facts that gate the last
# three rules stay in code. When Jev is unavailable (no credential, timeout, error) or the helper
# cannot be imported, the regex verdicts stand unchanged.
YES_JEV_OWN_VOICE = (
    " Judge only what `reply` itself says in its own voice: words it quotes, lists, names as"
    " examples, or discusses as words do not count."
)
YES_JEV_QUESTIONS = {
    "hedge": "Does `reply` assert a cause or a state of things as a guess rather than as a checked"
    " fact?" + YES_JEV_OWN_VOICE,
    "deflection": "Does `reply` ask the user to run a check, test or verification that the assistant"
    " could run itself?" + YES_JEV_OWN_VOICE,
    "claim": "Does `reply` claim that something was tested, verified or confirmed?" + YES_JEV_OWN_VOICE,
    "certainty": "Does `reply` state a root cause or diagnosis with certainty?" + YES_JEV_OWN_VOICE,
    "source": "Does `reply` describe what a named file, ticket, page or document contains or says?"
    + YES_JEV_OWN_VOICE,
    "absence": "Does `reply` state that something is missing, absent or not in some state (not on a"
    " board, not merged, no reviews) as a fact?" + YES_JEV_OWN_VOICE,
    "review-read": "Does `reply` claim there are no PR review threads, reviews or review comments,"
    " as a fact about the PR's current state?" + YES_JEV_OWN_VOICE,
}
YES_JEV_FLOOR = 0.5  # below this Jev says the reply does not itself do it, and the hit is dropped
YES_JEV_TIMEOUT = 3.0  # seconds; the Stop hook's whole budget is 5


def _yes_jev_verdicts(prose: str, rules: list[str]) -> dict[str, float] | None:
    """Jev's probability per fired rule that the reply itself commits it; None = unavailable."""
    if not rules:
        return {}
    jev = _jev_module()
    if jev is None:
        return None
    return jev.ask_nouls(
        {"reply": prose}, {rule: YES_JEV_QUESTIONS[rule] for rule in rules}, timeout=YES_JEV_TIMEOUT
    )


def _yes_lint(
    text: str, turn_tools: set[str] | None, turn_refusals: list[str] | None = None
) -> list[str]:
    """YES violations a script can see in a reply. `turn_tools` None = transcript unknown.
    `turn_refusals` holds this turn's refused tool results; None or empty means none were seen."""
    prose = _strip_code(PYLONS_PREFIX_PATTERN.sub("", text, count=1))
    found: list[tuple[str, str]] = []
    hedges = sorted({m.group(0).lower() for m in HEDGE_PATTERN.finditer(prose)})
    if hedges:
        found.append((
            "hedge",
            "YES hedge without evidence: " + ", ".join(hedges[:4]) + " — check, then state it"
        ))
    deflections = sorted({m.group(0).lower() for m in DEFLECTION_PATTERN.finditer(prose)})
    if deflections:
        found.append((
            "deflection",
            "YES deflection: " + ", ".join(deflections[:3])
            + " — do the check yourself and show the output"
        ))
    if turn_tools is not None and not turn_tools:
        claims = sorted({m.group(0).lower() for m in VERIFIED_CLAIM_PATTERN.finditer(prose)})
        if claims:
            found.append((
                "claim",
                "YES unverified claim: " + ", ".join(claims[:3])
                + " — no tool ran this turn, so nothing was verified"
            ))
        certain = sorted({m.group(0).lower() for m in CERTAINTY_PATTERN.finditer(prose)})
        if certain:
            found.append((
                "certainty",
                "YES conclusion without data: " + ", ".join(certain[:3])
                + " — no tool ran this turn; state the data source or drop the certainty"
            ))
    if turn_tools is not None and not (turn_tools & READ_CLASS_TOOLS):
        sourced = SOURCE_CHARACTERISATION_PATTERN.search(prose)
        if sourced:
            snippet = sourced.group(0).strip()
            found.append((
                "source",
                "YES unread source: \"" + snippet[:70]
                + "\" — nothing was opened this turn; read it or say it is unread"
            ))
    if turn_refusals:
        absent = NEGATIVE_STATE_PATTERN.search(prose)
        if absent:
            found.append((
                "absence",
                "YES absence stated after a refused call: \"" + absent.group(0)
                + "\" — a refused write is not a read of state; read the state, or say you could not check"
            ))
    if turn_tools is not None and not (turn_tools & PR_REVIEW_READ_METHODS):
        review_absent = REVIEW_ABSENCE_PATTERN.search(prose)
        if review_absent:
            found.append((
                "review-read",
                "YES review claim before the read: \"" + review_absent.group(0)
                + "\" — call get_reviews or get_review_comments before saying there are none"
            ))
    verdicts = _yes_jev_verdicts(prose, [rule for rule, _ in found])
    if verdicts is None:
        return [message for _, message in found]
    return [message for rule, message in found if verdicts[rule] >= YES_JEV_FLOOR]


CONFIG_FILE_PATTERN = re.compile(
    r"(^|[\\/])(settings(\.local)?\.json|managed-settings[^\\/]*\.json|\.env[^\\/]*|[^\\/]*\.env"
    r"|docker-compose[^\\/]*\.ya?ml|compose\.ya?ml|appsscript\.json|hooks\.json|\.clasp\.json|gas\.json"
    r"|[^\\/]*\.toml|CLAUDE\.md|AGENTS\.md|\.mcp\.json)$",
    re.IGNORECASE,
)
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


BACKUP_MAX_AGE_SECONDS = 24 * 3600


def _has_backup(path: Path) -> bool:
    """A .bak* sibling from the last day. The first edit of a session needs the copy; later edits
    the same day keep that copy as their rollback, so they are not asked for another."""
    try:
        import time
        cutoff = time.time() - BACKUP_MAX_AGE_SECONDS
        for sibling in path.parent.glob(path.name + ".bak*"):
            if sibling.is_file() and sibling.stat().st_mtime >= cutoff:
                return True
    except OSError:
        return False
    return False


def _git_clean(path: Path) -> bool:
    try:
        done = subprocess.run(
            ["git", "-C", str(path.parent), "status", "--porcelain", "--", path.name],
            capture_output=True, text=True, timeout=4, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if done.returncode != 0:
        return False
    tracked = subprocess.run(
        ["git", "-C", str(path.parent), "ls-files", "--error-unmatch", "--", path.name],
        capture_output=True, text=True, timeout=4, check=False,
    )
    return tracked.returncode == 0 and not done.stdout.strip()


def _backup_gate(event: dict[str, Any]) -> dict[str, Any] | None:
    """YES safety gate: no edit to a config-shaped file without a backup or a clean git copy."""
    if str(event.get("tool_name") or "") not in EDIT_TOOLS:
        return None
    tool_input = event.get("tool_input") if isinstance(event.get("tool_input"), dict) else {}
    raw = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not isinstance(raw, str) or not CONFIG_FILE_PATTERN.search(raw):
        return None
    path = Path(raw)
    if not path.is_file():
        return None  # creating a new file needs no backup
    if _has_backup(path) or _git_clean(path):
        return None
    return _deny(
        f"YES backup gate: {path.name} shapes behaviour and has no backup. Copy it first "
        f"(cp \"{raw}\" \"{raw}.bak-<why>\") or commit it clean, then retry the edit."
    )


FAILURE_HINT_PATTERN = re.compile(
    r"\bexit(=| code |code=)?[1-9]\d*\b|Traceback \(most recent call last\)|command not found"
    r"|\bfatal:|\berror:|\bERROR\b|\bException\b|\bFAILED\b|\bfailed with\b",
)
SUCCESS_HINT_PATTERN = re.compile(r"\bexit(=| code )0\b")


def _tool_failed(tool_response: Any) -> bool:
    """Best-effort read of a Bash/PowerShell result. Hook input carries no exit code on this
    build (transcripts show stdout/stderr/interrupted only), so this is a heuristic: an explicit
    error flag, or failure text with no explicit exit 0."""
    if isinstance(tool_response, dict):
        if tool_response.get("is_error") is True or tool_response.get("interrupted") is True:
            return True
        text = str(tool_response.get("stdout") or "") + "\n" + str(tool_response.get("stderr") or "")
    else:
        text = str(tool_response or "")
    if SUCCESS_HINT_PATTERN.search(text):
        return False
    return bool(FAILURE_HINT_PATTERN.search(text))


ESCALATION = {
    2: "YES escalation, 2 failures in a row: switch approach — not a parameter tweak.",
    3: "YES escalation, 3 failures: five-step audit. Read the error word by word; search the exact "
       "error; read 50 lines of context; verify every assumption; invert the hypothesis.",
    4: "YES escalation, 4 failures: build a minimal reproduction before touching anything else.",
    5: "YES escalation, 5+ failures: stop. Write a structured handoff — verified facts, eliminated "
       "causes, narrowed scope, next steps. Persistence in the wrong direction is worse than stopping.",
}


def _claude_post_tool(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    if not _is_shell_tool(event.get("tool_name")) or not session_id:
        return {}
    # The pre-send lint exits 1 by design until the draft is clean; rewriting a draft is not a
    # debugging failure and must not climb the ladder (it did, twice, on 2026-09-03).
    if "ask_matt_gate.py" in _command_of(event) and " lint " in _command_of(event):
        return {}
    state = _read_state("claude", session_id) or {}
    failures = int(state.get("consecutive_failures") or 0)
    failures = failures + 1 if _tool_failed(event.get("tool_response")) else 0
    state["consecutive_failures"] = failures
    _write_state("claude", session_id, state)
    if failures < 2:
        return {}
    message = ESCALATION[min(failures, 5)]
    _log_governance(session_id, f"escalation level {failures}")
    return {
        "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": message},
        "suppressOutput": True,
    }


def _claude_stop(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    state = _read_state("claude", session_id)
    mode = (state or {}).get("caveman")
    if mode not in CAVEMAN_PROSE_MODES + ("off",):
        mode = _read_caveman_mode()
    governed = bool(
        state
        and state.get("flow")
        and state.get("yes") is True
        and state.get("caveman") in CAVEMAN_PROSE_MODES + ("off",)
    )
    notes: list[str] = []
    if not governed:
        # Blocking here is what produces the duplicate reply people see: the message has already
        # rendered by the time a Stop hook runs, so a block cannot take it back — it only makes the
        # model write a second one. Enforcement therefore lives at UserPromptSubmit (the route is in
        # context before the model writes) and at PreToolUse (which really can refuse). Stop only
        # reconciles what those two left, and blocks in exactly one case: a session where no route
        # was ever declared, where there is no earlier state to reconcile against and a second
        # message is the lesser cost.
        carried = (state or {}).get("last_flow")
        if not carried:
            # That block is only worth anything if the model can satisfy it, and the sole way to
            # declare a route is a Bash or PowerShell command. A session that has neither — a
            # headless `claude -p` with Bash denied — can never satisfy it, so an unconditional
            # refusal loops until the turn limit and hands the caller an empty `result` with
            # `is_error: false`, the worst failure shape there is (issue 499). So refuse ONCE per
            # turn (the stamp is nonce-keyed, and a fresh prompt writes fresh state, so the next
            # turn is refused once too), then let the turn end with the undeclared route
            # recorded — the per-turn rigor survives, the deadlock does not. Claude Code's own
            # `stop_hook_active` flag is the same bound from the other side; either one releases.
            nonce = (state or {}).get("nonce") or True
            refused = bool(state) and state.get("stop_refused") == nonce
            current = dict(state or {})
            if event.get("stop_hook_active") or refused:
                current["undeclared_stop"] = True
                _write_state("claude", session_id, current)
                _log_governance(
                    session_id, "undeclared turn allowed to end: no route could be declared"
                )
                return {
                    "systemMessage": (
                        "GOVERNANCE: this turn ended with no route declared and none to reconcile "
                        "against — recorded as undeclared. Declare one next turn; if this session "
                        "has no Bash or PowerShell tool, say so in your reply."
                    )
                }
            current["stop_refused"] = nonce
            _write_state("claude", session_id, current)
            return {
                "decision": "block",
                "reason": (
                    "Declare Ask Matt route; apply Yes governance; use caveman ultra. No Bash or "
                    "PowerShell tool to declare it with? Say that in your reply and end the turn — "
                    "this gate refuses once, then records the turn as undeclared and lets it end."
                ),
            }
        _write_state(
            "claude",
            session_id,
            {
                "nonce": (state or {}).get("nonce"),
                "flow": carried,
                "last_flow": carried,
                "yes": True,
                "caveman": mode,
            },
        )
        _log_governance(session_id, f"undeclared turn reconciled to last route: {carried}")
        notes.append(
            f"GOVERNANCE: this turn ended with no route declared — recorded as `{carried}`. "
            "Declare explicitly next turn."
        )
    if event.get("stop_hook_active"):
        return {"systemMessage": " ".join(notes)} if notes else {}
    # The pre-send audit runs on EVERY path below, including the ones that used to return early: a
    # turn whose transcript is unreadable, or whose final message is clean, can still have skipped the
    # lint, and those are exactly the turns where skipping goes unnoticed.
    violations = _presend_audit(session_id, _read_state("claude", session_id))
    transcript_path = str(event.get("transcript_path") or "")
    miss = _correction_audit(_read_state("claude", session_id), transcript_path)
    if miss:
        current = _read_state("claude", session_id) or {}
        current["pending_correction"] = miss
        _write_state("claude", session_id, current)
        _log_governance(session_id, "correction turn ended with no system change")
        notes.append(miss)
    try:
        final_text = _last_assistant_text(transcript_path) if transcript_path else ""
        if final_text.strip():
            violations = violations + _yes_lint(
                final_text, _turn_tool_names(transcript_path), _turn_refusals(transcript_path)
            )
            violations = violations + _caveman_lint(final_text, mode)
    except Exception:
        pass  # lint must never wedge a session; the audit above still stands
    if not violations:
        return {"systemMessage": " ".join(notes)} if notes else {}
    # Not blocked, but not merely advisory either: the violations are parked in the session state
    # and the next UserPromptSubmit injects them as a correction the model reads before it writes.
    # That is the only place a style rule can still change an outgoing message without producing a
    # second one.
    _log_lint(session_id, violations)
    current = _read_state("claude", session_id) or {}
    current["pending_lint"] = violations
    _write_state("claude", session_id, current)
    notes.append(
        "CAVEMAN lint (turn not blocked — a block would post a duplicate reply): "
        + "; ".join(violations)
        + f". Logged to {_lint_log_path()}; enforced on your next message."
    )
    return {"systemMessage": " ".join(notes)}


def _correction_audit(state: dict[str, Any] | None, transcript_path: str) -> str:
    """A correction turn that edited no durable file. Returns the note to carry, or "".

    Unreadable transcripts are not audited: inventing a miss from missing data would train the
    reader to ignore this note, the same reasoning as `_presend_audit`.
    """
    state = state or {}
    if not state.get("nonce") or state.get("correction_nonce") != state.get("nonce"):
        return ""
    tools = _turn_tool_names(transcript_path)
    if tools is None or tools & SYSTEM_CHANGE_TOOLS:
        return ""
    return (
        "CORRECTION NOT CLOSED: Dan's last message corrected you and the turn changed no file. "
        "The instance may be fixed; the class is not. Land the durable fix (skill, rule, hook, "
        "test or schema) this turn and name it."
    )


def _presend_audit(session_id: str, state: dict[str, Any] | None) -> list[str]:
    """Did this turn run the pre-send lint against the CURRENT nonce? Returns a complaint, or [].

    The stamp is per-nonce rather than a bare boolean on purpose: a stale `True` from an earlier turn
    would read as compliance for every turn after it, which is the failure mode an honour-based check
    always has. A turn with no nonce at all (undeclared, already reconciled above) is not audited —
    there is nothing to compare against, and inventing a complaint from missing state would train the
    reader to ignore this one.
    """
    state = state or {}
    nonce = state.get("nonce")
    if not nonce:
        return []
    if state.get("lint_clean_nonce") == nonce:
        return []
    return [
        "the reply was sent WITHOUT the required pre-send lint (no clean run against this turn's "
        "nonce). Draft to a file, lint it, rewrite until it exits 0, then send — that is the only "
        "step that can stop bad text instead of reporting it"
    ]


def _pre_tool(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    turn_id = str(event.get("turn_id") or "")
    state = _read_state(session_id, turn_id)
    if not state or state.get("turn_id") != turn_id or not state.get("flow"):
        if _is_declaration_command(event):
            return {}
        return _deny(
            f"Ask Matt route missing. Run: {_runner_spelling()} \"{SCRIPT}\" declare \"{turn_id}\" <flow>"
        )
    return {}


def _declare(turn_id: str, flow: str) -> int:
    if flow not in ALLOWED_FLOWS:
        print(f"Ask Matt route rejected: {flow}", file=sys.stderr)
        return 2
    session_id = str(os.environ.get("CODEX_THREAD_ID") or "")
    state = _read_state(session_id, turn_id)
    if not session_id or not state or not state.get("turn_id"):
        print("Ask Matt route rejected: no pending Codex turn", file=sys.stderr)
        return 2
    _write_state(
        session_id,
        turn_id,
        {
            "turn_id": state["turn_id"],
            "flow": flow,
            "yes": True,
            "caveman": "ultra",
        },
    )
    print(f"Ask Matt route recorded: {flow}")
    return 0


def _stop(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    turn_id = str(event.get("turn_id") or "")
    state = _read_state(session_id, turn_id)
    if state and state.get("turn_id") == turn_id and state.get("flow"):
        return {}
    return {
        "decision": "block",
        "reason": (
            "Ask Matt route still missing. Name the route, then run: "
            f"{_runner_spelling()} \"{SCRIPT}\" declare \"{turn_id}\" <flow>"
        ),
    }


def _lint_draft(path: str, session_id: str = "") -> int:
    """Lint a DRAFT before it is sent. The only place a style violation can be stopped rather than
    reported: every hook event either fires before the text exists or after it has been displayed
    (`MessageDisplay` is read-only by the docs' own words, and a Stop block appends a second reply
    instead of retracting the first — observed three times on 2026-08-12). So the model writes its
    draft to a file, runs this, and rewrites before anything reaches the user.

    Reads from `path`, or from stdin when path is '-' or absent. Prints one violation per line and
    exits 1 when any are found, 0 when clean, so a caller can gate on the exit code.

    When `session_id` is given, a CLEAN result stamps `lint_clean_nonce` into that session's state.
    That stamp is what makes the discipline auditable rather than honour-based: `_claude_stop` reads
    it and, when the turn ended with no clean lint against the CURRENT nonce, says so and carries the
    complaint into the next turn's injected context. It cannot retract the unlinted message — nothing
    can — but a skipped step stops being invisible.
    """
    try:
        # utf-8-sig: Windows PowerShell 5.1 `Set-Content -Encoding utf8` writes a BOM, and a BOM that
        # survives into a violation message crashed the cp1252 console print (restore test, 2026-09-16).
        text = sys.stdin.read() if (not path or path == "-") else io.open(path, encoding="utf-8-sig").read()
    except OSError as error:
        print(f"caveman lint could not read draft: {error}", file=sys.stderr)
        return 2
    state = (_read_state("claude", session_id) or {}) if session_id else {}
    mode = state.get("caveman")
    if mode not in CAVEMAN_PROSE_MODES + ("off",):
        mode = _read_caveman_mode()
    # YES rules run at every level, off included: they are about truth, not style. The transcript
    # tells the lint which tools ran this turn; without a session there is no transcript and the
    # tool-dependent rules stay quiet.
    turn_tools = _turn_tool_names(_find_transcript(session_id)) if session_id else None
    # ADHD shaping runs between the two: it is structure, so it stands at every caveman level,
    # off included, and it is the one rule set the reader can switch off (~/.claude/.adhd-off).
    adhd = _adhd_state()
    transcript = _find_transcript(session_id) if session_id else ""
    turn_refusals = _turn_refusals(transcript) if transcript else None
    appeal_violations, shaped = _appeal_lint(text, _current_appeal(state))
    violations = (
        appeal_violations
        + _yes_lint(text, turn_tools, turn_refusals)
        + (_adhd_lint(shaped) if adhd == "on" else [])
        + _caveman_lint(text, mode)
    )
    if not violations:
        words = len(_strip_code(text).split())
        if session_id:
            state["lint_clean_nonce"] = state.get("nonce")
            state["lint_clean_words"] = words
            _write_state("claude", session_id, state)
        adhd_note = "ADHD shaping pass" if adhd == "on" else "ADHD off (flag)"
        if mode == "off":
            print(f"lint clean: YES rules pass, {adhd_note}, caveman off ({words} words of prose)")
        else:
            print(f"lint clean: YES rules pass, {adhd_note}, caveman {mode} ({words} words of prose)")
        return 0
    for v in violations:
        print(f"lint: {v}")
    print("REWRITE BEFORE SENDING — this draft has not been shown to anyone yet.", file=sys.stderr)
    return 1


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "lint":
        return _lint_draft(
            sys.argv[2] if len(sys.argv) > 2 else "",
            sys.argv[3] if len(sys.argv) > 3 else "",
        )
    if mode == "declare":
        turn_id = sys.argv[2] if len(sys.argv) > 2 else ""
        flow = sys.argv[3] if len(sys.argv) > 3 else ""
        return _declare(turn_id, flow)
    if mode == "declare-claude":
        session_id = sys.argv[2] if len(sys.argv) > 2 else ""
        nonce = sys.argv[3] if len(sys.argv) > 3 else ""
        flow = sys.argv[4] if len(sys.argv) > 4 else ""
        return _claude_declare(session_id, nonce, flow)
    if mode == "appeal-claude":
        session_id, nonce, wanted = (sys.argv[2:5] + ["", "", ""])[:3]
        return _claude_appeal(session_id, nonce, wanted, " ".join(sys.argv[5:]))
    try:
        event = _read_event()
    except (json.JSONDecodeError, OSError, ValueError) as error:
        print(f"Ask Matt gate rejected hook input: {error}", file=sys.stderr)
        return 2
    if mode == "prompt":
        print(json.dumps(_prompt(event)))
        return 0
    if mode == "claude-prompt":
        print(json.dumps(_claude_prompt(event)))
        return 0
    if mode == "claude-pre-tool":
        print(json.dumps(_claude_pre_tool(event)))
        return 0
    if mode == "claude-stop":
        print(json.dumps(_claude_stop(event)))
        return 0
    if mode == "claude-post-tool":
        print(json.dumps(_claude_post_tool(event)))
        return 0
    if mode == "pre-tool":
        print(json.dumps(_pre_tool(event)))
        return 0
    if mode == "stop":
        print(json.dumps(_stop(event)))
        return 0
    print(json.dumps({"decision": "block", "reason": f"Unknown Ask Matt gate mode: {mode}"}))
    return 0


if __name__ == "__main__":
    # A cp1252 console cannot print every character a draft may contain; never let the lint
    # die on the report instead of reporting.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    raise SystemExit(main())
