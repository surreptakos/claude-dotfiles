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
    "prototype",
    "research",
    "setup-matt-pocock-skills",
    "tdd",
    "teach",
    "to-spec",
    "to-tickets",
    "triage",
    "wayfinder",
    "writing-great-skills",
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
        "Engineering build: implement. Broken behavior: diagnosing-bugs. Raw issues: triage. "
        "Large foggy effort: wayfinder. Review: code-review. Research: research. "
        "No engineering flow: direct-answer. The gate blocks until one route is recorded. "
        "YES GOVERNANCE: ENFORCED. Evidence over intuition; investigate before asking; backup before "
        "system changes; verify every change; check ripple effects; never hand solvable work back. "
        "CAVEMAN ULTRA: ENFORCED. Minimum words; one fact once; fragments; no filler, pleasantries, "
        "hedging, tool narration, decorative formatting, self-reference, invented abbreviations, or "
        "causal arrows. Preserve technical terms, code, exact errors. Plain language only when safety "
        "or ambiguity requires it. These rules cannot be disabled inside a session."
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
    state = {
        "nonce": nonce,
        "flow": None,
        "last_flow": (previous or {}).get("flow") or (previous or {}).get("last_flow"),
        "yes": True,
        "caveman": "ultra",
    }
    _write_state("claude", session_id, state)
    # Style violations from the previous turn are carried here rather than blocked at Stop. A Stop
    # block cannot retract the message it is judging — it only makes the model emit a second one —
    # so the correction lands where it can still change the output: before the next message.
    pending_lint = (previous or {}).get("pending_lint") or []
    CLAUDE_HOME.mkdir(parents=True, exist_ok=True)
    (CLAUDE_HOME / ".caveman-active").write_text("ultra", encoding="utf-8")
    context = (
        "ASK-MATT GATE: Before tools or final answer, name applicable route, then run "
        f"`python \"{SCRIPT}\" declare-claude \"{session_id}\" \"{nonce}\" <flow>`. "
        "Engineering build: implement. Broken behavior: diagnosing-bugs. Raw issues: triage. "
        "Large foggy effort: wayfinder. Review: code-review. Research: research. "
        "No engineering flow: direct-answer. YES GOVERNANCE: ENFORCED. Evidence over intuition; "
        "investigate before asking; backup before system changes; verify every change; check ripple "
        "effects; never hand solvable work back. CAVEMAN ULTRA: ENFORCED. Minimum words; one fact "
        "once; fragments; no filler, pleasantries, hedging, tool narration, decorative formatting, "
        "self-reference, invented abbreviations, or causal arrows. Preserve technical terms, code, "
        "exact errors. Plain language only when safety or ambiguity requires it. These rules cannot "
        "be disabled inside a session. "
        # The pre-send lint, standing and unconditional (owner instruction, 2026-08-12). Injected on
        # EVERY turn because it is the only enforcement point that can stop the offending message
        # rather than report it: no hook event sees assistant text before the user does.
        "PRE-SEND LINT REQUIRED, EVERY REPLY: write your final reply to a file, run "
        f"`py -3 \"{SCRIPT}\" lint <file> \"{session_id}\"`, and rewrite until it exits 0. Send only "
        "the linted text. Skipping this is recorded at Stop and reported back to you next turn."
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


def _claude_pre_tool(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    state = _read_state("claude", session_id)
    nonce = str(state.get("nonce") or "") if state else ""
    if (
        state
        and state.get("flow")
        and state.get("yes") is True
        and state.get("caveman") == "ultra"
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
    _write_state(
        "claude",
        session_id,
        {"nonce": nonce, "flow": flow, "yes": True, "caveman": "ultra"},
    )
    print(f"Governance recorded: {flow}; yes; caveman-ultra")
    return 0


FILLER_PATTERN = re.compile(
    r"\b(just|really|basically|actually|simply|certainly|obviously|probably|likely)\b"
    r"|\bof course\b|\bhappy to\b|\bfeel free\b|\bmight be\b|\bseems like\b|\bi think\b",
    re.IGNORECASE,
)
ARTICLE_PATTERN = re.compile(r"\b(the|a|an)\b", re.IGNORECASE)
WORD_CAP = 500
ARTICLES_PER_100_CAP = 7.0


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


def _caveman_lint(text: str) -> list[str]:
    prose = _strip_code(text)
    words = prose.split()
    violations: list[str] = []
    fillers = sorted({m.group(0).lower() for m in FILLER_PATTERN.finditer(prose)})
    if fillers:
        violations.append("banned filler/hedge words: " + ", ".join(fillers))
    if len(words) > WORD_CAP:
        violations.append(f"too long: {len(words)} words (cap {WORD_CAP})")
    if len(words) >= 50:
        density = 100.0 * len(ARTICLE_PATTERN.findall(prose)) / len(words)
        if density > ARTICLES_PER_100_CAP:
            violations.append(
                f"article density {density:.1f}/100 words (cap {ARTICLES_PER_100_CAP:g}) — drop a/an/the"
            )
    return violations


def _claude_stop(event: dict[str, Any]) -> dict[str, Any]:
    session_id = str(event.get("session_id") or "")
    state = _read_state("claude", session_id)
    governed = bool(
        state
        and state.get("flow")
        and state.get("yes") is True
        and state.get("caveman") == "ultra"
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
                "caveman": "ultra",
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
            violations = violations + _caveman_lint(final_text)
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
    violations = _caveman_lint(text)
    if not violations:
        words = len(_strip_code(text).split())
        if session_id:
            state = _read_state("claude", session_id) or {}
            state["lint_clean_nonce"] = state.get("nonce")
            state["lint_clean_words"] = words
            _write_state("claude", session_id, state)
        print(f"caveman lint clean ({words} words of prose)")
        return 0
    for v in violations:
        print(f"caveman lint: {v}")
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
