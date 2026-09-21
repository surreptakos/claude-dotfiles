"""Publish-gate exemption for the watchdog-launched orchestrator master (claude-dotfiles #81).

Dan, 2026-09-02: "I should not ever be asked to approve-tickets. I am not at the computer. This is
meant to be a completely autonomous run." The master is launched by
orchestrator/master-watchdog.ps1 with AAC_ORCHESTRATOR_AUTONOMOUS=1 in its environment; under that
variable the second `gh issue create` in a session is allowed without an AskUserQuestion or a typed
approval. Without it the existing ticket-set gate still fires - that is the regression half.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "ask_matt_gate.py"
ISSUE_CREATE = 'gh issue create --title "t" --body "b" --label ready-for-human'


class AutonomousPublishGateTests(unittest.TestCase):
    def _env(self, state_dir: Path, session_id: str, autonomous: bool) -> dict[str, str]:
        env = dict(os.environ)
        env.pop("AAC_ORCHESTRATOR_AUTONOMOUS", None)
        env["ASK_MATT_GATE_STATE_DIR"] = str(state_dir)
        env["GOVERNANCE_CLAUDE_HOME"] = str(state_dir / "claude-home")
        env["CODEX_THREAD_ID"] = session_id
        if autonomous:
            env["AAC_ORCHESTRATOR_AUTONOMOUS"] = "1"
        return env

    def _run(self, args: list[str], event: dict | None, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            input=json.dumps(event) if event is not None else None,
            text=True,
            capture_output=True,
            env=env,
            check=False,
        )

    def _second_issue_create(self, autonomous: bool) -> dict:
        """Declare to-tickets, file one issue, then return the gate's answer to the second."""
        session = "autonomous-test"
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            env = self._env(state_dir, session, autonomous)
            transcript = state_dir / "transcript.jsonl"
            transcript.write_text('{"type":"user","message":{"role":"user","content":"boot"}}\n', encoding="utf-8")
            prompt = self._run(["claude-prompt"], {"session_id": session, "hook_event_name": "UserPromptSubmit"}, env)
            self.assertEqual(prompt.returncode, 0, prompt.stderr)
            nonce = json.loads((state_dir / f"claude--{session}.json").read_text(encoding="utf-8"))["nonce"]
            declared = self._run(["declare-claude", session, nonce, "to-tickets"], None, env)
            self.assertEqual(declared.returncode, 0, declared.stderr)
            event = {
                "session_id": session,
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": ISSUE_CREATE},
                "transcript_path": str(transcript),
            }
            first = self._run(["claude-pre-tool"], event, env)
            self.assertEqual(json.loads(first.stdout), {}, "the first issue of a session is triage, never gated")
            second = self._run(["claude-pre-tool"], event, env)
            return json.loads(second.stdout)

    def test_interactive_session_still_hits_the_ticket_set_gate(self) -> None:
        out = self._second_issue_create(autonomous=False)
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertIn("ticket SET", out["hookSpecificOutput"]["permissionDecisionReason"])

    def test_autonomous_master_files_a_second_issue_unasked(self) -> None:
        self.assertEqual(self._second_issue_create(autonomous=True), {})

    def _first_issue_create_under(self, flow: str) -> dict:
        """Declare `flow`, then return the gate's answer to a `gh issue create` under it."""
        session = f"autonomous-route-{flow}"
        with tempfile.TemporaryDirectory() as folder:
            state_dir = Path(folder)
            env = self._env(state_dir, session, autonomous=True)
            prompt = self._run(["claude-prompt"], {"session_id": session, "hook_event_name": "UserPromptSubmit"}, env)
            self.assertEqual(prompt.returncode, 0, prompt.stderr)
            nonce = json.loads((state_dir / f"claude--{session}.json").read_text(encoding="utf-8"))["nonce"]
            declared = self._run(["declare-claude", session, nonce, flow], None, env)
            self.assertEqual(declared.returncode, 0, declared.stderr)
            return json.loads(self._run(["claude-pre-tool"], {
                "session_id": session,
                "hook_event_name": "PreToolUse",
                "tool_name": "Bash",
                "tool_input": {"command": ISSUE_CREATE},
            }, env).stdout)

    def test_autonomous_master_still_needs_a_ticket_route(self) -> None:
        # Autonomy lifts the ticket-SET gate, never the route gate: a session that declared a route
        # with no business filing tickets is refused whatever AAC_ORCHESTRATOR_AUTONOMOUS says.
        out = self._first_issue_create_under("code-review")
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertIn("route", out["hookSpecificOutput"]["permissionDecisionReason"])

    def test_a_publishing_route_files_its_own_ticket(self) -> None:
        # Issue 200: every route that creates issues BY DESIGN is a publishing route — implement
        # records discoveries, diagnosing-bugs files the closure ticket — so the gate that exists
        # for unasked ticket sets must not refuse the ticket the route was declared to produce.
        self.assertEqual(self._first_issue_create_under("implement"), {})


if __name__ == "__main__":
    unittest.main()
