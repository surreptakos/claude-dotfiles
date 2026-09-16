#!/usr/bin/env python3
"""Global Codex hook that requires an Ask Matt route on every turn."""

from __future__ import annotations

from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import secrets
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
_CAVEMAN_SLASH = re.compile(r"^/caveman(?::caveman)?(?:\s+(\S+))?\s*[.!]*$")


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


def _is_exact_declaration_command(command: str, turn_id: str) -> bool:
    if not isinstance(command, str):
        return False
    flows = "|".join(sorted(map(re.escape, ALLOWED_FLOWS)))
    script_paths = "|".join(
        re.escape(path) for path in {str(SCRIPT), SCRIPT.as_posix()}
    )
    pattern = (
        rf"\s*(?:python(?:\.exe)?|py(?:\.exe)?\s+-3)\s+"
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
    declaration = f'py -3 "{SCRIPT.as_posix()}" declare "{turn_id}" <flow>'
    code_declaration = (
        "text(await tools.shell_command({command:'"
        f'{declaration}'
        "'}))"
    )
    context = (
        "ASK-MATT GATE: Before tools or final answer, name applicable route in commentary, then run "
        f"`python \"{SCRIPT}\" declare \"{turn_id}\" <flow>`. "
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
        "inside a session."
    )
    return {
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context,
        }
    }


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
    }
    _write_state("claude", session_id, state)
    # Style violations from the previous turn are carried here rather than blocked at Stop. A Stop
    # block cannot retract the message it is judging — it only makes the model emit a second one —
    # so the correction lands where it can still change the output: before the next message.
    pending_lint = (previous or {}).get("pending_lint") or []
    context = (
        "ASK-MATT GATE: Before tools or final answer, name applicable route, then run "
        f"`python \"{SCRIPT}\" declare-claude \"{session_id}\" \"{nonce}\" <flow>`. "
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
    )
    # The pre-send lint, standing on every turn (owner instruction, 2026-08-12). It carries the YES
    # rules at every caveman level, off included, plus the style rules for the level in force. It is
    # the only enforcement point that can stop the offending message rather than report it: no hook
    # event sees assistant text before the user does.
    context += (
        "PRE-SEND LINT REQUIRED, EVERY REPLY: write your final reply to a file, run "
        f"`py -3 \"{SCRIPT}\" lint <file> \"{session_id}\"`, and rewrite until it exits 0. Send "
        "only the linted text. It checks YES (no deflection, no unverified claims, no conclusions "
        "without data, no characterising unread sources) plus the caveman level. Skipping this is "
        "recorded at Stop and reported back to you next turn."
    )
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


def _is_claude_declaration_command(
    event: dict[str, Any], session_id: str, nonce: str
) -> bool:
    if str(event.get("tool_name") or "") not in {"Bash", "PowerShell"}:
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
        rf"\s*(?:python(?:\.exe)?|py(?:\.exe)?\s+-3)\s+"
        rf"[\"']?(?:{script_paths})[\"']?\s+declare-claude\s+"
        rf"[\"']?{re.escape(session_id)}[\"']?\s+"
        rf"[\"']?{re.escape(nonce)}[\"']?\s+(?:{flows})"
        rf"(?:\s+2>&1;\s*echo\s+[\"']EXIT=\$\?[\"'])?\s*"
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
    if str(event.get("tool_name") or "") not in {"Bash", "PowerShell"}:
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
    return _deny(
        "Ask Matt, Yes, and caveman ultra missing. Run exact declaration from prompt gate."
    )


def _claude_declare(session_id: str, nonce: str, flow: str) -> int:
    if flow not in ALLOWED_FLOWS:
        print(f"Governance route rejected: {flow}", file=sys.stderr)
        return 2
    state = _read_state("claude", session_id)
    if not state or state.get("nonce") != nonce:
        print("Governance route rejected: no matching Claude turn", file=sys.stderr)
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
        },
    )
    print(f"Governance recorded: {flow}; yes; caveman-{mode}")
    return 0


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


def _turn_tool_names(transcript_path: str) -> set[str] | None:
    """Tools the assistant called since the last real user prompt. None when unreadable."""
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
                        names.add(str(item.get("name") or ""))
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


def _yes_lint(text: str, turn_tools: set[str] | None) -> list[str]:
    """YES violations a script can see in a reply. `turn_tools` None = transcript unknown."""
    prose = _strip_code(PYLONS_PREFIX_PATTERN.sub("", text, count=1))
    violations: list[str] = []
    hedges = sorted({m.group(0).lower() for m in HEDGE_PATTERN.finditer(prose)})
    if hedges:
        violations.append(
            "YES hedge without evidence: " + ", ".join(hedges[:4]) + " — check, then state it"
        )
    deflections = sorted({m.group(0).lower() for m in DEFLECTION_PATTERN.finditer(prose)})
    if deflections:
        violations.append(
            "YES deflection: " + ", ".join(deflections[:3])
            + " — do the check yourself and show the output"
        )
    if turn_tools is not None and not turn_tools:
        claims = sorted({m.group(0).lower() for m in VERIFIED_CLAIM_PATTERN.finditer(prose)})
        if claims:
            violations.append(
                "YES unverified claim: " + ", ".join(claims[:3])
                + " — no tool ran this turn, so nothing was verified"
            )
        certain = sorted({m.group(0).lower() for m in CERTAINTY_PATTERN.finditer(prose)})
        if certain:
            violations.append(
                "YES conclusion without data: " + ", ".join(certain[:3])
                + " — no tool ran this turn; state the data source or drop the certainty"
            )
    if turn_tools is not None and not (turn_tools & READ_CLASS_TOOLS):
        sourced = SOURCE_CHARACTERISATION_PATTERN.search(prose)
        if sourced:
            snippet = sourced.group(0).strip()
            violations.append(
                "YES unread source: \"" + snippet[:70]
                + "\" — nothing was opened this turn; read it or say it is unread"
            )
    return violations


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
    if str(event.get("tool_name") or "") not in {"Bash", "PowerShell"} or not session_id:
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
            return {
                "decision": "block",
                "reason": "Declare Ask Matt route; apply Yes governance; use caveman ultra.",
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
    try:
        transcript_path = str(event.get("transcript_path") or "")
        final_text = _last_assistant_text(transcript_path) if transcript_path else ""
        if final_text.strip():
            violations = violations + _yes_lint(final_text, _turn_tool_names(transcript_path))
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
            f"Ask Matt route missing. Run: python \"{SCRIPT}\" declare \"{turn_id}\" <flow>"
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
            f"python \"{SCRIPT}\" declare \"{turn_id}\" <flow>"
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
        text = sys.stdin.read() if (not path or path == "-") else io.open(path, encoding="utf-8").read()
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
    violations = _yes_lint(text, turn_tools) + _caveman_lint(text, mode)
    if not violations:
        words = len(_strip_code(text).split())
        if session_id:
            state["lint_clean_nonce"] = state.get("nonce")
            state["lint_clean_words"] = words
            _write_state("claude", session_id, state)
        if mode == "off":
            print(f"lint clean: YES rules pass, caveman off ({words} words of prose)")
        else:
            print(f"lint clean: YES rules pass, caveman {mode} ({words} words of prose)")
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
    raise SystemExit(main())
