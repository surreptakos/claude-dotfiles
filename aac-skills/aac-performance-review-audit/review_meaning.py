"""Meaning checks for an AAC One Page review: the `meaning` command (issue 1243, spec issue 1242).

  python3 review_gate_tools.py meaning REVIEW.docx --end 7/23/2026 [--start 7/24/2025] --direct FIRSTNAME
  python3 review_format_check.py meaning REVIEW.docx --end 7/23/2026 [--start 7/24/2025] --direct FIRSTNAME

One module, two copies: aac-performance-review-audit/review_meaning.py and
aac-review-self-check/review_meaning.py, pinned byte-identical by tools/review-meaning-copies.test.js
(the plugin payload resolves nothing outside a skill folder). Edit one, copy it over the other. The
same holds for jev.py beside it, a copy of the hooks' client (profile/codex/hooks/jev.py).

The host script passes itself as `host`, which supplies load(), sentences(), parse_date() and
all_dates(), so this reads the page exactly as the format check does.

CHECKS is the spec's check table: every meaning check in standards.md, its kind and its form.
A "rule" is decided here by code. A "jev" check is a TypeSafe Jev question; until its question
lands it is read by hand, and the output lists it under "Read". A "note" is reported and never
a fix. A Jev finding, once there are any, ends its fix line with "(Jev)".

Output: fix lines in the Gate 2 form ("S3: sentence 3 names two dates ...; it must be one
example."), used verbatim. Exit codes: 0 clean, 1 fixes, 2 could not check (unreadable file,
nothing to check, or Jev unavailable for a question that was asked). 2 is never a pass.
"""
import argparse
import re
import sys

import jev

CHECKS = [
    # (check, kind, form)
    ("Guidance sentence is an instruction", "rule, then jev",
     'Rule fails a sentence opening on the direct\'s name, he, she, they, "I will", "I\'ll" or "I want"'),
    ("SEER sentence 2 is Elaborate", "jev", "Choice"),
    ("Sentence 3 is one specific example", "rule, then jev", "Rule fails two or more dates"),
    ("Sentence 4 restates sentence 1", "rule, then jev", "Banned-modal rule runs in the format check"),
    ("Sentence 1 is behavior", "jev", "Choice"),
    ("Sentence 1 is a pattern", "jev", "Noul"),
    ("Example demonstrates the pattern", "jev", "Noul over sentences 1 and 3"),
    ("Each Weakness has Guidance", "jev", "Choice per Weakness over the Guidance points plus none"),
    ("Ramification lists Weaknesses or current work", "jev", "Noul"),
    ("Names a specific account", "rule, then jev", "Code finds candidates; Jev selects"),
    ("Commas per item", "note", "Count per Strength and Weakness, never a fix"),
]

# Jev questions by check name, filled in by later tickets. A check with none is read by hand.
QUESTIONS = {}

NOT_INSTRUCTION = re.compile(r"(?:he|she|they|i will|i['’]ll|i want)\b", re.I)
LEAD = re.compile(r"[\"“(\s]*")


class CouldNotCheck(Exception):
    pass


def opening(sentence, direct):
    """The opening that makes a Guidance sentence a description or a promise, or None."""
    text = LEAD.sub("", sentence, count=1)
    m = NOT_INSTRUCTION.match(text)
    if m:
        return m.group(0)
    first = re.match(r"[A-Za-z][\w-]*(?:['’]s)?", text)
    name = direct.split()[0].lower() if direct.strip() else ""
    if first and name and re.sub(r"['’]s$", "", first.group(0)).lower() == name:
        return first.group(0)
    return None


def guidance_fixes(G, host, direct):
    fixes = []
    for i, g in enumerate(G, 1):
        m = re.match(r"Guidance Point (\d+):\s*(.*)$", g, re.S)
        body, label = (m.group(2), f"Guidance {m.group(1)}") if m else (g, f"Guidance {i}")
        for n, s in enumerate(host.sentences(body), 1):
            hit = opening(s, direct)
            if hit:
                fixes.append(f"{label}: sentence {n} opens on \"{hit}\" and is not an instruction; "
                             "it must be an instruction for next year.")
    return fixes


def example_fixes(items, host):
    fixes, seer = [], 0
    for name, txt in items:
        ss = host.sentences(txt)
        if len(ss) != 4:
            continue
        seer += 1
        seen = []
        for d, raw in host.all_dates(ss[2]):
            if d not in [x for x, _ in seen]:
                seen.append((d, raw))
        if len(seen) >= 2:
            fixes.append(f"{name}: sentence 3 names {len(seen)} dates ({', '.join(r for _, r in seen)}); "
                         "it must be one example.")
    return fixes, seer


def ask_jev(state):
    """Every Jev question in one request. {} when there are none; CouldNotCheck when Jev cannot answer."""
    if not QUESTIONS:
        return {}
    answers = jev.ask(state, QUESTIONS)
    if answers is None:
        raise CouldNotCheck("Jev did not answer (no key, 401, 402 or timeout)")
    return answers


def run(a, host):
    try:
        end = host.parse_date(a.end)
        start = host.parse_date(a.start) if a.start else None
    except ValueError as e:
        raise CouldNotCheck(str(e))
    try:
        _, core, S, W, G, _ = host.load(a.docx)
    except Exception as e:
        raise CouldNotCheck(f"cannot read {a.docx}: {e.__class__.__name__}: {e}")
    if not (S or W or G):
        raise CouldNotCheck("found no Strengths, Weaknesses or Guidance on the page")
    items = [(f"S{i}", t) for i, t in enumerate(S, 1)] + [(f"W{i}", t) for i, t in enumerate(W, 1)]
    fixes, checked = [], []

    ef, seer = example_fixes(items, host)
    fixes += ef
    checked.append(f"SEER sentence 3 is one example ({seer} SEER items)")
    fixes += guidance_fixes(G, host, a.direct)
    checked.append(f"Guidance sentences open as instructions ({len(G)} points)")

    ask_jev({"period": [str(start) if start else None, str(end)], "direct": a.direct,
             "core_message": core, "strengths": S, "weaknesses": W, "guidance": G})
    read = [c for c, kind, _ in CHECKS if "jev" in kind and c not in QUESTIONS]
    commas = ", ".join(f"{name} {txt.count(',')}" for name, txt in items)
    return fixes, checked, read, commas


def main(argv, host):
    try:
        sys.stdout.reconfigure(errors="replace")
    except AttributeError:
        pass
    ap = argparse.ArgumentParser(prog="meaning")
    ap.add_argument("docx")
    ap.add_argument("--end", required=True)
    ap.add_argument("--start")
    ap.add_argument("--direct", required=True, help="the direct's first name")
    a = ap.parse_args(argv)
    try:
        fixes, checked, read, commas = run(a, host)
    except CouldNotCheck as e:
        print(f"MEANING: COULD NOT CHECK ({e}). This is not a pass.")
        return 2
    print("MEANING:", "PASS" if not fixes else f"FAIL ({len(fixes)} fix{'es' if len(fixes) != 1 else ''})")
    for f in fixes:
        print("  -", f)
    print("Checked by rule:", "; ".join(checked))
    if read:
        print("Read (no Jev question yet):", "; ".join(read))
    if commas:
        print(f"Note: commas per item, keep them to a minimum: {commas}")
    return 0 if not fixes else 1
