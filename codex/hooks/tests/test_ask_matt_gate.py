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
    # The caveman plugin's tracker owns ~/.claude/.caveman-active; the gate only reads it. Tests
    # model that by writing the flag into the fake claude-home themselves: ultra unless a test says
    # otherwise, None to model a cleared flag (/caveman off).
    def set_caveman(self, state_dir: Path, mode: str | None) -> None:
        home = state_dir / "claude-home"
        home.mkdir(parents=True, exist_ok=True)
        flag = home / ".caveman-active"
        if mode is None:
            if flag.exists():
                flag.unlink()
        else:
            flag.write_text(mode, encoding="utf-8")

    def run_gate(
        self, mode: str, event: dict, state_dir: Path, caveman: str | None = "ultra"
    ) -> subprocess.CompletedProcess[str]:
        if caveman != "keep":
            self.set_caveman(state_dir, caveman)
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
        self, session_id: str, draft: str, state_dir: Path, caveman: str | None = "keep"
    ) -> subprocess.CompletedProcess[str]:
        if caveman != "keep":
            self.set_caveman(state_dir, caveman)
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
            # issue 151: to-spec and to-tickets must appear in the routing hint,
            # and the new-feature/multi-session route reads distinct from implement.
            self.assertIn("to-spec", context)
            self.assertIn("to-tickets", context)
            self.assertIn("multi-session", context)
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

    def test_claude_prompt_enforces_all_disciplines_and_reads_the_caveman_flag(self) -> None:
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
            self.assertIn("PRE-SEND LINT REQUIRED", context)
            self.assertIn('declare-claude "claude-session-1"', context)
            # issue 151: Claude prompt handler carries the same to-spec/to-tickets
            # route line as the Codex handler, and reads distinct from implement.
            self.assertIn("to-spec", context)
            self.assertIn("to-tickets", context)
            self.assertIn("multi-session", context)
            state = json.loads(
                (state_dir / "claude--claude-session-1.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertIsNone(state["flow"])
            self.assertTrue(state["yes"])
            self.assertEqual(state["caveman"], "ultra")

    def test_claude_gate_follows_the_caveman_flag_and_never_writes_it(self) -> None:
        # Dan, 2026-09-03: the tracker is the single writer. /caveman lite must survive the next
        # prompt, and /caveman off (flag deleted) must switch the lint requirement off entirely.
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            flag = state_dir / "claude-home" / ".caveman-active"

            lite = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-mode"}, state_dir, caveman="lite").stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertIn("CAVEMAN LITE: ENFORCED", lite)
            self.assertNotIn("CAVEMAN ULTRA", lite)
            self.assertIn("PRE-SEND LINT REQUIRED", lite)
            self.assertEqual(flag.read_text(encoding="utf-8"), "lite")
            self.assertEqual(self._state(state_dir, "s-mode")["caveman"], "lite")
            nonce = self._state(state_dir, "s-mode")["nonce"]
            declared = self.run_claude_declare("s-mode", nonce, "implement", state_dir)
            self.assertIn("caveman-lite", declared.stdout)
            self.assertEqual(flag.read_text(encoding="utf-8"), "lite")

            off = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-mode"}, state_dir, caveman=None).stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertIn("CAVEMAN: OFF", off)
            # Off drops the style rules only; the YES rules and the lint stay on every turn.
            self.assertIn("PRE-SEND LINT REQUIRED", off)
            self.assertFalse(flag.exists())
            self.assertEqual(self._state(state_dir, "s-mode")["caveman"], "off")
            # Off is still a governed state: tools flow once a route is declared.
            nonce = self._state(state_dir, "s-mode")["nonce"]
            self.run_claude_declare("s-mode", nonce, "implement", state_dir)
            tool = self.run_gate(
                "claude-pre-tool",
                {"session_id": "s-mode", "tool_name": "Read", "tool_input": {"file_path": "x"}},
                state_dir,
                caveman="keep",
            )
            self.assertEqual(json.loads(tool.stdout), {})

    def test_lint_scales_with_the_caveman_level_and_skips_when_off(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-scale"}, state_dir)
            # 60 words, article-heavy, one 30-word sentence: fails ultra, passes lite.
            wordy = (
                "The relay refused the bill because the policy that owns the approver is the one "
                "that the owner set to the waiting stage, and the owner agreed to that in chat. "
                "The fix is in the router. The test covers it. The deploy is queued for the morning "
                "window and the owner has the link."
            )
            ultra = self.run_presend_lint("s-scale", wordy, state_dir, caveman="ultra")
            self.assertEqual(ultra.returncode, 1)
            self.assertIn("article density", ultra.stdout)
            # The level is settled per prompt (flag or prompt switch) and kept in state; the lint
            # follows the state, so a new prompt at lite is what changes it.
            self.run_gate("claude-prompt", {"session_id": "s-scale"}, state_dir, caveman="lite")
            lite = self.run_presend_lint("s-scale", wordy, state_dir, caveman="keep")
            self.assertEqual(lite.returncode, 0, lite.stdout)
            self.assertIn("caveman lite", lite.stdout)
            # Filler stays banned at every level.
            filler = self.run_presend_lint("s-scale", "Queue empty. Tests basically pass.", state_dir, caveman="keep")
            self.assertEqual(filler.returncode, 1)
            self.assertIn("banned filler", filler.stdout)
            # Off: style rules go, YES rules stay. Articles and length pass; a hedge still fails.
            self.run_gate("claude-prompt", {"session_id": "s-scale"}, state_dir, caveman=None)
            nonce = self._state(state_dir, "s-scale")["nonce"]
            self.run_claude_declare("s-scale", nonce, "implement", state_dir)
            off = self.run_presend_lint("s-scale", wordy, state_dir, caveman="keep")
            self.assertEqual(off.returncode, 0, off.stdout)
            self.assertIn("caveman off", off.stdout)
            hedged = self.run_presend_lint(
                "s-scale", "The relay is probably the thing that fails.", state_dir, caveman="keep"
            )
            self.assertEqual(hedged.returncode, 1)
            self.assertIn("YES hedge", hedged.stdout)
            transcript = self._transcript(state_dir, wordy)
            stopped = json.loads(
                self.run_gate(
                    "claude-stop",
                    {"session_id": "s-scale", "transcript_path": transcript},
                    state_dir,
                    caveman="keep",
                ).stdout
            )
            self.assertEqual(stopped, {})

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
            {"SessionStart", "SessionEnd", "PreCompact", "UserPromptSubmit", "PreToolUse",
             "PostToolUse", "Stop"},
        )
        prompt_config = json.dumps(hooks["UserPromptSubmit"])
        self.assertIn("governance-reminder.js", prompt_config)
        self.assertIn("claude-prompt", prompt_config)
        self.assertIn("claude-pre-tool", json.dumps(hooks["PreToolUse"]))
        self.assertIn("claude-stop", json.dumps(hooks["Stop"]))
        self.assertIn("claude-post-tool", json.dumps(hooks["PostToolUse"]))
        # The session checks are hooks, not skills the model may forget to invoke.
        self.assertIn("session-gate.js\\\" start", json.dumps(hooks["SessionStart"]))
        self.assertIn("session-gate.js\\\" end", json.dumps(hooks["SessionEnd"]))
        self.assertIn("session-gate.js\\\" prompt", prompt_config)

    def test_global_instruction_files_pin_yes_and_caveman_default_ultra(self) -> None:
        codex_text = CODEX_INSTRUCTIONS.read_text(encoding="utf-8")
        claude_text = CLAUDE_INSTRUCTIONS.read_text(encoding="utf-8")
        reminder_text = CLAUDE_REMINDER.read_text(encoding="utf-8")
        self.assertIn("CAVEMAN ULTRA", codex_text)
        self.assertIn("YES GOVERNANCE", codex_text)
        self.assertIn("CAVEMAN ULTRA", claude_text)
        # Since 2026-09-03 the level is switchable in-session through the caveman tracker's flag;
        # the instructions must say so rather than claim it cannot be disabled.
        self.assertIn("/caveman lite|full|ultra|off", claude_text)
        self.assertNotIn("cannot be disabled inside a session", claude_text)
        self.assertIn("CAVEMAN ULTRA", reminder_text)
        self.assertIn(".caveman-active", reminder_text)
        # Default level for a fresh session comes from the plugin's user config, not from any hook.
        plugin_config = Path(os.environ.get("APPDATA", "")) / "caveman" / "config.json"
        self.assertEqual(
            json.loads(plugin_config.read_text(encoding="utf-8")).get("defaultMode"), "ultra"
        )

    def test_reminder_hook_follows_the_caveman_flag(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            def run(mode: str | None) -> str:
                flag = home / ".caveman-active"
                if mode is None:
                    if flag.exists():
                        flag.unlink()
                else:
                    flag.write_text(mode, encoding="utf-8")
                env = dict(os.environ, CLAUDE_CONFIG_DIR=str(home))
                done = subprocess.run(
                    ["node", str(CLAUDE_REMINDER)], input="{}", text=True,
                    capture_output=True, env=env, check=False,
                )
                self.assertEqual(done.returncode, 0, done.stderr)
                return json.loads(done.stdout)["hookSpecificOutput"]["additionalContext"]
            self.assertIn("CAVEMAN ULTRA", run("ultra"))
            self.assertIn("CAVEMAN LITE", run("lite"))
            self.assertNotIn("ULTRA", run("lite"))
            off = run(None)
            self.assertIn("CAVEMAN: off", off)
            self.assertIn("2. YES", off)


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
            # "Tests pass" is a verification claim; it is clean only because a Bash run backs it.
            transcript = self._transcript_with_tools(state_dir, ["Bash"], "Hook wired. Tests pass.")
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
        # A runnable bash fence full of articles must not count: _strip_code removes it before
        # measuring, and a bash fence is the one block the no-monospace rule permits.
        clean = os.linesep.join([
            "Relay refused. BILL owns routing through policy Order Invoices. Approve in BILL.",
            "",
            "```bash",
            "echo the the the the the the the the the the the the the the the the the the",
            "```",
            "",
        ])
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=clean, text=True, capture_output=True, check=False,
        )
        self.assertEqual(done.returncode, 0)
        self.assertIn("lint clean", done.stdout)

    def test_lint_exempts_the_mandated_pylons_prefix_but_no_other_fence(self) -> None:
        # ~/.claude/CLAUDE.md orders every reply to open with this diff fence. It is a directive,
        # not working material, so the lint ignores it - at the top only, and only that block.
        prefix = "```diff\n- YOU MUST CONSTRUCT ADDITIONAL PYLONS\n```\n\n"
        clean = prefix + "Queue empty. Tests pass. Deployed bytes match."
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=clean, text=True, capture_output=True, check=False,
        )
        self.assertEqual(done.returncode, 0, done.stdout)
        # A second fence after the prefix is still monospace in a reply.
        dirty = clean + "\n\n```\nls -la\n```\n"
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=dirty, text=True, capture_output=True, check=False,
        )
        self.assertEqual(done.returncode, 1)
        self.assertIn("1 code block(s)", done.stdout)
        # The same block anywhere but the top is not the prefix.
        moved = "Queue empty.\n\n" + prefix
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=moved, text=True, capture_output=True, check=False,
        )
        self.assertEqual(done.returncode, 1)

    def test_prompt_switch_takes_effect_this_turn_regardless_of_hook_order(self) -> None:
        # Hooks on one event run in parallel with no ordering (docs/hook-ordering-2026-09-03.md),
        # so the gate reads the switch out of the prompt itself; the flag still says ultra here.
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)

            def context(prompt: str, **extra_env: str) -> str:
                env_backup = dict(os.environ)
                os.environ.update(extra_env)
                try:
                    out = self.run_gate(
                        "claude-prompt", {"session_id": "s-switch", "prompt": prompt}, state_dir
                    )
                finally:
                    os.environ.clear()
                    os.environ.update(env_backup)
                return json.loads(out.stdout)["hookSpecificOutput"]["additionalContext"]

            self.assertIn("CAVEMAN LITE: ENFORCED", context("/caveman lite"))
            self.assertEqual(self._state(state_dir, "s-switch")["caveman"], "lite")
            self.assertIn("CAVEMAN FULL: ENFORCED", context("/caveman:caveman full"))
            self.assertIn("CAVEMAN: OFF", context("/caveman off"))
            self.assertIn("CAVEMAN: OFF", context("stop caveman"))
            self.assertIn("CAVEMAN: OFF", context("turn the caveman mode off"))
            self.assertIn("CAVEMAN: OFF", context("Normal mode please."))
            # Bare /caveman means the plugin default; pinned here through the env override.
            self.assertIn("CAVEMAN FULL: ENFORCED", context("/caveman", CAVEMAN_DEFAULT_MODE="full"))
            # Questions and unrelated prompts fall back to the flag (ultra).
            self.assertIn("CAVEMAN ULTRA: ENFORCED", context("what is caveman mode?"))
            self.assertIn("CAVEMAN ULTRA: ENFORCED", context("how do I exit vim normal mode"))
            self.assertIn("CAVEMAN ULTRA: ENFORCED", context("/caveman bogus"))
            self.assertIn("CAVEMAN ULTRA: ENFORCED", context("fix the router"))
            # The flag was never touched: the tracker owns it.
            self.assertEqual(
                (state_dir / "claude-home" / ".caveman-active").read_text(encoding="utf-8"), "ultra"
            )
            # Declare and lint keep the level the prompt settled, even though the flag says ultra.
            context("/caveman off")
            nonce = self._state(state_dir, "s-switch")["nonce"]
            declared = self.run_claude_declare("s-switch", nonce, "implement", state_dir)
            self.assertIn("caveman-off", declared.stdout)
            lint = self.run_presend_lint(
                "s-switch", "The queue is empty and the deploy is scheduled for the morning.", state_dir
            )
            self.assertEqual(lint.returncode, 0, lint.stdout)
            self.assertIn("caveman off", lint.stdout)

    def _transcript_with_tools(self, folder: Path, tools: list[str], text: str) -> str:
        """A transcript: one user prompt, then tool calls, then the assistant's final text."""
        path = folder / "transcript.jsonl"
        records = [{"type": "user", "message": {"role": "user", "content": "do it"}}]
        for name in tools:
            records.append({
                "type": "assistant",
                "message": {"content": [{"type": "tool_use", "name": name, "input": {}}]},
            })
            records.append({
                "type": "user",
                "message": {"content": [{"type": "tool_result", "tool_use_id": "x", "content": "ok"}]},
            })
        records.append({"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}})
        path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
        return str(path)

    def test_yes_lint_catches_deflection_unverified_claims_and_unread_sources(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-yes"}, state_dir)
            nonce = self._state(state_dir, "s-yes")["nonce"]
            self.run_claude_declare("s-yes", nonce, "implement", state_dir)

            def stop_with(tools: list[str], text: str) -> dict:
                transcript = self._transcript_with_tools(state_dir, tools, text)
                self.run_presend_lint("s-yes", "Queue empty.", state_dir)  # clean stamp
                return json.loads(
                    self.run_gate(
                        "claude-stop", {"session_id": "s-yes", "transcript_path": transcript},
                        state_dir, caveman="keep",
                    ).stdout
                )

            # Deflection is flagged whatever tools ran.
            out = stop_with(["Bash"], "Fixed. Please check it works on your side.")
            self.assertIn("YES deflection", out["systemMessage"])
            # A verification claim with no tool this turn is an unverified claim.
            out = stop_with([], "Tests pass. Deploy confirmed.")
            self.assertIn("YES unverified claim", out["systemMessage"])
            # The same claim after a Bash run is not flagged.
            out = stop_with(["Bash"], "Tests pass. Deploy confirmed.")
            self.assertNotIn("YES unverified claim", out.get("systemMessage", ""))
            # Certainty without data.
            out = stop_with([], "The culprit is the relay. Definitely the timeout.")
            self.assertIn("YES conclusion without data", out["systemMessage"])
            # Characterising a document nothing opened this turn (Cowork, 2026-09-03).
            out = stop_with([], "The Manager Tools PDF contains no sample prose for the body sections.")
            self.assertIn("YES unread source", out["systemMessage"])
            out = stop_with(["Read"], "The Manager Tools PDF contains no sample prose for the body sections.")
            self.assertNotIn("YES unread source", out.get("systemMessage", ""))
            # Hedges fail regardless of tools.
            out = stop_with(["Bash"], "It is probably the cache.")
            self.assertIn("YES hedge", out["systemMessage"])

    def test_backup_gate_blocks_config_edits_without_a_backup(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-bak"}, state_dir)
            nonce = self._state(state_dir, "s-bak")["nonce"]
            self.run_claude_declare("s-bak", nonce, "implement", state_dir)
            target = state_dir / "settings.json"
            target.write_text("{}", encoding="utf-8")

            def edit(path: Path) -> dict:
                return json.loads(self.run_gate(
                    "claude-pre-tool",
                    {"session_id": "s-bak", "tool_name": "Edit",
                     "tool_input": {"file_path": str(path), "old_string": "{", "new_string": "{"}},
                    state_dir, caveman="keep",
                ).stdout)

            denied = edit(target)
            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("YES backup gate", denied["hookSpecificOutput"]["permissionDecisionReason"])
            # A sibling backup lifts the gate.
            (state_dir / "settings.json.bak-test").write_text("{}", encoding="utf-8")
            self.assertEqual(edit(target), {})
            # Files that do not shape behaviour are never gated; new files are never gated.
            plain = state_dir / "notes.md"
            plain.write_text("x", encoding="utf-8")
            self.assertEqual(edit(plain), {})
            self.assertEqual(edit(state_dir / "brand-new.env"), {})

    def test_post_tool_failure_counter_drives_the_escalation_ladder(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-esc"}, state_dir)

            def after(stdout: str, stderr: str = "") -> dict:
                return json.loads(self.run_gate(
                    "claude-post-tool",
                    {"session_id": "s-esc", "tool_name": "Bash",
                     "tool_input": {"command": "x"},
                     "tool_response": {"stdout": stdout, "stderr": stderr, "interrupted": False}},
                    state_dir, caveman="keep",
                ).stdout)

            self.assertEqual(after("ok"), {})
            self.assertEqual(after("", "Traceback (most recent call last):\n  boom"), {})
            second = after("exit=1")
            self.assertIn("2 failures", second["hookSpecificOutput"]["additionalContext"])
            third = after("", "fatal: not a git repository")
            self.assertIn("five-step audit", third["hookSpecificOutput"]["additionalContext"])
            # A success resets the ladder; an explicit exit 0 beats error-looking text.
            self.assertEqual(after("error: none\nexit=0"), {})
            self.assertEqual(self._state(state_dir, "s-esc")["consecutive_failures"], 0)
            # The pre-send lint failing is a draft rewrite, not a debugging failure.
            for _ in range(3):
                out = json.loads(self.run_gate(
                    "claude-post-tool",
                    {"session_id": "s-esc", "tool_name": "Bash",
                     "tool_input": {"command": 'py -3 "C:/x/ask_matt_gate.py" lint draft.md "s-esc"'},
                     "tool_response": {"stdout": "lint: too long\nexit=1", "stderr": ""}},
                    state_dir, caveman="keep",
                ).stdout)
                self.assertEqual(out, {})
            self.assertEqual(self._state(state_dir, "s-esc")["consecutive_failures"], 0)

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
