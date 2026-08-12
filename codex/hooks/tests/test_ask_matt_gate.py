from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "ask_matt_gate.py"
HOOKS_CONFIG = Path.home() / ".codex" / "hooks.json"
CLAUDE_SETTINGS = Path.home() / ".claude" / "settings.json"
CLAUDE_INSTRUCTIONS = Path.home() / ".claude" / "CLAUDE.md"
CODEX_INSTRUCTIONS = Path.home() / ".codex" / "AGENTS.md"
CLAUDE_REMINDER = Path.home() / ".claude" / "hooks" / "governance-reminder.js"


class AskMattGateTests(unittest.TestCase):
    def run_gate(self, mode: str, event: dict, state_dir: Path) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ)
        env["ASK_MATT_GATE_STATE_DIR"] = str(state_dir)
        env["GOVERNANCE_CLAUDE_HOME"] = str(state_dir / "claude-home")
        env["CODEX_THREAD_ID"] = str(event.get("session_id") or "session-test")
        return subprocess.run(
            [sys.executable, str(SCRIPT), mode],
            input=json.dumps(event),
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def run_presend_lint(
        self, session_id: str, draft: str, state_dir: Path
    ) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ)
        env["ASK_MATT_GATE_STATE_DIR"] = str(state_dir)
        env["GOVERNANCE_CLAUDE_HOME"] = str(state_dir / "claude-home")
        return subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-", session_id],
            input=draft,
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def run_declare(
        self, turn_id: str, flow: str, state_dir: Path, session_id: str
    ) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ)
        env["ASK_MATT_GATE_STATE_DIR"] = str(state_dir)
        env["CODEX_THREAD_ID"] = session_id
        return subprocess.run(
            [sys.executable, str(SCRIPT), "declare", turn_id, flow],
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def run_claude_declare(
        self,
        session_id: str,
        nonce: str,
        flow: str,
        state_dir: Path,
    ) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ)
        env["ASK_MATT_GATE_STATE_DIR"] = str(state_dir)
        env["GOVERNANCE_CLAUDE_HOME"] = str(state_dir / "claude-home")
        return subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "declare-claude",
                session_id,
                nonce,
                flow,
            ],
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def test_user_prompt_marks_turn_pending_and_injects_route_contract(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            result = self.run_gate(
                "prompt",
                {
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "hook_event_name": "UserPromptSubmit",
                    "prompt": "make one",
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            context = output["hookSpecificOutput"]["additionalContext"]
            self.assertIn("ASK-MATT GATE", context)
            self.assertIn("YES GOVERNANCE: ENFORCED", context)
            self.assertIn("CAVEMAN ULTRA: ENFORCED", context)
            self.assertIn('declare "turn-1" <flow>', context)
            state = json.loads(
                (state_dir / "session-1--turn-1.json").read_text(encoding="utf-8")
            )
            self.assertEqual(state["turn_id"], "turn-1")
            self.assertIsNone(state["flow"])
            self.assertTrue(state["yes"])
            self.assertEqual(state["caveman"], "ultra")

    def test_pre_tool_use_denies_work_before_route_declaration(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )
            result = self.run_gate(
                "pre-tool",
                {
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "apply_patch",
                    "tool_input": {"command": "*** Begin Patch"},
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            decision = output["hookSpecificOutput"]
            self.assertEqual(decision["permissionDecision"], "deny")
            self.assertIn("declare", decision["permissionDecisionReason"])

    def test_declare_records_allowed_flow_for_pending_turn(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )

            result = self.run_declare("turn-1", "implement", state_dir, "session-1")

            self.assertEqual(result.returncode, 0, result.stderr)
            state = json.loads(
                (state_dir / "session-1--turn-1.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                state,
                {
                    "turn_id": "turn-1",
                    "flow": "implement",
                    "yes": True,
                    "caveman": "ultra",
                },
            )

    def test_pre_tool_use_allows_only_exact_route_declaration_while_pending(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )
            command = f'python "{SCRIPT}" declare "turn-1" implement'

            result = self.run_gate(
                "pre-tool",
                {
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "Bash",
                    "tool_input": {"command": command},
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {})

    def test_pre_tool_use_denies_arbitrary_code_mode_wrapper_while_pending(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )

            result = self.run_gate(
                "pre-tool",
                {
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "functions.exec",
                    "tool_input": {"code": "nested tool call"},
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(
                output["hookSpecificOutput"]["permissionDecision"], "deny"
            )

    def test_pre_tool_use_allows_exact_code_mode_declaration_while_pending(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )
            code = (
                "text(await tools.shell_command({command:'py -3 "
                f'"{SCRIPT.as_posix()}" declare "turn-1" implement'
                "'}))"
            )

            result = self.run_gate(
                "pre-tool",
                {
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "functions.exec",
                    "tool_input": {"code": code},
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), {})

    def test_declaration_cannot_authorize_a_different_concurrent_turn(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-2"},
                state_dir,
            )

            declared = self.run_declare(
                "turn-1", "implement", state_dir, "session-1"
            )
            stopped = self.run_gate(
                "stop",
                {"session_id": "session-1", "turn_id": "turn-2"},
                state_dir,
            )

            self.assertEqual(declared.returncode, 0, declared.stderr)
            self.assertEqual(json.loads(stopped.stdout)["decision"], "block")

    def test_canonical_ask_matt_routes_are_accepted(self) -> None:
        for route in (
            "codebase-design",
            "writing-great-skills",
            "setup-matt-pocock-skills",
        ):
            with self.subTest(route=route), tempfile.TemporaryDirectory() as folder:
                state_dir = Path(folder)
                self.run_gate(
                    "prompt",
                    {"session_id": "session-1", "turn_id": "turn-1"},
                    state_dir,
                )
                result = self.run_declare(
                    "turn-1", route, state_dir, "session-1"
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_stop_continues_turn_when_route_was_not_declared(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "prompt",
                {"session_id": "session-1", "turn_id": "turn-1"},
                state_dir,
            )

            result = self.run_gate(
                "stop",
                {
                    "session_id": "session-1",
                    "turn_id": "turn-1",
                    "hook_event_name": "Stop",
                    "stop_hook_active": False,
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output["decision"], "block")
            self.assertIn("declare", output["reason"])

    def test_global_hooks_wire_prompt_tool_and_stop_enforcement(self) -> None:
        config = json.loads(HOOKS_CONFIG.read_text(encoding="utf-8"))
        hooks = config["hooks"]
        self.assertEqual(set(hooks), {"UserPromptSubmit", "PreToolUse", "Stop"})
        self.assertIn("prompt", hooks["UserPromptSubmit"][0]["hooks"][0]["commandWindows"])
        self.assertIn("pre-tool", hooks["PreToolUse"][0]["hooks"][0]["commandWindows"])
        self.assertIn("stop", hooks["Stop"][0]["hooks"][0]["commandWindows"])
        self.assertEqual(hooks["PreToolUse"][0]["matcher"], ".*")

    def test_malformed_hook_input_fails_closed_without_traceback(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            env = dict(os.environ)
            env["ASK_MATT_GATE_STATE_DIR"] = folder
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "pre-tool"],
                input="not-json",
                text=True,
                capture_output=True,
                env=env,
                check=False,
            )

            self.assertEqual(result.returncode, 2)
            self.assertIn("Ask Matt gate rejected hook input", result.stderr)
            self.assertNotIn("Traceback", result.stderr)

    def test_claude_prompt_enforces_all_disciplines_and_ultra_flag(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            result = self.run_gate(
                "claude-prompt",
                {
                    "session_id": "claude-session-1",
                    "hook_event_name": "UserPromptSubmit",
                    "prompt": "make one",
                },
                state_dir,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            context = output["hookSpecificOutput"]["additionalContext"]
            self.assertIn("ASK-MATT GATE", context)
            self.assertIn("YES GOVERNANCE: ENFORCED", context)
            self.assertIn("CAVEMAN ULTRA: ENFORCED", context)
            self.assertIn('declare-claude "claude-session-1"', context)
            state = json.loads(
                (state_dir / "claude--claude-session-1.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertIsNone(state["flow"])
            self.assertTrue(state["yes"])
            self.assertEqual(state["caveman"], "ultra")
            self.assertEqual(
                (state_dir / "claude-home" / ".caveman-active").read_text(
                    encoding="utf-8"
                ),
                "ultra",
            )

    def test_claude_gate_blocks_tools_and_stop_until_exact_declaration(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            prompt = self.run_gate(
                "claude-prompt",
                {"session_id": "claude-session-1", "hook_event_name": "UserPromptSubmit"},
                state_dir,
            )
            state_path = state_dir / "claude--claude-session-1.json"
            nonce = json.loads(state_path.read_text(encoding="utf-8"))["nonce"]
            ordinary_tool = {
                "session_id": "claude-session-1",
                "hook_event_name": "PreToolUse",
                "tool_name": "Read",
                "tool_input": {"file_path": "README.md"},
            }
            exact_command = (
                f'python "{SCRIPT}" declare-claude '
                f'"claude-session-1" "{nonce}" implement'
            )
            declaration_tool = {
                "session_id": "claude-session-1",
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": exact_command},
            }
            powershell_declaration_tool = {
                **declaration_tool,
                "tool_name": "PowerShell",
            }

            denied = self.run_gate("claude-pre-tool", ordinary_tool, state_dir)
            bootstrap = self.run_gate(
                "claude-pre-tool", powershell_declaration_tool, state_dir
            )
            blocked_stop = self.run_gate(
                "claude-stop",
                {"session_id": "claude-session-1", "hook_event_name": "Stop"},
                state_dir,
            )
            declared = self.run_claude_declare(
                "claude-session-1", nonce, "implement", state_dir
            )
            allowed_tool = self.run_gate(
                "claude-pre-tool", ordinary_tool, state_dir
            )
            allowed_stop = self.run_gate(
                "claude-stop",
                {"session_id": "claude-session-1", "hook_event_name": "Stop"},
                state_dir,
            )

            self.assertEqual(prompt.returncode, 0, prompt.stderr)
            self.assertEqual(
                json.loads(denied.stdout)["hookSpecificOutput"]["permissionDecision"],
                "deny",
            )
            self.assertEqual(json.loads(bootstrap.stdout), {})
            self.assertEqual(json.loads(blocked_stop.stdout)["decision"], "block")
            self.assertEqual(declared.returncode, 0, declared.stderr)
            self.assertEqual(json.loads(allowed_tool.stdout), {})
            # This turn never ran the pre-send lint, so Stop reports that rather than answering {} —
            # the audit is unconditional by design. What matters here is that it does not BLOCK once a
            # route is declared, which is what this test is about.
            allowed_stop_out = json.loads(allowed_stop.stdout)
            self.assertNotIn("decision", allowed_stop_out)
            self.assertIn("WITHOUT the required pre-send lint", allowed_stop_out["systemMessage"])
            final_state = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(final_state["flow"], "implement")
            self.assertTrue(final_state["yes"])
            self.assertEqual(final_state["caveman"], "ultra")

    def test_claude_bootstrap_accepts_yes_exit_check_but_no_other_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate(
                "claude-prompt",
                {"session_id": "claude-session-1", "hook_event_name": "UserPromptSubmit"},
                state_dir,
            )
            state = json.loads(
                (state_dir / "claude--claude-session-1.json").read_text(
                    encoding="utf-8"
                )
            )
            base = (
                f'python "{SCRIPT}" declare-claude "claude-session-1" '
                f'"{state["nonce"]}" direct-answer'
            )

            yes_checked = self.run_gate(
                "claude-pre-tool",
                {
                    "session_id": "claude-session-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "PowerShell",
                    "tool_input": {"command": f'{base} 2>&1; echo "EXIT=$?"'},
                },
                state_dir,
            )
            smuggled = self.run_gate(
                "claude-pre-tool",
                {
                    "session_id": "claude-session-1",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "PowerShell",
                    "tool_input": {"command": f"{base}; Get-Date"},
                },
                state_dir,
            )

            self.assertEqual(json.loads(yes_checked.stdout), {})
            self.assertEqual(
                json.loads(smuggled.stdout)["hookSpecificOutput"]["permissionDecision"],
                "deny",
            )

    def test_claude_global_settings_wire_all_gate_events(self) -> None:
        settings = json.loads(CLAUDE_SETTINGS.read_text(encoding="utf-8"))
        hooks = settings["hooks"]
        self.assertEqual(
            set(hooks),
            {"SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "Stop"},
        )
        prompt_config = json.dumps(hooks["UserPromptSubmit"])
        self.assertIn("governance-reminder.js", prompt_config)
        self.assertIn("claude-prompt", prompt_config)
        self.assertIn("claude-pre-tool", json.dumps(hooks["PreToolUse"]))
        self.assertIn("claude-stop", json.dumps(hooks["Stop"]))
        # The session checks are hooks, not skills the model may forget to invoke.
        self.assertIn("session-gate.js\\\" start", json.dumps(hooks["SessionStart"]))
        self.assertIn("session-gate.js\\\" end", json.dumps(hooks["SessionEnd"]))
        self.assertIn("session-gate.js\\\" prompt", prompt_config)

    def test_global_instruction_files_pin_yes_and_caveman_ultra(self) -> None:
        codex_text = CODEX_INSTRUCTIONS.read_text(encoding="utf-8")
        claude_text = CLAUDE_INSTRUCTIONS.read_text(encoding="utf-8")
        reminder_text = CLAUDE_REMINDER.read_text(encoding="utf-8")
        self.assertIn("CAVEMAN ULTRA", codex_text)
        self.assertIn("YES GOVERNANCE", codex_text)
        self.assertIn("CAVEMAN ULTRA", claude_text)
        self.assertIn("cannot be disabled inside a session", claude_text)
        self.assertIn("CAVEMAN ULTRA", reminder_text)
        self.assertEqual(
            (Path.home() / ".claude" / ".caveman-active").read_text(
                encoding="utf-8"
            ).strip(),
            "ultra",
        )


    def _state(self, state_dir: Path, session_id: str) -> dict:
        return json.loads(
            (state_dir / f"claude--{session_id}.json").read_text(encoding="utf-8")
        )

    def _transcript(self, folder: Path, text: str) -> str:
        path = folder / "transcript.jsonl"
        path.write_text(
            json.dumps(
                {
                    "type": "assistant",
                    "message": {"content": [{"type": "text", "text": text}]},
                }
            )
            + "\n",
            encoding="utf-8",
        )
        return str(path)

    def test_claude_stop_reconciles_an_undeclared_turn_without_a_duplicate_reply(self) -> None:
        # Blocking at Stop cannot retract the message it is judging; it only makes the model write a
        # second one. Once a route exists for the session, Stop must reconcile rather than block.
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            first = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-recon"}, state_dir).stdout
            )
            nonce = self._state(state_dir, "s-recon")["nonce"]
            self.assertIn("ASK-MATT GATE", first["hookSpecificOutput"]["additionalContext"])
            self.run_claude_declare("s-recon", nonce, "implement", state_dir)
            # A second user prompt clears the flow and carries the route forward as last_flow.
            self.run_gate("claude-prompt", {"session_id": "s-recon"}, state_dir)
            self.assertIsNone(self._state(state_dir, "s-recon")["flow"])

            stopped = json.loads(
                self.run_gate("claude-stop", {"session_id": "s-recon"}, state_dir).stdout
            )
            self.assertNotIn("decision", stopped)
            self.assertIn("no route declared", stopped["systemMessage"])
            self.assertEqual(self._state(state_dir, "s-recon")["flow"], "implement")

    def test_claude_stop_still_blocks_a_session_that_never_declared_a_route(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-virgin"}, state_dir)
            stopped = json.loads(
                self.run_gate("claude-stop", {"session_id": "s-virgin"}, state_dir).stdout
            )
            self.assertEqual(stopped["decision"], "block")

    def test_caveman_violations_are_enforced_on_the_next_prompt_not_by_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-lint"}, state_dir)
            nonce = self._state(state_dir, "s-lint")["nonce"]
            self.run_claude_declare("s-lint", nonce, "implement", state_dir)
            transcript = self._transcript(
                state_dir,
                "I think this is really just basically the answer, and it might be simply fine.",
            )
            stopped = json.loads(
                self.run_gate(
                    "claude-stop",
                    {"session_id": "s-lint", "transcript_path": transcript},
                    state_dir,
                ).stdout
            )
            self.assertNotIn("decision", stopped)  # a block here would post a duplicate reply
            self.assertIn("CAVEMAN lint", stopped["systemMessage"])
            self.assertTrue(self._state(state_dir, "s-lint")["pending_lint"])

            carried = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-lint"}, state_dir).stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertIn("CAVEMAN VIOLATION IN YOUR LAST MESSAGE", carried)

            # Consumed once, not repeated forever.
            again = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-lint"}, state_dir).stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertNotIn("CAVEMAN VIOLATION IN YOUR LAST MESSAGE", again)

    def test_clean_final_message_carries_no_lint(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-clean"}, state_dir)
            nonce = self._state(state_dir, "s-clean")["nonce"]
            self.run_claude_declare("s-clean", nonce, "implement", state_dir)
            self.run_presend_lint("s-clean", "Hook wired. Tests pass.", state_dir)
            transcript = self._transcript(state_dir, "Hook wired. Tests pass.")
            stopped = json.loads(
                self.run_gate(
                    "claude-stop",
                    {"session_id": "s-clean", "transcript_path": transcript},
                    state_dir,
                ).stdout
            )
            self.assertEqual(stopped, {})
            self.assertNotIn("pending_lint", self._state(state_dir, "s-clean"))

    def test_a_clean_reply_sent_without_the_presend_lint_is_still_reported(self) -> None:
        # The audit's whole point: a turn can end with a perfectly clean message and still have
        # skipped the step that makes cleanliness deliberate rather than luck.
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-skip"}, state_dir)
            nonce = self._state(state_dir, "s-skip")["nonce"]
            self.run_claude_declare("s-skip", nonce, "implement", state_dir)
            transcript = self._transcript(state_dir, "Hook wired. Tests pass.")
            stopped = json.loads(
                self.run_gate(
                    "claude-stop",
                    {"session_id": "s-skip", "transcript_path": transcript},
                    state_dir,
                ).stdout
            )
            self.assertIn("WITHOUT the required pre-send lint", stopped["systemMessage"])
            self.assertIn("pending_lint", self._state(state_dir, "s-skip"))
            # ...and it reaches the model where it can act on it: the next turn's context.
            injected = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-skip"}, state_dir).stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertIn("CAVEMAN VIOLATION IN YOUR LAST MESSAGE", injected)
            self.assertIn("WITHOUT the required pre-send lint", injected)

    def test_a_stale_lint_stamp_cannot_pass_a_later_turn(self) -> None:
        # A bare boolean would: stamp it once and every turn afterwards reads as compliant. The stamp
        # carries the nonce it was earned under, and a new turn mints a new nonce.
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-stale"}, state_dir)
            first = self._state(state_dir, "s-stale")["nonce"]
            self.run_claude_declare("s-stale", first, "implement", state_dir)
            self.run_presend_lint("s-stale", "Clean enough.", state_dir)
            self.assertEqual(self._state(state_dir, "s-stale")["lint_clean_nonce"], first)
            # Next turn: new nonce, same stamp, and the audit must not accept it.
            self.run_gate("claude-prompt", {"session_id": "s-stale"}, state_dir)
            second = self._state(state_dir, "s-stale")["nonce"]
            self.assertNotEqual(second, first)
            self.run_claude_declare("s-stale", second, "implement", state_dir)
            transcript = self._transcript(state_dir, "Second reply, unlinted.")
            stopped = json.loads(
                self.run_gate(
                    "claude-stop",
                    {"session_id": "s-stale", "transcript_path": transcript},
                    state_dir,
                ).stdout
            )
            self.assertIn("WITHOUT the required pre-send lint", stopped["systemMessage"])


    def test_lint_subcommand_fails_a_dirty_draft_before_it_is_sent(self) -> None:
        # The only enforcement point that can stop the ORIGINAL message: every hook event fires
        # either before the text exists or after it has been displayed.
        # Over 50 words on purpose: the density check is skipped below that, since a short fragment
        # carrying two articles is not evidence of a habit.
        dirty = ("The relay is really the thing that fails, and the policy that covers the bill is "
                 "the one that owns the approver, so the assignment that the relay attempts is the "
                 "action that BILL refuses on the bill that the owner set to the stage that waits. "
                 "The comment that the relay posts on the ticket is the thing that tells the person "
                 "who made the decision that the approval did not reach the system that holds it.")
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=dirty, text=True, capture_output=True, check=False,
        )
        self.assertEqual(done.returncode, 1)
        self.assertIn("banned filler/hedge words: really", done.stdout)
        self.assertIn("article density", done.stdout)
        self.assertIn("REWRITE BEFORE SENDING", done.stderr)

    def test_lint_subcommand_passes_a_clean_draft_and_counts_prose_only(self) -> None:
        # A fenced block full of articles must not count: _strip_code removes it before measuring.
        clean = os.linesep.join([
            "Relay refused. BILL owns routing through policy Order Invoices. Approve in BILL.",
            "",
            "```",
            "the the the the the the the the the the the the the the the the the the",
            "```",
            "",
        ])
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=clean, text=True, capture_output=True, check=False,
        )
        self.assertEqual(done.returncode, 0)
        self.assertIn("caveman lint clean", done.stdout)

    def test_lint_subcommand_reads_a_file_as_well_as_stdin(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            draft = Path(folder) / "draft.md"
            draft.write_text("Queue empty. Tests pass. Deployed bytes match.", encoding="utf-8")
            done = subprocess.run(
                [sys.executable, str(SCRIPT), "lint", str(draft)],
                text=True, capture_output=True, check=False,
            )
            self.assertEqual(done.returncode, 0)


if __name__ == "__main__":
    unittest.main()
