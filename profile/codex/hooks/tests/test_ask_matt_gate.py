from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "ask_matt_gate.py"
# The REPO, not a restored home. These assertions are about the wiring this repo ships; whether a
# restore lays it down in the right place is the restore suite's job (tests/restore-test.ps1), and
# pointing them at ~/.codex and ~/.claude made them fail on every machine that is not the owner's
# desktop — a cloud container has no such tree, so four checks of the governance wiring were red
# there for reasons that said nothing about the wiring.
REPO = Path(__file__).resolve().parents[4]
HOOKS_CONFIG = REPO / "profile" / "codex" / "hooks.json"
CLAUDE_SETTINGS = REPO / "profile" / "claude" / "settings.json"
PLUGIN_HOOKS = REPO / "marketplace" / "aac-skills" / "hooks" / "hooks.json"
CLAUDE_INSTRUCTIONS = REPO / "profile" / "claude" / "CLAUDE.md"
CODEX_INSTRUCTIONS = REPO / "profile" / "codex" / "AGENTS.md"
CLAUDE_REMINDER = REPO / "profile" / "claude" / "hooks" / "governance-reminder.js"
CAVEMAN_PLUGIN_CONFIG = REPO / "aac-skills" / "project-harness" / "templates" / "caveman.json"
# The YES rules put regex hits to TypeSafe Jev (issue 723). Tests never touch the network: every
# spawned gate inherits "off" (Jev unavailable, regex verdicts stand) unless a test stubs answers.
os.environ["TYPESAFE_JEV_STUB"] = "off"


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

    def test_claude_prompt_prints_a_runner_this_machine_can_execute(self) -> None:
        # A printed `py -3` is a dead command on a POSIX image and a printed `python` is dead on an
        # image that ships only python3; either way the turn cannot declare and every tool stays
        # denied. Both the declare line and the lint line must name a runner that resolves here.
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_gate(
                "claude-prompt",
                {
                    "session_id": "runner-session",
                    "hook_event_name": "UserPromptSubmit",
                    "prompt": "make one",
                },
                Path(folder),
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
            for marker in ('declare-claude "runner-session"', 'lint <file> "runner-session"'):
                printed = context.split(marker)[0].rsplit("`", 1)[-1]
                runner = printed.split('"', 1)[0].strip()
                self.assertTrue(runner, f"no runner printed before {marker}")
                if runner == "py -3":
                    self.assertEqual(os.name, "nt", "py -3 printed off Windows")
                else:
                    self.assertTrue(
                        shutil.which(runner) or Path(runner).is_file(),
                        f"printed runner {runner!r} does not resolve for {marker}")

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

    # Issue 839: Jev picks the route. Canned answers stand in for TypeSafe: one map answers the
    # correction Noul and every route-tree Choice, because the prompt hook asks them in ONE request.
    ROUTE_DEFAULTS = {"route.scope": "software", "route.kind": "question",
                      "route.settled": "single", "route.codebase": "repo"}

    def _canned(self, correction: float = 0.02, **picks: str) -> str:
        answers = {"correction": correction, **self.ROUTE_DEFAULTS}
        answers.update({f"route.{level}": option for level, option in picks.items()})
        return json.dumps(answers)

    def _routed_turn(self, state_dir: Path, sid: str, prompt: str, stub: str) -> dict:
        os.environ["TYPESAFE_JEV_STUB"] = stub
        self.addCleanup(os.environ.__setitem__, "TYPESAFE_JEV_STUB", "off")
        result = self.run_gate("claude-prompt", {"session_id": sid, "prompt": prompt}, state_dir)
        self.assertEqual(result.returncode, 0, result.stderr)
        context = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
        return {"context": context, "state": self._state(state_dir, sid)}

    def test_jev_routes_a_build_shaped_design_request_in_a_repo_to_grill_with_docs(self) -> None:
        # Dan, 2026-09-25: this message was self-declared direct-answer and got a build plan.
        prompt = ("I need to be able to give feedback to the model running the huddle draft tool. "
                  "Not sure how best to do that.")
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            turn = self._routed_turn(state_dir, "s-grill", prompt,
                                     self._canned(kind="build", settled="unsettled", codebase="repo"))
            self.assertEqual(turn["state"]["flow"], "grill-with-docs")  # recorded by the gate
            self.assertIn("ROUTE PICKED BY JEV: grill-with-docs", turn["context"])
            nonce = turn["state"]["nonce"]
            refused = self.run_claude_declare("s-grill", nonce, "direct-answer", state_dir)
            self.assertEqual(refused.returncode, 2)
            self.assertIn("Jev picked grill-with-docs", refused.stderr)
            self.assertEqual(self._state(state_dir, "s-grill")["flow"], "grill-with-docs")
            same = self.run_claude_declare("s-grill", nonce, "grill-with-docs", state_dir)
            self.assertEqual(same.returncode, 0, same.stderr)

    def test_jev_routes_a_plain_question_to_direct_answer_and_refuses_anything_else(self) -> None:
        prompt = "what does /ask-matt tell you to do, and why didn't it force you into /to-spec?"
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            turn = self._routed_turn(state_dir, "s-q", prompt, self._canned(kind="question"))
            self.assertEqual(turn["state"]["flow"], "direct-answer")
            nonce = turn["state"]["nonce"]
            refused = self.run_claude_declare("s-q", nonce, "implement", state_dir)
            self.assertEqual(refused.returncode, 2)
            self.assertIn("Jev picked direct-answer", refused.stderr)
            self.assertEqual(self.run_claude_declare("s-q", nonce, "direct-answer", state_dir).returncode, 0)

    def test_every_route_tree_leaf_is_reachable(self) -> None:
        leaves = {
            "grill-me": dict(kind="build", settled="unsettled", codebase="none"),
            "implement": dict(kind="build", settled="single"),
            "to-spec": dict(kind="build", settled="multi"),
            "wayfinder": dict(kind="build", settled="foggy"),
            "diagnosing-bugs": dict(kind="broken"),
            "triage": dict(kind="issues"),
            "code-review": dict(kind="review"),
            "research": dict(kind="research"),
        }
        for route, picks in leaves.items():
            with self.subTest(route=route), tempfile.TemporaryDirectory() as folder:
                turn = self._routed_turn(Path(folder), "s-leaf", "do the thing", self._canned(**picks))
                self.assertEqual(turn["state"]["flow"], route)

    def test_other_work_and_scheduled_runs_get_no_route_and_no_refusal(self) -> None:
        cases = {
            "other": ("Put together the contract package for the Smith job.", self._canned(scope="other")),
            # A scheduled run is routed by nothing: its request asks the correction question alone.
            "scheduled": ("<scheduled-task name=\"triage\">Triage Todoist.</scheduled-task>",
                          json.dumps({"correction": 0.01})),
            # A route the user typed as a slash command is theirs; the tree has no session-end leaf.
            "slash": ("/aac-skills:session-end", json.dumps({"correction": 0.01})),
        }
        for name, (prompt, stub) in cases.items():
            with self.subTest(case=name), tempfile.TemporaryDirectory() as folder:
                state_dir = Path(folder)
                turn = self._routed_turn(state_dir, f"s-{name}", prompt, stub)
                self.assertIsNone(turn["state"]["flow"])
                self.assertNotIn("jev_route", turn["state"])
                self.assertNotIn("ROUTE PICKED BY JEV", turn["context"])
                for flow in ("direct-answer", "implement"):
                    declared = self.run_claude_declare(f"s-{name}", turn["state"]["nonce"], flow, state_dir)
                    self.assertEqual(declared.returncode, 0, declared.stderr)

    def test_jev_unavailable_declarations_behave_as_before(self) -> None:
        prompt = "I need to be able to give feedback to the model. Not sure how best to do that."
        # "off", and a canned map missing one tree question: the whole request is one call, so a
        # missing answer leaves Jev unavailable for the correction check and the route alike.
        partial = json.loads(self._canned())
        del partial["route.codebase"]
        for stub in ("off", json.dumps(partial)):
            with self.subTest(stub=stub), tempfile.TemporaryDirectory() as folder:
                state_dir = Path(folder)
                turn = self._routed_turn(state_dir, "s-down", prompt, stub)
                self.assertIsNone(turn["state"]["flow"])
                self.assertNotIn("jev_route", turn["state"])
                self.assertNotIn("ROUTE PICKED BY JEV", turn["context"])
                declared = self.run_claude_declare("s-down", turn["state"]["nonce"], "direct-answer", state_dir)
                self.assertEqual(declared.returncode, 0, declared.stderr)

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
                "\nNext: open the router."
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

    def test_claude_pre_tool_fails_open_when_the_session_has_no_state(self) -> None:
        """Hooks installed mid-session leave no state and no nonce, so a deny here is
        unsatisfiable — the declaration command is itself a tool call. Seen 2026-09-21 in the
        master-zoho-source-of-truth Routine, which lost every tool including its notification."""
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            allowed = self.run_gate(
                "claude-pre-tool",
                {
                    "session_id": "claude-session-no-prompt",
                    "hook_event_name": "PreToolUse",
                    "tool_name": "Read",
                    "tool_input": {"file_path": "README.md"},
                },
                state_dir,
            )

            self.assertEqual(json.loads(allowed.stdout), {})
            self.assertFalse(
                (state_dir / "claude--claude-session-no-prompt.json").exists()
            )

    def test_claude_deny_names_this_sessions_declaration_after_a_restart(self) -> None:
        """Issue 715: a model switch restarts the session as B with A's history. B's state has a
        nonce and no flow, and the model copied A's stale declaration; the deny must name B's."""
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            (state_dir / "claude--session-A.json").write_text(
                json.dumps({"nonce": "aaaaaaaaaaaaaaaa", "flow": "implement", "yes": True,
                            "caveman": "ultra"}), encoding="utf-8")
            (state_dir / "claude--session-B.json").write_text(
                json.dumps({"nonce": "bbbbbbbbbbbbbbbb", "flow": None, "last_flow": None,
                            "yes": True, "caveman": "ultra"}), encoding="utf-8")
            denied = self.run_gate(
                "claude-pre-tool",
                {"session_id": "session-B", "hook_event_name": "PreToolUse",
                 "tool_name": "Bash", "tool_input": {"command": "ls"}},
                state_dir,
            )

            decision = json.loads(denied.stdout)["hookSpecificOutput"]
            self.assertEqual(decision["permissionDecision"], "deny")
            reason = decision["permissionDecisionReason"]
            self.assertIn('declare-claude "session-B" "bbbbbbbbbbbbbbbb" <flow>', reason)
            self.assertNotIn("session-A", reason)

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

    def test_plugin_manifest_wires_all_gate_events_and_settings_no_longer_do(self) -> None:
        # Issue 208: the governance hooks ride in the aac-skills plugin payload (marketplace clone
        # is the copy the PC's Codex manifest also points at). ~/.claude/settings.json must not
        # carry the same entries, or every event fires twice on a PC session.
        manifest = json.loads(PLUGIN_HOOKS.read_text(encoding="utf-8"))
        hooks = manifest["hooks"]
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
        # Every command resolves through the plugin root, never a home path.
        for event_groups in hooks.values():
            for group in event_groups:
                for hook in group["hooks"]:
                    for key in ("command", "commandWindows"):
                        cmd = hook.get(key, "")
                        if "hooks/scripts/" in cmd:
                            self.assertIn("${CLAUDE_PLUGIN_ROOT}", cmd)
        settings = json.loads(CLAUDE_SETTINGS.read_text(encoding="utf-8"))
        live = json.dumps(settings.get("hooks", {}))
        # Issue 733: EVERY script the plugin manifest dispatches, read off the manifest rather than
        # listed here, so a hook added to the payload later is covered without editing this test.
        # The stop-slop pair was the last one settings.json still named.
        shipped = set()
        for event_groups in hooks.values():
            for group in event_groups:
                for hook in group["hooks"]:
                    cmd = hook.get("command", "")
                    if "hooks/scripts/" in cmd:
                        shipped.add(cmd.split("hooks/scripts/", 1)[1].split('"', 1)[0])
        self.assertIn("stopslop-stop.py", shipped)
        self.assertIn("session-gate.js", shipped)
        for name in sorted(shipped):
            self.assertNotIn(name, live, f"settings.json still dispatches {name}: double fire")
        # Third-party entries are not the plugin's to carry and stay (the caveman proxy, the
        # caveman shrink hook).
        self.assertIn("caveman-proxy.exe", live)
        self.assertIn("shrink-hook", live)

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
        # Default level for a fresh session comes from the caveman plugin's config, not from any
        # hook. The copy this repo ships is what a machine gets; %APPDATA% is where it lands.
        self.assertEqual(
            json.loads(CAVEMAN_PLUGIN_CONFIG.read_text(encoding="utf-8")).get("defaultMode"),
            "ultra",
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

    def test_claude_stop_releases_a_session_that_cannot_run_the_declaration(self) -> None:
        # Issue 499: declaring a route needs Bash or PowerShell. A session with neither — a headless
        # `claude -p` with Bash denied — cannot satisfy the block, and refusing every Stop loops to
        # the turn limit and returns an empty result with no error. Refuse once, then release.
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-nobash"}, state_dir)
            first = json.loads(
                self.run_gate("claude-stop", {"session_id": "s-nobash"}, state_dir).stdout
            )
            self.assertEqual(first["decision"], "block")
            self.assertIn("No Bash or PowerShell tool", first["reason"])

            second = json.loads(
                self.run_gate("claude-stop", {"session_id": "s-nobash"}, state_dir).stdout
            )
            self.assertNotIn("decision", second)
            self.assertIn("recorded as undeclared", second["systemMessage"])
            self.assertTrue(self._state(state_dir, "s-nobash")["undeclared_stop"])

            # Claude Code's own loop bound releases it on the first Stop too.
            self.run_gate("claude-prompt", {"session_id": "s-nobash-flag"}, state_dir)
            flagged = json.loads(
                self.run_gate(
                    "claude-stop",
                    {"session_id": "s-nobash-flag", "stop_hook_active": True},
                    state_dir,
                ).stdout
            )
            self.assertNotIn("decision", flagged)
            self.assertIn("recorded as undeclared", flagged["systemMessage"])

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

    def _correction_turn(self, state_dir: Path, sid: str, prompt: str, tools: list[str]) -> dict:
        ctx = json.loads(
            self.run_gate("claude-prompt", {"session_id": sid, "prompt": prompt}, state_dir).stdout
        )["hookSpecificOutput"]["additionalContext"]
        nonce = self._state(state_dir, sid)["nonce"]
        self.run_claude_declare(sid, nonce, "implement", state_dir)
        transcript = self._transcript_with_tools(state_dir, tools, "Card fixed.")
        self.run_gate(
            "claude-stop", {"session_id": sid, "transcript_path": transcript}, state_dir
        )
        return {"context": ctx, "state": self._state(state_dir, sid)}

    def test_a_correction_injects_the_system_fix_protocol(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            turn = self._correction_turn(
                Path(folder), "s-corr", "Somehow you missed the end of this email chain", ["Edit"]
            )
            self.assertIn("CORRECTION DETECTED", turn["context"])
            self.assertNotIn("pending_correction", turn["state"])  # an Edit closes it

    def test_a_correction_turn_with_no_file_change_is_carried_to_the_next_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            turn = self._correction_turn(
                state_dir, "s-open", "Wrong, you should have put the OSH bid first", ["Bash"]
            )
            self.assertIn("CORRECTION NOT CLOSED", turn["state"]["pending_correction"])
            nxt = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-open", "prompt": "ok"}, state_dir).stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertIn("CORRECTION NOT CLOSED", nxt)
            self.assertNotIn("CORRECTION DETECTED", nxt)
            again = json.loads(
                self.run_gate("claude-prompt", {"session_id": "s-open", "prompt": "ok"}, state_dir).stdout
            )["hookSpecificOutput"]["additionalContext"]
            self.assertNotIn("CORRECTION NOT CLOSED", again)  # consumed once

    def test_an_ordinary_prompt_is_not_a_correction(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            turn = self._correction_turn(Path(folder), "s-plain", "do them all", ["Bash"])
            self.assertNotIn("CORRECTION DETECTED", turn["context"])
            self.assertNotIn("pending_correction", turn["state"])

    # Issue 727: Jev decides; the regex answers only when Jev is unavailable.
    FALSE_FIRES = ("what is wrong with the build?", "the test output looks wrong, dig in")

    def _with_jev(self, stub: str) -> None:
        os.environ["TYPESAFE_JEV_STUB"] = stub
        self.addCleanup(os.environ.__setitem__, "TYPESAFE_JEV_STUB", "off")

    def test_the_observed_false_fires_are_not_corrections_when_jev_says_no(self) -> None:
        self._with_jev(self._canned(correction=0.04, scope="other"))
        for n, prompt in enumerate(self.FALSE_FIRES):
            with self.subTest(prompt=prompt), tempfile.TemporaryDirectory() as folder:
                turn = self._correction_turn(Path(folder), f"s-ff{n}", prompt, ["Bash"])
                self.assertNotIn("CORRECTION DETECTED", turn["context"])
                self.assertNotIn("pending_correction", turn["state"])

    def test_a_real_correction_still_fires_when_jev_says_yes(self) -> None:
        self._with_jev(self._canned(correction=0.97, scope="other"))
        with tempfile.TemporaryDirectory() as folder:
            turn = self._correction_turn(
                Path(folder), "s-real", "that's wrong, you said X but it is Y", ["Bash"]
            )
            self.assertIn("CORRECTION DETECTED", turn["context"])
            self.assertIn("CORRECTION NOT CLOSED", turn["state"]["pending_correction"])

    def test_jev_unavailable_detection_is_exactly_the_regex(self) -> None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("gate_under_test_corr", SCRIPT)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        prompts = [*self.FALSE_FIRES, "that's wrong, you said X but it is Y", "do them all",
                   "Somehow you missed the end of this email chain", "", "   "]
        expected = [gate.CORRECTION_PATTERN.search(p) is not None for p in prompts]
        self.assertEqual(expected, [True, True, True, False, True, False, False])
        for stub in ("off", '{"hedge": 0.1}', "{not json"):
            os.environ["TYPESAFE_JEV_STUB"] = stub
            with self.subTest(stub=stub):
                self.assertEqual([gate._is_correction(p) for p in prompts], expected)
        os.environ["TYPESAFE_JEV_STUB"] = "off"
        # The real client against a refused loopback port: the service-down path.
        import socket

        os.environ.pop("TYPESAFE_JEV_STUB")
        self.addCleanup(os.environ.__setitem__, "TYPESAFE_JEV_STUB", "off")
        import jev

        closed = socket.socket()
        closed.bind(("127.0.0.1", 0))
        port = closed.getsockname()[1]
        closed.close()
        saved = jev.ENDPOINT
        jev.ENDPOINT = f"http://127.0.0.1:{port}/v1/systemone"
        try:
            self.assertEqual([gate._is_correction(p) for p in prompts], expected)
        finally:
            jev.ENDPOINT = saved

    def test_clean_final_message_carries_no_lint(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self.run_gate("claude-prompt", {"session_id": "s-clean"}, state_dir)
            nonce = self._state(state_dir, "s-clean")["nonce"]
            self.run_claude_declare("s-clean", nonce, "implement", state_dir)
            self.run_presend_lint(
                "s-clean", "Hook wired. Tests pass.\nNext: reload the session.", state_dir
            )
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
            self.run_presend_lint("s-stale", "Clean enough.\nNext: send it.", state_dir)
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
                 "who made the decision that the approval did not reach the system that holds it."
                 "\nNext: open the router.")
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

    def test_lint_never_requires_the_pylons_prefix_because_it_is_a_canary(self) -> None:
        # Dan, 2026-09-25: the prefix lives only in the global CLAUDE.md so its absence shows him a
        # session has started forgetting rules. A lint that required it would hide that signal.
        body = "Queue empty. Tests pass. Deployed bytes match.\nNext: open the log."
        done = subprocess.run(
            [sys.executable, str(SCRIPT), "lint", "-"],
            input=body, text=True, capture_output=True, check=False,
        )
        self.assertNotIn("PYLONS", done.stdout)
        self.assertNotIn("PREFIX", done.stdout)

    def test_yes_lint_flags_absence_stated_after_a_refused_call(self) -> None:
        # Dan, 2026-09-25: GraphQL and /users REST both refused a Projects board add, and the reply
        # said "the issues are not on the Projects board". Board auto-add had placed all eleven.
        import importlib.util

        spec = importlib.util.spec_from_file_location("gate_absence", SCRIPT)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        claim = "The issues are not on the Projects board. Next: add them."
        refused = ['{"message":"This GitHub API path is not available: sessions are bound"} 403']
        self.assertTrue(any("YES absence" in v for v in gate._yes_lint(claim, {"Bash"}, refused)))
        # The same sentence with no refused call this turn is not this rule's business.
        self.assertFalse(any("YES absence" in v for v in gate._yes_lint(claim, {"Bash"}, [])))
        # A refused call with no statement of absence is not flagged either.
        self.assertFalse(any(
            "YES absence" in v for v in gate._yes_lint("Board add refused with 403.", {"Bash"}, refused)
        ))
        # The transcript reader finds the refusal in this turn's tool results only.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "t.jsonl"
            records = [
                {"type": "user", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "old", "content": "HTTP 403"}]}},
                {"type": "user", "message": {"role": "user", "content": "add them to the board"}},
                {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash"}]}},
                {"type": "user", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "a", "content": refused[0]}]}},
                {"type": "user", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "b", "content": "201 Created"}]}},
            ]
            path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
            self.assertEqual(len(gate._turn_refusals(str(path))), 1)

    def test_yes_lint_flags_review_absence_claimed_before_the_matching_read(self) -> None:
        # A "no review threads" claim is premature until the reply actually read the reviews — no
        # refusal need be involved, unlike the board-add case above.
        import importlib.util

        spec = importlib.util.spec_from_file_location("gate_review_read", SCRIPT)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        claim = "No review threads on this PR. Next: merge."
        self.assertTrue(any("review claim" in v for v in gate._yes_lint(claim, set(), [])))
        self.assertTrue(any("review claim" in v for v in gate._yes_lint(claim, {"Bash"}, [])))
        # A successful get_reviews or get_review_comments call this turn clears it.
        self.assertFalse(
            any("review claim" in v for v in gate._yes_lint(claim, {"get_reviews"}, []))
        )
        self.assertFalse(
            any("review claim" in v for v in gate._yes_lint(claim, {"get_review_comments"}, []))
        )
        # Reading the method argument off a pull_request_read tool_use in the transcript.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "t.jsonl"
            records = [
                {"type": "user", "message": {"role": "user", "content": "any review threads?"}},
                {"type": "assistant", "message": {"content": [{
                    "type": "tool_use", "name": "mcp__github__pull_request_read",
                    "input": {"method": "get_reviews", "pullNumber": 1},
                }]}},
                {"type": "user", "message": {"content": [
                    {"type": "tool_result", "tool_use_id": "a", "content": "[]"}]}},
            ]
            path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
            names = gate._turn_tool_names(str(path))
            self.assertIn("get_reviews", names)
            self.assertFalse(any("review claim" in v for v in gate._yes_lint(claim, names, [])))

    def test_lint_exempts_the_mandated_pylons_prefix_but_no_other_fence(self) -> None:
        # ~/.claude/CLAUDE.md orders every reply to open with this diff fence. It is a directive,
        # not working material, so the lint ignores it - at the top only, and only that block.
        prefix = "```diff\n- YOU MUST CONSTRUCT ADDITIONAL PYLONS\n```\n\n"
        clean = prefix + "Queue empty. Tests pass. Deployed bytes match.\nNext: open the log."
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
            self.assertIn("CAVEMAN LITE: ENFORCED", context("/aac-skills:caveman lite"))
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
                "s-switch",
                "The queue is empty and the deploy is scheduled for the morning."
                "\nNext: open the deploy log.",
                state_dir,
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
            # implement is a build route (issue 842): open its skill before the backup gate's own
            # edits are exercised, or the route-skill gate denies first and this test would be
            # testing the wrong gate.
            self.run_gate(
                "claude-pre-tool",
                {"session_id": "s-bak", "tool_name": "Skill", "tool_input": {"skill": "implement"}},
                state_dir, caveman="keep",
            )
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

    # Issue 842: build routes must open their own skill before their first edit; helpers and talk
    # routes are exempt.
    def _declared(self, state_dir: Path, sid: str, flow: str) -> None:
        self.run_gate("claude-prompt", {"session_id": sid}, state_dir)
        nonce = self._state(state_dir, sid)["nonce"]
        self.run_claude_declare(sid, nonce, flow, state_dir)

    def _edit_call(self, state_dir: Path, sid: str, path: Path, agent_id: str | None = None) -> dict:
        event = {
            "session_id": sid, "tool_name": "Edit",
            "tool_input": {"file_path": str(path), "old_string": "x", "new_string": "y"},
        }
        if agent_id is not None:
            event["agent_id"] = agent_id
        return json.loads(self.run_gate("claude-pre-tool", event, state_dir, caveman="keep").stdout)

    def test_build_route_refuses_an_edit_before_its_skill_is_opened(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self._declared(state_dir, "s-build", "implement")
            target = state_dir / "file.txt"
            target.write_text("x", encoding="utf-8")

            denied = self._edit_call(state_dir, "s-build", target)

            self.assertEqual(denied["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertIn("implement", denied["hookSpecificOutput"]["permissionDecisionReason"])

    def test_build_route_allows_edits_once_its_skill_is_opened(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self._declared(state_dir, "s-build-ok", "implement")
            target = state_dir / "file.txt"
            target.write_text("x", encoding="utf-8")

            self.run_gate(
                "claude-pre-tool",
                {"session_id": "s-build-ok", "tool_name": "Skill",
                 "tool_input": {"skill": "implement"}},
                state_dir, caveman="keep",
            )

            self.assertEqual(self._edit_call(state_dir, "s-build-ok", target), {})

    def test_helper_calls_carrying_agent_id_skip_the_route_skill_gate(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self._declared(state_dir, "s-helper", "implement")
            target = state_dir / "file.txt"
            target.write_text("x", encoding="utf-8")

            self.assertEqual(
                self._edit_call(state_dir, "s-helper", target, agent_id="sub-1"), {}
            )

    def test_talk_routes_have_no_edit_limit_at_all(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            for flow in ("direct-answer", "grill-with-docs", "research"):
                with self.subTest(flow=flow):
                    sid = f"s-talk-{flow}"
                    self._declared(state_dir, sid, flow)
                    target = state_dir / f"{flow}.txt"
                    target.write_text("x", encoding="utf-8")
                    self.assertEqual(self._edit_call(state_dir, sid, target), {})

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
            draft.write_text(
                "Queue empty. Tests pass. Deployed bytes match.\nNext: open the log.",
                encoding="utf-8",
            )
            done = subprocess.run(
                [sys.executable, str(SCRIPT), "lint", str(draft)],
                text=True, capture_output=True, check=False,
            )
            self.assertEqual(done.returncode, 0)


if __name__ == "__main__":
    unittest.main()

class Issue608CoworkShellTests(unittest.TestCase):
    run_gate = AskMattGateTests.run_gate
    set_caveman = AskMattGateTests.set_caveman

    """Issue 608: Cowork's shell is `mcp__workspace__bash`; the declaration must be exempted from
    it, with the exit-echo suffix the model appends by habit, and a surface with no shell at all
    is refused once per session, not forever."""

    def _prompt(self, state_dir: Path, session: str) -> str:
        prompt = self.run_gate(
            "claude-prompt", {"session_id": session, "hook_event_name": "UserPromptSubmit"},
            state_dir,
        )
        self.assertEqual(prompt.returncode, 0, prompt.stderr)
        return json.loads((state_dir / f"claude--{session}.json").read_text(encoding="utf-8"))["nonce"]

    def test_declaration_through_an_mcp_shell_is_exempted(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            nonce = self._prompt(state_dir, "cowork-1")
            base = f'python "{SCRIPT}" declare-claude "cowork-1" "{nonce}" direct-answer'
            for command in (base, base + '; echo "exit=$?"', base + " 2>&1; echo 'EXIT=$?'"):
                with self.subTest(command=command):
                    out = self.run_gate("claude-pre-tool", {
                        "session_id": "cowork-1", "hook_event_name": "PreToolUse",
                        "tool_name": "mcp__workspace__bash", "tool_input": {"command": command},
                    }, state_dir)
                    self.assertEqual(json.loads(out.stdout), {}, out.stdout)
            # Any other command through that shell is still refused until the route is declared.
            other = self.run_gate("claude-pre-tool", {
                "session_id": "cowork-1", "hook_event_name": "PreToolUse",
                "tool_name": "mcp__workspace__bash", "tool_input": {"command": "ls"},
            }, state_dir)
            self.assertEqual(
                json.loads(other.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_a_surface_with_no_shell_is_refused_once_then_released(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            self._prompt(state_dir, "noshell-1")
            event = {
                "session_id": "noshell-1", "hook_event_name": "PreToolUse",
                "tool_name": "mcp__memory__read", "tool_input": {"path": "/x"},
            }
            first = self.run_gate("claude-pre-tool", event, state_dir)
            second = self.run_gate("claude-pre-tool", event, state_dir)
            self.assertEqual(
                json.loads(first.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")
            self.assertEqual(json.loads(second.stdout), {}, second.stdout)
            # The release is per session: a new prompt does not re-arm the deny.
            self._prompt(state_dir, "noshell-1")
            third = self.run_gate("claude-pre-tool", event, state_dir)
            self.assertEqual(json.loads(third.stdout), {}, third.stdout)
            # A Claude Code read-class tool gets no such release: Bash exists there to declare with.
            read = self.run_gate("claude-pre-tool", {**event, "tool_name": "Read"}, state_dir)
            self.assertEqual(
                json.loads(read.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")


class DeclarationRunnerSpellingTests(unittest.TestCase):
    """The declaration is whitelisted by an exact command match, so the interpreter spelling is
    part of the contract. Accepting `python` alone denied `python3` — the only spelling a Linux
    container ships, and the one the payload's own hooks.json uses on Unix — so a cloud session
    could neither declare nor run any other tool. A probe spawned on 2026-09-21 reported
    "deadlock: every tool blocked by safety gate; declaration itself requires Bash".
    """

    def _accepts(self, runner: str) -> bool:
        import importlib.util

        spec = importlib.util.spec_from_file_location("gate_under_test", SCRIPT)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        command = f'{runner} "{gate.SCRIPT}" declare-claude "s1" "n1" implement'
        return gate._is_claude_declaration_command(
            {"tool_name": "Bash", "tool_input": {"command": command}}, "s1", "n1"
        )

    def test_every_real_interpreter_spelling_is_accepted(self) -> None:
        for runner in ("python", "python3", "python3.11", "py -3",
                       "/usr/local/bin/python3", "/usr/bin/python", "python.exe"):
            with self.subTest(runner=runner):
                self.assertTrue(self._accepts(runner), f"{runner} must reach the declaration")

    def test_another_interpreter_is_still_refused(self) -> None:
        for runner in ("node", "bash", "pythonx", "sh -c python3"):
            with self.subTest(runner=runner):
                self.assertFalse(self._accepts(runner))


class YesLintJevTests(unittest.TestCase):
    """Issue 723: a regex hit is put to Jev about the reply's own voice, so quoting a banned word
    no longer fires; with Jev unavailable the regex verdicts stand exactly. Jev is stubbed through
    TYPESAFE_JEV_STUB; nothing here reaches the network."""

    QUOTED = "Fixed the lint.\nThe rule bans words like probably and should be.\nNext: merge PR 9."
    GUESS = "The build probably failed on the Windows runner."

    def setUp(self) -> None:
        import importlib.util

        spec = importlib.util.spec_from_file_location("gate_under_test_jev", SCRIPT)
        self.gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.gate)
        self.addCleanup(os.environ.__setitem__, "TYPESAFE_JEV_STUB", "off")

    def lint(self, stub: str, draft: str) -> subprocess.CompletedProcess[str]:
        env = dict(os.environ, TYPESAFE_JEV_STUB=stub)
        with tempfile.TemporaryDirectory() as folder:
            env["ASK_MATT_GATE_STATE_DIR"] = folder
            env["GOVERNANCE_CLAUDE_HOME"] = str(Path(folder) / "claude-home")
            return subprocess.run(
                [sys.executable, str(SCRIPT), "lint", "-"], input=draft, text=True,
                capture_output=True, env=env, check=False,
            )

    def test_a_quoted_banned_word_lints_clean_when_jev_says_the_reply_does_not_guess(self) -> None:
        self.assertIn("YES hedge", self.lint("off", self.QUOTED).stdout)  # today's regex fires
        result = self.lint('{"hedge": 0.12}', self.QUOTED)
        self.assertNotIn("YES", result.stdout.replace("YES rules pass", ""))
        self.assertEqual(result.returncode, 0)
        self.assertIn("YES rules pass", result.stdout)

    def test_a_guess_in_the_replys_own_voice_still_fails(self) -> None:
        result = self.lint('{"hedge": 0.96}', self.GUESS)
        self.assertEqual(result.returncode, 1)
        self.assertIn("YES hedge without evidence: probably", result.stdout)

    def test_jev_unavailable_returns_exactly_the_regex_verdicts(self) -> None:
        import socket

        drafts = [
            self.QUOTED,
            "Fixed. Please check it works on your side.",
            "Tests pass. Deploy confirmed. The culprit is the relay.",
            "The Manager Tools PDF contains no sample prose for the body sections.",
        ]
        os.environ["TYPESAFE_JEV_STUB"] = "off"
        baseline = [self.gate._yes_lint(d, set()) for d in drafts]
        self.assertTrue(all(baseline))
        # A stub that does not answer every fired rule, or is not JSON, is unavailable too.
        for stub in ('{"other": 0.1}', "{not json"):
            os.environ["TYPESAFE_JEV_STUB"] = stub
            with self.subTest(stub=stub):
                self.assertEqual([self.gate._yes_lint(d, set()) for d in drafts], baseline)
        # The real client: a refused connection and a server that never answers (timeout), both on
        # loopback. No credential in a container surfaces as an HTTP error, the same path.
        os.environ.pop("TYPESAFE_JEV_STUB")
        import jev  # the gate's lazy import put the hooks dir on sys.path

        silent = socket.socket()
        silent.bind(("127.0.0.1", 0))
        silent.listen(1)
        self.addCleanup(silent.close)
        closed = socket.socket()
        closed.bind(("127.0.0.1", 0))
        refused_port = closed.getsockname()[1]
        closed.close()
        for endpoint in (f"http://127.0.0.1:{refused_port}/v1/systemone",
                         f"http://127.0.0.1:{silent.getsockname()[1]}/v1/systemone"):
            with self.subTest(endpoint=endpoint):
                saved = (jev.ENDPOINT, self.gate.YES_JEV_TIMEOUT)
                jev.ENDPOINT, self.gate.YES_JEV_TIMEOUT = endpoint, 0.3
                try:
                    self.assertEqual([self.gate._yes_lint(d, set()) for d in drafts], baseline)
                finally:
                    jev.ENDPOINT, self.gate.YES_JEV_TIMEOUT = saved
