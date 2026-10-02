"""Meaning checks for an AAC One Page review: a deterministic lint plus TypeSafe Jev judgments.

Issue 1242. One module, copied byte for byte into aac-review-self-check and
aac-performance-review-audit (a test pins the copies), driven by each folder's script:

  python3 review_format_check.py meaning REVIEW.docx --direct FIRSTNAME     (self-check)
  python3 review_gate_tools.py meaning REVIEW.docx --direct FIRSTNAME       (audit, Gate 2)

Every meaning check in standards.md is one of three kinds, decided once in CHECKS below:
a rule (code decides), a Jev typed question (code owns the threshold), or a reader check
(neither can decide). A Jev check turns its answer into a probability that the item fails:
at or above `high` it prints a fix line tagged "(Jev)", from `low` up to `high` the item goes
on the read list for Claude, and below `low` it passes. The marks come from a live eval over
real reviews against their audit files (issue 1247; the reviews stay in the private
review-audits repo, and only per-check numbers were published).

Exit codes: 0 clean, 1 fixes, 2 could not check (Jev gave no answer: no key, 401, 402,
timeout, or TYPESAFE_JEV_STUB=off). 2 is never a pass. Every run writes a gate record beside
the review (REVIEW.docx.gate.json): the file's SHA-256, the script version, the exit code and
the fix lines. The audit's `build` and the self-check's `stamp` refuse without one.

A new question starts from the typesafe:typesafe-ai skill and the live docs at docs.typesafe.ai.
Jev receives the review text: employee review content goes to api.typesafe.ai (Dan, 2026-10-01).
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import jev  # noqa: E402  (vendored beside this file: the plugin payload resolves nothing outside a skill folder)

JEV_TIMEOUT = 60.0

# One row per meaning check in standards.md. kind: rule, jev, rule+jev (the rule decides first and
# Jev judges what the rule did not fail), or reader. high/low are marks on the probability that the
# item fails the check. Marks set by the eval (issue 1247, jev-latest, 2026-10-02): each high sits
# between the lowest score an audited defect got and the highest score an item the audit passed
# got; each low keeps the synthetic Bob fixture's passing items off the read list. Issue 1348: no
# mark separated a trait word argued for by "the clearest documented case" from Bob's sentence 1,
# so s1_behavior gained the trait_case option; and example_one now asks about an example that
# carries a date or figure too, since two projects in one sentence can each carry one.
CHECKS = {
    "s1_behavior":          {"check": "Sentence 1 is behavior", "kind": "jev", "high": 0.6, "low": 0.5,
                             "form": "Choice: behavior or work product; trait, motive or attitude; a trait the item offers its example as a case of; circumstance"},
    "s1_pattern":           {"check": "Sentence 1 is a pattern", "kind": "jev", "high": 0.8, "low": 0.6,
                             "form": "Noul"},
    "s2_elaborate":         {"check": "SEER sentence 2 is Elaborate", "kind": "jev", "high": 0.75, "low": 0.6,
                             "form": "Choice: detail about the same behavior; why it matters; a new theme; an example; an instruction"},
    "example_one":          {"check": "The example is one specific example", "kind": "rule+jev", "high": 0.7, "low": 0.5,
                             "form": "Rule fails two or more dated events (a range, or a due date and its close date, is one); "
                                     "Noul over every example the rule did not fail, a date or figure included"},
    "named_accounts":       {"check": "Names a specific account", "kind": "rule+jev", "high": 0.8, "low": 0.5,
                             "form": "Code finds capitalized candidates; a Noul per candidate selects accounts; three or more is a list"},
    "example_demonstrates": {"check": "The example demonstrates the pattern", "kind": "jev", "high": 0.6, "low": 0.5,
                             "form": "Noul over sentence 1 and the example"},
    "s4_restate":           {"check": "SEER sentence 4 restates sentence 1", "kind": "rule+jev", "high": 0.8, "low": 0.6,
                             "form": "Banned-modal rule; Noul for same claim, no new theme"},
    "observation_only":     {"check": "Observation only", "kind": "rule+reader", "high": None, "low": None,
                             "form": "Gate 1 bans the modals; a \"rather than\" or \"instead of\" clause goes on the read list"},
    "repeat_flagged":       {"check": "Repeat flagged (Weaknesses)", "kind": "reader", "high": None, "low": None,
                             "form": "Needs the prior review, which is not on the page"},
    "framing":              {"check": "No framing past the record", "kind": "reader", "high": None, "low": None,
                             "form": "Needs the reviewer's own record, which is not on the page"},
    "ramification":         {"check": "Ramification lists Weaknesses or current work", "kind": "jev", "high": 0.7, "low": 0.55,
                             "form": "Noul over the Core Message and the Weakness texts; not asked for No Change"},
    "weakness_guidance":    {"check": "Each Weakness has Guidance", "kind": "rule+jev", "high": 0.7, "low": 0.5,
                             "form": "Rule fails every Weakness when there is no Guidance; Choice per Weakness over the points plus none"},
    "guidance_instruction": {"check": "Guidance sentence is an instruction", "kind": "rule+jev", "high": 0.8, "low": 0.5,
                             "form": "Rule fails an opening on the direct's name, he, she, they, I will, I'll, I want; Noul judges the rest"},
    "commas":               {"check": "Commas per item", "kind": "rule", "high": None, "low": None,
                             "form": "Count reported as a note, never a fix"},
}

# Dan's wording from standards.md (The rules: Strengths and Weaknesses; Meaning checks), not paraphrased.
SEER = ("SEER is exactly four sentences: Summarize, Elaborate, Example, Restate. Summarize states the pattern. "
        "Elaborate adds details or explains further. Example gives one specific example. Restate says the same "
        "thing again in a new way, without a new theme and without an instruction. \"Bob is my best customer "
        "service rep. He consistently exceeds every standard. He recently saved a difficult call after three other "
        "reps had failed. He's an example we ought to put on training videos.\"")
SUMEX = ("Sum-Ex is exactly two sentences: Summarize, then Example. \"Bob is my best customer service rep. "
         "Recently he saved a difficult call despite 3 other reps not being able to.\"")
BEHAVIOR = ("Sentence 1 names something the direct does that the reviewer can see or hear: what he says, how he "
            "says it, his expressions or body language, or his work product (quality, quantity, accuracy, "
            "timeliness, documents, relationships). A trait, motive, attitude, intent, idea or circumstance fails. "
            "\"He is not committed to the team\" is an inference; \"he missed three of the last five team "
            "meetings\" is behavior. \"He owns a complex account book\" is a circumstance: what does he do with "
            "it? An attitude or trait word may stand in sentence 1 only when the item's other sentences give the "
            "behavior it is read from: \"shows good judgment\" followed by what he did passes, and \"lacks "
            "decisiveness\" followed by \"the clearest documented case\" fails.")
PATTERN = ("Sentence 1 says what he does repeatedly or how he performs over the period, even though only one "
           "example follows. \"He closed the largest deal of the year\" is a one-off. \"He closes large multi-site "
           "projects\" is a pattern, and the largest deal is the example under it.")
EXAMPLE = ("The example is one specific thing that happened, not a generic descriptor such as \"stepped in.\" "
           "A date, figure or name helps and is not required: \"He recently saved a difficult call after three "
           "other reps had failed\" passes.")
DEMONSTRATES = ("The example is an instance of what sentence 1 names, not of something next to it. \"He completed "
                "several certifications\" followed by an example of him using a tool well is two different "
                "strengths in one item.")
RAMIFICATION = ("Ramification: the broad outline of what the reviewer and the direct will do next year because of "
                "the Result. It is never a list of things he should fix. A Ramification that lists the accounts he "
                "already owns is No Change. A Ramification that lists his Weaknesses is not a Ramification at all.")
GUIDANCE = ("Every Guidance point is a bullet under \"Guidance for the next year\" that starts with an action verb "
            "and names a behavior or piece of work the reviewer wants to see next year. Every sentence in it is an "
            "instruction to the direct for next year: not a description of him in the third person, not a comment "
            "on how things are now, and not a promise from the reviewer about what the reviewer will do.")

S2_OPTIONS = {
    "detail": "Adds details or explains further about the same behavior sentence 1 names, with the direct still the subject",
    "why_it_matters": "Says why the behavior matters: its value, impact or importance to the business, the team or the customer",
    "new_theme": "Introduces a different behavior or theme from the one sentence 1 names, such as a second account, relationship or accomplishment beside the one sentence 1 is about",
    "example": "Gives one specific example: an event or a figure",
    "instruction": "Tells the direct what to do",
}
S2_FIX = {
    "why_it_matters": "says why the behavior matters",
    "new_theme": "opens a new theme",
    "example": "is an example",
    "instruction": "is an instruction",
}
S1_OPTIONS = {
    "behavior": "A behavior or work product the reviewer can see or hear, a summary of how he performs (\"Bob is my best customer service rep\"), or a trait word whose behavior the item's other sentences state as what he does (\"shows good judgment\" followed by what he did)",
    "trait": "A trait, motive, attitude, intent or idea, or the lack of one (\"a lack of focus\"), with no behavior behind it in the other sentences",
    "trait_case": "A trait word, or the lack of one (\"lacks decisiveness\"), that the item's own words then argue for by calling its example a case or evidence of it (\"the clearest documented case\", \"a good example of this\"); only when those words are on the page",
    "circumstance": "A circumstance: something about his situation, not something he does, such as an assignment, role or responsibility he holds (\"he owns the reporting\", \"he is in charge of X\")",
}
S1_FIX = {"trait": "names a trait, motive or attitude", "trait_case": "names a trait and offers the example as evidence for it",
          "circumstance": "names a circumstance"}

READ_TEXT = {
    "s1_behavior": "sentence 1: behavior or work product, not a trait, motive or circumstance?",
    "s1_pattern": "sentence 1: a pattern, not a one-off?",
    "s2_elaborate": "sentence 2: detail about the same behavior (Elaborate)?",
    "example_one": "sentence {n}: one specific thing that happened?",
    "named_accounts": "sentence {n}: one example, not a list of accounts ({names})?",
    "example_demonstrates": "the example in sentence {n}: an instance of the pattern in sentence 1?",
    "s4_restate": "sentence 4: restates sentence 1 with no new theme?",
    "ramification": "the Ramification: names what changes for him, not his Weaknesses or current work?",
    "weakness_guidance": "has a Guidance point that answers it?",
    "guidance_instruction": "sentence {n}: an instruction for next year?",
}

OPENERS = ("he", "she", "they")
PROMISES = re.compile(r"^I\s+(?:will|want)\b|^I['’]ll\b", re.I)
CONTRAST = re.compile(r"\b(?:rather than|instead of)\b", re.I)
# A due or start date and the date it closed are one event, not two (issue 1247): the first date
# follows a due or start word, and the words between the two dates say it closed.
DUE_BEFORE = re.compile(r"\b(?:due|deadline|opened|received|submitted|requested|assigned)\b[^.;]{0,12}$", re.I)
CLOSED_BETWEEN = re.compile(r"^[^.;\d]{0,40}\b(?:until|closed?|completed?|finished|resolved|delivered|arrived|sent|"
                            r"submitted|signed|paid|done)\b[^.;\d]{0,12}$", re.I)


def noul(instructions, yes, no):
    return {"type": "noul", "instructions": instructions, "criteria": {"true": yes, "false": no}}


def choice(instructions, options):
    return {"type": "choice", "instructions": instructions, "criteria": dict(options)}


def quoted(sents, *ns):
    """The sentences a question is about, quoted into the question. Jev reads a quoted sentence far
    more reliably than a pointer into the state (eval, issue 1247)."""
    return "\n\n" + "\n".join(f"Sentence {n}: \"{sents[n - 1]}\"" for n in ns)


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def script_version(script):
    h = hashlib.sha256()
    for p in (script, os.path.abspath(__file__)):
        with open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


# ---------------------------------------------------------------- the gate record
def record_path(docx):
    return docx + ".gate.json"


def read_record(docx):
    try:
        with open(record_path(docx), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def write_record(docx, command, script, code, fixes, extra=None):
    """Record one run of `check` or `meaning` against the file as it stands. A record for an
    older version of the file is dropped: runs only count for the hash they ran on."""
    digest = sha256(docx)
    rec = read_record(docx)
    if not rec or rec.get("sha256") != digest:
        rec = {"file": os.path.basename(docx), "sha256": digest, "runs": {}}
    run = {"script": os.path.basename(script), "version": script_version(script), "exit": code,
           "fixes": list(fixes), "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    run.update(extra or {})
    rec["runs"][command] = run
    with open(record_path(docx), "w", encoding="utf-8") as f:
        json.dump(rec, f, indent=2)
    return rec


def record_problems(docx, clean=False):
    """Why the record does not show both runs on this exact file; empty when it does. With
    clean=True both runs must also have exited 0 (the release gate for review text)."""
    rec = read_record(docx)
    if rec is None:
        return [f"no gate record beside {os.path.basename(docx)}; run check and meaning on it first"]
    digest = sha256(docx)
    if rec.get("sha256") != digest:
        return [f"the gate record is stale: it was written for hash {str(rec.get('sha256'))[:12]}, "
                f"and the file is now {digest[:12]}; rerun check and meaning"]
    runs, out = rec.get("runs") or {}, []
    for cmd in ("check", "meaning"):
        if cmd not in runs:
            out.append(f"no {cmd} run is recorded for this version of the file")
    m = runs.get("meaning")
    if m and m.get("exit") == 2:
        out.append("meaning could not check (exit 2); that is a stop, not a pass")
    if clean:
        for cmd in ("check", "meaning"):
            r = runs.get(cmd)
            if r and r.get("exit") not in (0, 2 if cmd == "meaning" else 0):
                out.append(f"{cmd} exited {r.get('exit')}; review text ships only at exit 0")
    return out


# ---------------------------------------------------------------- the page
def guidance_points(host, G):
    out = []
    for i, g in enumerate(G, 1):
        m = re.match(r"Guidance Point (\d+):\s*(.*)$", g, re.S)
        label = f"Guidance {m.group(1) if m else i}"
        out.append((label, host.sentences(m.group(2) if m else g)))
    return out


def date_spans(host, text):
    spans = []
    for rx in (host.DATE_NUM, host.DATE_TXT):
        for m in rx.finditer(text):
            try:
                host.parse_date(m.group(0))
            except ValueError:
                continue
            spans.append((m.start(), m.end(), m.group(0)))
    return sorted(spans)


def separate_dates(host, text):
    """Dates in a sentence that stand for separate events. A range ("from DATE through DATE") counts as
    one, and so does a due or start date followed by its close date ("was due DATE and did not close
    until DATE"): one example stating when it was due and when it closed is one event."""
    spans, out = date_spans(host, text), []
    for i, (s, e, t) in enumerate(spans):
        if i:
            ps, pe, _ = spans[i - 1]
            between = text[pe:s]
            if host.RANGE_SEP.match(between) or (DUE_BEFORE.search(text[:ps]) and CLOSED_BETWEEN.match(between)):
                continue
        out.append(t)
    return out


def account_candidates(host, text, direct):
    """Capitalized names inside a sentence: not its first word, not the direct, not a date. Jev
    decides which name an account; no list of words lives here."""
    t = text
    for s, e, _ in date_spans(host, text):
        t = t[:s] + " " * (e - s) + t[e:]
    out = []
    for m in re.finditer(r"[A-Z][A-Za-z0-9&'’-]*(?:\s+[A-Z][A-Za-z0-9&'’-]*)*", t):
        name = re.sub(r"['’]s$", "", m.group(0)).strip()
        before = t[:m.start()].rstrip(" \"“(")
        if not before or before[-1] in ".!?:" or name == "I":
            continue
        if direct and (name == direct or name.startswith(direct + " ")):
            continue
        if name not in out:
            out.append(name)
    return out[:8]


def result_is_no_change(core):
    lc = core.lower()
    return "current role and responsibilities" in lc or "no change" in lc


# ---------------------------------------------------------------- the run
class Run:
    def __init__(self, host, docx, direct):
        self.host, self.direct = host, direct
        _, core, S, W, G, _ = host.load(docx)
        self.core = core
        self.items = [(f"S{i}", "Strength", t) for i, t in enumerate(S, 1)] + \
                     [(f"W{i}", "Weakness", t) for i, t in enumerate(W, 1)]
        self.sents = {lbl: host.sentences(t) for lbl, _, t in self.items}
        self.guidance = guidance_points(host, G)
        self.fixes, self.read, self.notes = [], [], []
        self.flagged = set()
        self.questions, self.consumers = {}, {}

    # -- recording
    def fix(self, label, text, jev_tag=False):
        self.fixes.append((label, f"{label}: {text}" + (" (Jev)" if jev_tag else "")))
        self.flagged.add(label)

    def to_read(self, label, check, p, **fmt):
        self.read.append((label, f"{label}: {READ_TEXT[check].format(**fmt)} (Jev {p:.2f} that it fails)"))
        self.flagged.add(label)

    def ask(self, qid, question, check, label, on_fix, pass_answer, fail_p, **fmt):
        """Queue one Jev question; `fail_p` maps its answer to the probability the item fails."""
        self.questions[qid] = question
        self.consumers[qid] = (check, label, on_fix, pass_answer, fail_p, fmt)

    def judge(self, answers):
        for qid, (check, label, on_fix, _, fail_p, fmt) in self.consumers.items():
            if check == "named_accounts":
                continue
            a = answers[qid]
            p = fail_p(a)
            row = CHECKS[check]
            if p >= row["high"]:
                self.fix(label, on_fix(a), jev_tag=True)
            elif p >= row["low"]:
                self.to_read(label, check, p, **fmt)
        self.judge_accounts(answers)

    # -- the state every question reads
    def state(self):
        items = {}
        for lbl, kind, _ in self.items:
            s = self.sents[lbl]
            items[lbl] = {"type": kind, "form": {4: "SEER", 2: "Sum-Ex"}.get(len(s), f"{len(s)} sentences"),
                          "sentences": s}
        return {"direct": self.direct or "the direct", "items": items, "core_message": self.core,
                "guidance": {lbl: s for lbl, s in self.guidance}}

    # -- the checks
    def build(self):
        for lbl, kind, txt in self.items:
            s = self.sents[lbl]
            if len(s) == 4:
                self.seer(lbl, s)
            elif len(s) == 2:
                self.sum_ex(lbl, s)
            else:
                self.notes.append(f"{lbl}: {len(s)} sentences, so its sentence roles were not checked (a Gate 1 fix).")
                self.flagged.add(lbl)
            for n, sent in enumerate(s, 1):
                if CONTRAST.search(sent):
                    self.read.append((lbl, f"{lbl}: sentence {n} has \"{CONTRAST.search(sent).group(0)}\"; "
                                           "read whether its second half names what he should have done (reader)"))
                    self.flagged.add(lbl)
        self.ramification()
        self.weakness_guidance()
        self.guidance_sentences()
        counts = ", ".join(f"{lbl} {txt.count(',')}" for lbl, _, txt in self.items)
        if counts:
            self.notes.append(f"Commas per item (fewer is better): {counts}.")

    def sentence1(self, lbl):
        ref = f"`items.{lbl}.sentences`"
        self.ask(f"{lbl}.s1_behavior",
                 choice(f"{BEHAVIOR}\n\nWhat does sentence 1 of review item {lbl} (`items.{lbl}.sentences[0]`) name? "
                        f"Read the whole item ({ref}) for the behavior a trait word is read from."
                        + quoted(self.sents[lbl], *range(1, len(self.sents[lbl]) + 1)), S1_OPTIONS),
                 "s1_behavior", lbl,
                 lambda a: f"sentence 1 {S1_FIX.get(self.worst(a, 'behavior'), 'names no behavior')}; it must name a behavior or work product.",
                 "behavior", lambda a: 1.0 - a["probabilities"].get("behavior", 0.0))
        self.ask(f"{lbl}.s1_pattern",
                 noul(f"{PATTERN}\n\nDoes sentence 1 of review item {lbl} (`items.{lbl}.sentences[0]`) state a pattern?"
                      + quoted(self.sents[lbl], 1),
                      "A pattern: what he does repeatedly, or how he performed, grew or what he built up over "
                      "the period as a whole (learning a new job, earning a certification during the year)",
                      "A one-off: a single event on one day, such as one deal, one call or one ticket"),
                 "s1_pattern", lbl,
                 lambda a: "sentence 1 is a one-off event; it must state a pattern, with the event as the example.",
                 1.0, lambda p: 1.0 - p)

    def example(self, lbl, s, n):
        sent = s[n - 1]
        dates = separate_dates(self.host, sent)
        if len(dates) >= 2:
            self.fix(lbl, f"sentence {n} holds {len(dates)} dated events ({', '.join(dates)}); it must be one example.")
        else:
            self.ask(f"{lbl}.example_one",
                     noul(f"{EXAMPLE}\n\nIs sentence {n} of review item {lbl} (`items.{lbl}.sentences[{n - 1}]`) one "
                          "specific thing that happened?" + quoted(s, n),
                          "One specific thing that happened, or one figure for the period (a count or a total)",
                          "A generic descriptor, a habit, a list, or two or more separate things he did (two actions "
                          "joined by \"and\" on different accounts or projects are two examples, even when each one "
                          "carries its own date or figure)"),
                     "example_one", lbl,
                     lambda a, n=n: f"sentence {n} is not one specific thing that happened; it must be one event or figure.",
                     1.0, lambda p: 1.0 - p, n=n)
        self.ask(f"{lbl}.example_demonstrates",
                 noul(f"{DEMONSTRATES}\n\nIs the example in sentence {n} of review item {lbl} "
                      f"(`items.{lbl}.sentences[{n - 1}]`) an instance of what sentence 1 (`items.{lbl}.sentences[0]`) names?"
                      + quoted(s, 1, n),
                      "Yes: the example shows the pattern sentence 1 names",
                      "No: the example shows something else, a second strength or weakness"),
                 "example_demonstrates", lbl,
                 lambda a, n=n: f"the example in sentence {n} is not an instance of sentence 1; the item must be about one of them.",
                 1.0, lambda p: 1.0 - p, n=n)
        for i, name in enumerate(account_candidates(self.host, sent, self.direct)):
            self.ask(f"{lbl}.account.{i}",
                     noul(f"In sentence {n} of review item {lbl} (`items.{lbl}.sentences[{n - 1}]`), does \"{name}\" name "
                          "a customer account, a customer site or a customer?",
                          "Yes: a customer account, site or customer",
                          "No: a person, a product, a system, a team, a month or anything else"),
                     "named_accounts", lbl, None, 0.0, None, n=n, name=name)

    def seer(self, lbl, s):
        self.sentence1(lbl)
        self.ask(f"{lbl}.s2_elaborate",
                 choice(f"{SEER}\n\nWhat does sentence 2 of review item {lbl} (`items.{lbl}.sentences[1]`) do, "
                        f"read against sentence 1 (`items.{lbl}.sentences[0]`)?" + quoted(s, 1, 2), S2_OPTIONS),
                 "s2_elaborate", lbl,
                 lambda a: f"sentence 2 {S2_FIX.get(self.worst(a, 'detail'), 'is not Elaborate')}; it must add detail about the behavior in sentence 1 (Elaborate).",
                 "detail", lambda a: 1.0 - a["probabilities"].get("detail", 0.0))
        self.example(lbl, s, 3)
        m = next((re.search(p, s[3], re.I) for p in self.host.PRESCRIPTIVE if re.search(p, s[3], re.I)), None)
        if m:
            self.fix(lbl, f"sentence 4 is an instruction (\"{m.group(0)}\"); it must restate sentence 1.")
        else:
            self.ask(f"{lbl}.s4_restate",
                     noul(f"{SEER}\n\nDoes sentence 4 of review item {lbl} (`items.{lbl}.sentences[3]`) restate sentence 1 "
                          f"(`items.{lbl}.sentences[0]`): the same claim in a new way, with no new theme and no instruction?"
                          + quoted(s, 1, 4),
                          "Yes: the same point about him again in other words, even when it is looser or broader "
                          "than sentence 1 (\"He's an example we ought to put on training videos\" restates \"Bob is "
                          "my best customer service rep\")",
                          "No: a new theme, a different claim (such as what the behavior shows, causes or risks), or "
                          "an instruction"),
                     "s4_restate", lbl,
                     lambda a: "sentence 4 does not restate sentence 1; it must say the same thing again with no new theme.",
                     1.0, lambda p: 1.0 - p)

    def sum_ex(self, lbl, s):
        self.sentence1(lbl)
        self.example(lbl, s, 2)

    def ramification(self):
        weak = [lbl for lbl, kind, _ in self.items if kind == "Weakness"]
        if not self.core or result_is_no_change(self.core):
            return
        self.ask("core.ramification",
                 noul(f"{RAMIFICATION}\n\nDoes the Ramification in the Core Message (`core_message`) list the direct's "
                      f"Weaknesses ({', '.join(f'`items.{w}`' for w in weak) or 'none on the page'}) or the work and "
                      "accounts he already does?",
                      "Yes: it lists his Weaknesses or his current work",
                      "No: it names work or a role that is new to him"),
                 "ramification", "Core Message",
                 lambda a: "the Ramification lists his Weaknesses or his current work; it must name what changes for him next year.",
                 0.0, lambda p: p)

    def weakness_guidance(self):
        weak = [lbl for lbl, kind, _ in self.items if kind == "Weakness"]
        if weak and not self.guidance:
            for w in weak:
                self.fix(w, "has no Guidance point; every Weakness has at least one.")
            return
        options = {f"guidance_{i}": " ".join(s) for i, (_, s) in enumerate(self.guidance, 1)}
        options["none"] = "No Guidance point addresses this Weakness"
        for w in weak:
            self.ask(f"{w}.weakness_guidance",
                     choice(f"Every Weakness has at least one Guidance point. Which Guidance point (`guidance`) answers "
                            f"Weakness {w} (`items.{w}.sentences`): a behavior or piece of work next year that addresses it?",
                            options),
                     "weakness_guidance", w,
                     lambda a: "has no Guidance point; every Weakness has at least one.",
                     "guidance_1", lambda a: a["probabilities"].get("none", 0.0))

    def guidance_sentences(self):
        names = {self.direct.lower()} if self.direct else set()
        for lbl, sents in self.guidance:
            for n, sent in enumerate(sents, 1):
                first = re.sub(r"['’]s$|['’](?:ll|d|re|ve)$", "", (sent.split() or [""])[0].strip(",.:;\"“")).lower()
                if first in OPENERS or first in names:
                    self.fix(lbl, f"sentence {n} opens on \"{sent.split()[0]}\"; it must be an instruction to "
                                  f"{self.direct or 'the direct'} for next year.")
                elif PROMISES.match(sent):
                    self.fix(lbl, f"sentence {n} is a promise from the reviewer (\"{PROMISES.match(sent).group(0)}\"); "
                                  f"it must be an instruction to {self.direct or 'the direct'} for next year.")
                else:
                    self.ask(f"{lbl}.s{n}.instruction",
                             noul(f"{GUIDANCE}\n\nRead sentence {n} of {lbl} (`guidance['{lbl}'][{n - 1}]`) on its own, "
                                  "apart from the sentences around it. Is it an instruction: does it tell the direct what "
                                  f"to do next year?\n\nThe sentence: \"{sent}\"",
                                  "Yes: an instruction that tells the direct what to do next year, usually opening on an "
                                  "action verb",
                                  "No: a statement about him or his situation in the third person, including what stays "
                                  "open or available to him (it may open on a noun, as in \"Weekend coverage remains open "
                                  "to him\"), a comment on how things are now, a note on how the point will be measured, "
                                  "or something the reviewer will do"),
                             "guidance_instruction", lbl,
                             lambda a, n=n: f"sentence {n} is not an instruction for next year; it must tell "
                                            f"{self.direct or 'the direct'} what to do.",
                             1.0, lambda p: 1.0 - p, n=n)

    def judge_accounts(self, answers):
        by_item = {}
        for qid, (check, label, _, _, _, fmt) in self.consumers.items():
            if check == "named_accounts":
                by_item.setdefault((label, fmt["n"]), []).append((fmt["name"], answers[qid]))
        row = CHECKS["named_accounts"]
        for (lbl, n), scored in by_item.items():
            sure = [name for name, p in scored if p >= row["high"]]
            maybe = [name for name, p in scored if row["low"] <= p < row["high"]]
            if len(sure) >= 3:
                self.fix(lbl, f"sentence {n} names {len(sure)} accounts ({', '.join(sure)}); it must be one example, "
                              "not a list of accounts.", jev_tag=True)
            elif len(sure) + len(maybe) >= 3:
                p = sorted((p for _, p in scored), reverse=True)[2]
                self.to_read(lbl, "named_accounts", p, n=n, names=", ".join(sure + maybe))

    @staticmethod
    def worst(answer, passing):
        probs = {k: v for k, v in answer["probabilities"].items() if k != passing}
        return max(probs, key=probs.get) if probs else None

    def labels(self):
        return [lbl for lbl, _, _ in self.items] + (["Core Message"] if self.core else []) + [l for l, _ in self.guidance]

    def pass_answers(self):
        return {qid: c[3] for qid, c in self.consumers.items()}


def cli(host, argv, command="meaning"):
    """The `meaning` command. `host` is the calling script's module: its load, sentences, date
    patterns and PRESCRIPTIVE list are the ones Gate 1 uses, so both gates read the page alike."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(prog=command)
    ap.add_argument("docx")
    ap.add_argument("--direct", default="")
    ap.add_argument("--start")
    ap.add_argument("--end")
    ap.add_argument("--questions", action="store_true",
                    help="print each Jev question id with the answer that passes it, and ask nothing")
    ap.add_argument("--answers", action="store_true",
                    help="also print each Jev answer, for the eval and for a live run's record")
    a = ap.parse_args(argv)
    run = Run(host, a.docx, a.direct.strip())
    run.build()
    if a.questions:
        print(json.dumps(run.pass_answers(), indent=2))
        return 0

    jev_status = "not needed"
    code = None
    if run.questions:
        answers = jev.ask(run.state(), run.questions, timeout=JEV_TIMEOUT)
        if answers is None:
            jev_status = "unavailable"
            code = 2
        else:
            jev_status = f"ran ({len(run.questions)} questions)"
            run.judge(answers)
            if a.answers:
                print(json.dumps(answers, indent=1, sort_keys=True))

    order = {lbl: i for i, lbl in enumerate(run.labels())}
    fixes = [t for _, t in sorted(run.fixes, key=lambda x: order.get(x[0], 99))]
    reads = [t for _, t in sorted(run.read, key=lambda x: order.get(x[0], 99))]
    if code is None:
        code = 1 if fixes else 0

    if code == 2:
        print("MEANING CHECK: COULD NOT CHECK (Jev gave no answer: no key, 401, 402, timeout, or "
              "TYPESAFE_JEV_STUB=off). This is not a pass: read every meaning check instead.")
    else:
        print("MEANING CHECK:", "PASS" if not fixes else f"FAIL ({len(fixes)} fix{'es' if len(fixes) != 1 else ''})")
    for f in fixes:
        print("  -", f)
    if reads and code != 2:
        print("Read (Jev was unsure, or code cannot decide; a reader settles these):")
        for r in reads:
            print("  -", r)
    if code != 2:
        passed = [l for l in run.labels() if l not in run.flagged]
        print("Passed:", ", ".join(passed) if passed else "none")
    print("Reader checks (no code can see these): repeat flagged, against the prior review; "
          "no framing past the record, against the reviewer's own record.")
    for n in run.notes:
        print("Note:", n)
    print("Jev:", jev_status)
    write_record(a.docx, "meaning", host.__file__, code, fixes, {"jev": jev_status.split(" ")[0], "read": reads})
    print("Record:", record_path(a.docx))
    return code
