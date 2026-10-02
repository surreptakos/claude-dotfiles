"""Small TypeSafe Jev client for the hooks: ask Noul and Choice questions, get answers or None.

Issue 723. One POST to https://api.typesafe.ai/v1/systemone with every question over one state.
`ask` and `ask_nouls` never raise: no credential, a timeout, an HTTP error or a malformed answer
all return None, and the caller keeps its own verdict. Standard library only, so the plugin
payload needs nothing installed.

Issue 839: `ask` also takes pick-one (Choice) questions, `{"type": "choice", "instructions": ...,
"criteria": {option: description}}`. A Choice answer is `{"choice": option, "probabilities":
{option: p}}`; a Noul answer is the probability of yes.

Credential: `TYPESAFE_API_KEY` when set; in cloud sessions the agent proxy injects it for
api.typesafe.ai, so the request goes out without a header and a 401 means "no credential".

`TYPESAFE_JEV_STUB` replaces the network for tests and for switching Jev off:
  unset       - call the service
  "off"       - unavailable; every caller falls back to its regexes
  a JSON map  - {question_id: probability} for a Noul, {question_id: "option"} for a Choice; an id
                missing from the map, or an option the Choice does not offer, makes the call
                unavailable
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


def _is_choice(question: Any) -> bool:
    return isinstance(question, dict) and question.get("type") == "choice"


def _choice_answer(question: dict[str, Any], picked: Any, probabilities: Any = None) -> dict[str, Any]:
    """A validated Choice answer; raises on an option the question does not offer."""
    options = list((question.get("criteria") or {}).keys())
    if picked not in options:
        raise ValueError(f"{picked!r} is not an option")
    if probabilities is None:
        probabilities = {option: 1.0 if option == picked else 0.0 for option in options}
    distribution = {option: float(probabilities.get(option, 0.0)) for option in options}
    if any(not 0.0 <= p <= 1.0 for p in distribution.values()):
        raise ValueError("probability out of range")
    return {"choice": picked, "probabilities": distribution}


def _stub(questions: dict[str, Any]) -> dict[str, Any] | None | bool:
    """The stubbed answers, None for unavailable, or False when no stub is configured."""
    raw = os.environ.get("TYPESAFE_JEV_STUB")
    if raw is None or raw == "":
        return False
    if raw.strip().lower() == "off":
        return None
    try:
        text = raw if raw.lstrip().startswith("{") else open(raw, encoding="utf-8").read()
        table = json.loads(text)
        return {
            qid: _choice_answer(q, table[qid]) if _is_choice(q) else float(table[qid])
            for qid, q in questions.items()
        }
    except Exception:
        return None


def _wire(question: Any) -> dict[str, Any]:
    if _is_choice(question):
        return {"type": "choice", "instructions": question["instructions"], "criteria": question["criteria"]}
    if isinstance(question, dict):
        return {"type": "noul", **question}
    return {"type": "noul", "instructions": question}


def ask(state: Any, questions: dict[str, Any], timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any] | None:
    """Every question answered in one request, or None when Jev cannot answer all of them.

    A Noul (a string, or a dict without `"type": "choice"`) answers with the probability of yes; a
    Choice answers with {"choice": option, "probabilities": {option: p}}.
    """
    if not questions:
        return {}
    stubbed = _stub(questions)
    if stubbed is not False:
        return stubbed  # type: ignore[return-value]
    headers = {"Content-Type": "application/json"}
    key = os.environ.get("TYPESAFE_API_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    try:
        body = {
            "state": state,
            "model": MODEL,
            "questions": {qid: _wire(q) for qid, q in questions.items()},
        }
        request = urllib.request.Request(
            ENDPOINT, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST"
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            answers = json.loads(response.read().decode("utf-8")).get("answers") or {}
        result: dict[str, Any] = {}
        for qid, q in questions.items():
            if _is_choice(q):
                result[qid] = _choice_answer(q, answers[qid]["choice"], answers[qid].get("probabilities"))
            else:
                result[qid] = float(answers[qid]["noul"])
                if not 0.0 <= result[qid] <= 1.0:
                    return None
    except Exception:
        return None
    return result


def ask_nouls(
    state: Any, questions: dict[str, Any], timeout: float = DEFAULT_TIMEOUT
) -> dict[str, float] | None:
    """Probability of yes per question id, or None when Jev cannot answer all of them."""
    nouls = {qid: q for qid, q in questions.items() if not _is_choice(q)}
    return ask(state, nouls, timeout=timeout)  # type: ignore[return-value]
