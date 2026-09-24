"""Small TypeSafe Jev client for the hooks: ask Noul questions, get probabilities or None.

Issue 723. One POST to https://api.typesafe.ai/v1/systemone with every question over one state.
`ask_nouls` never raises: no credential, a timeout, an HTTP error or a malformed answer all return
None, and the caller keeps its regex verdict. Standard library only, so the plugin payload needs
nothing installed.

Credential: `TYPESAFE_API_KEY` when set; in cloud sessions the agent proxy injects it for
api.typesafe.ai, so the request goes out without a header and a 401 means "no credential".

`TYPESAFE_JEV_STUB` replaces the network for tests and for switching Jev off:
  unset       - call the service
  "off"       - unavailable; every caller falls back to its regexes
  a JSON map  - {question_id: probability}; an id missing from the map makes the call unavailable
  a file path - a file holding that JSON map
"""

from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"
DEFAULT_TIMEOUT = 3.0


def _stub(questions: dict[str, Any]) -> dict[str, float] | None | bool:
    """The stubbed answer, None for unavailable, or False when no stub is configured."""
    raw = os.environ.get("TYPESAFE_JEV_STUB")
    if raw is None or raw == "":
        return False
    if raw.strip().lower() == "off":
        return None
    try:
        text = raw if raw.lstrip().startswith("{") else open(raw, encoding="utf-8").read()
        table = json.loads(text)
        return {qid: float(table[qid]) for qid in questions}
    except Exception:
        return None


def ask_nouls(
    state: Any, questions: dict[str, Any], timeout: float = DEFAULT_TIMEOUT
) -> dict[str, float] | None:
    """Probability of yes per question id, or None when Jev cannot answer all of them."""
    if not questions:
        return {}
    stubbed = _stub(questions)
    if stubbed is not False:
        return stubbed  # type: ignore[return-value]
    body = {
        "state": state,
        "model": MODEL,
        "questions": {
            qid: ({"type": "noul", **q} if isinstance(q, dict) else {"type": "noul", "instructions": q})
            for qid, q in questions.items()
        },
    }
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        request = urllib.request.Request(
            ENDPOINT, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            answers = json.loads(response.read().decode("utf-8")).get("answers") or {}
        result = {qid: float(answers[qid]["noul"]) for qid in questions}
    except Exception:
        return None
    if any(not 0.0 <= p <= 1.0 for p in result.values()):
        return None
    return result
