#!/usr/bin/env python3
"""
stopslop - the deterministic half of AAC-WR-001 Part XXV (Rules 153-166).

`profile/claude/hooks/stopslop-write.py` and `stopslop-stop.py` import this
module and call `scan(text, technical=False)`. Both were written against a
linter that never shipped (issue 620); this is that linter.

Scope, and why it is narrow
---------------------------
Only patterns a regex can decide. `aac-skills/aac-house-writing-standard/
scripts/wr001-lint.js` excludes all of Part XXV except Rule 165 for exactly
this reason, and the reference index says so. A judgment rule - Rule 154
(preserve the writer's voice), Rule 161 read across a whole document, Rule 166
(the release check) - stays out of the detector and belongs to a reader.

Every pattern here is transcribed from the controlled copy at
`aac-skills/aac-house-writing-standard/references/DRAFT-QUALITY.md`: Rules 153
to 166, Appendix G (phrase register) and Appendix H (structure register). The
register is a reference, not an exhaustive list, so a clean scan is not a
passing draft. Rule 166 decides that.

Severity
--------
ERROR   the controlled copy says "do not", "delete" or "cut", AND the pattern
        is a registered multi-word string that a regex decides without
        context. The hooks block on these.
WARN    the rule itself admits judgment - Rule 155 says outright that it is
        not a prohibition on adverbs - or the pattern is common enough in
        honest prose that blocking on it would be wrong. Reported, never
        blocking.

`technical=True` drops the checks marked `prose_only`: the adverb register,
false agency, the narrator voice, wh- openers and synonym cycling. A runbook
legitimately writes "the scheduler returns", "this happens because" and "when
the panel faults"; a memo does not.

Hit shape (the keys the two hooks read)
---------------------------------------
    line      1-based; 0 for a document-level finding
    col       1-based; 0 for a document-level finding
    id        register cell, e.g. "G1", "H8", "R165"
    rule      AAC-WR-001 rule number this cites (int)
    severity  "ERROR" or "WARN"
    match     the matched text
    message   what to do about it
    source    where in the controlled copy the pattern is registered

Pinned to AAC-WR-001 v0.5, the version TERMINOLOGY.md records for Part XXV.
"""
import re
import sys

STANDARD_VERSION = "0.5"

# ' and the curly apostrophe, since Claude writes both.
_APOS = "['’]?"
# Emoji planes, same ranges wr001-lint.js uses for Rule 165.
_EMOJI = "[\U0001F300-\U0001FAFF☀-➿]"


def _c(cell, rule, severity, pattern, message, source, prose_only=False):
    return {
        "id": cell,
        "rule": rule,
        "severity": severity,
        "re": re.compile(pattern, re.IGNORECASE),
        "message": message,
        "source": source,
        "prose_only": prose_only,
    }


CHECKS = [
    # ---------------------------------------------------------- Appendix G1
    # Throat-clearing openers. Rule 156: do not open with a claim of hidden
    # knowledge; state the point.
    _c("G1", 156, "ERROR",
       r"\bHere" + _APOS + r"s\s+(?:the thing|what|this|that|why)\b",
       "throat-clearing opener; cut it and state the point",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bHere is\s+(?:the thing|what|why)\b",
       "throat-clearing opener; cut it and state the point",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bThe uncomfortable truth is\b",
       "throat-clearing opener; state the claim",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bIt turns out\b",
       "throat-clearing opener; state the finding",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bThe real (?:problem|issue|question|reason|answer|story|point|risk|cost|work)\b",
       "throat-clearing opener; name the thing without the 'real' framing",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bLet me be clear\b",
       "throat-clearing opener; be clear instead of announcing it",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bThe truth is,",
       "throat-clearing opener; state the claim",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bI" + _APOS + r"(?:ll| will) say it again\b",
       "throat-clearing opener; say it once",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bI" + _APOS + r"?m going to be honest\b|\bI am going to be honest\b",
       "throat-clearing opener; write the honest sentence",
       "Appendix G1"),
    _c("G1", 156, "ERROR",
       r"\bCan we talk about\b",
       "throat-clearing opener; talk about it",
       "Appendix G1"),

    # ---------------------------------------------------------- Appendix G2
    # Emphasis crutches. Rule 163: do not narrate the writing.
    _c("G2", 163, "ERROR",
       r"\bFull stop\.",
       "emphasis crutch; the sentence already ended",
       "Appendix G2"),
    _c("G2", 163, "ERROR",
       r"[.!?]\s+Period\.",
       "emphasis crutch; the sentence already ended",
       "Appendix G2"),
    _c("G2", 163, "ERROR",
       r"\bLet that sink in\b",
       "emphasis crutch; delete it",
       "Appendix G2"),
    _c("G2", 163, "ERROR",
       r"\bThis matters because\b",
       "emphasis crutch; give the reason without the preamble",
       "Appendix G2"),
    _c("G2", 163, "ERROR",
       r"\bMake no mistake\b",
       "emphasis crutch; delete it",
       "Appendix G2"),

    # ---------------------------------------------------------- Appendix G3
    # Business jargon. Rule 9 requires plain language; the register gives the
    # replacement for each.
    _c("G3", 9, "WARN",
       r"\bnavigat(?:e|es|ed|ing)\s+(?:the\s+|these\s+|those\s+|our\s+)?(?:challenges?|complexit\w+|landscape)\b",
       "business jargon; use 'handle' or 'address'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bunpack(?:s|ed|ing)?\s+(?:the|this|that|these)\b",
       "business jargon; use 'explain' or 'examine'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\blean(?:s|ed|ing)?\s+into\b",
       "business jargon; use 'accept' or 'commit to'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\b(?:the|this|that|current|evolving|changing)\s+landscape\b",
       "business jargon; use 'situation' or 'field'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bgame[- ]changer\b|\bgame[- ]changing\b",
       "business jargon; use 'significant' or 'important'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bdouble(?:s|d)?\s+down\b",
       "business jargon; use 'commit' or 'increase'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bdeep[- ]dive\b|\bdeep dive\b",
       "business jargon; use 'analysis' or 'examination'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\btake a step back\b",
       "business jargon; use 'reconsider'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bmoving forward\b",
       "business jargon; use 'next' or 'from now'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bcircle back\b",
       "business jargon; use 'return to' or 'revisit'",
       "Appendix G3"),
    _c("G3", 9, "WARN",
       r"\bon the same page\b",
       "business jargon; use 'aligned' or 'agreed'",
       "Appendix G3"),

    # ---------------------------------------------------------- Appendix G4
    # Faux-insight setups. Rule 156.
    _c("G4", 156, "ERROR",
       r"\bWhat nobody tells you\b",
       "faux-insight setup; cut the setup and state the content",
       "Rule 156, Appendix G4"),
    _c("G4", 156, "ERROR",
       r"\bWhat they don" + _APOS + r"t tell you\b",
       "faux-insight setup; cut the setup and state the content",
       "Rule 156, Appendix G4"),
    _c("G4", 156, "ERROR",
       r"\bThe part everyone misses\b|\bwhat most people miss\b",
       "faux-insight setup; cut the setup and state the content",
       "Rule 156, Appendix G4"),
    _c("G4", 156, "ERROR",
       r"\bThe missing piece is\b",
       "faux-insight setup; name the piece",
       "Appendix G4"),
    _c("G4", 156, "ERROR",
       r"\bNobody talks about\b",
       "faux-insight setup; talk about it",
       "Appendix G4"),

    # ---------------------------------------------------------- Appendix G5
    # Importance puffery. Rule 158: give the fact and let the reader judge.
    _c("G5", 158, "ERROR",
       r"\bmarks a pivotal moment\b",
       "importance puffery; state the change",
       "Rule 158, Appendix G5"),
    _c("G5", 158, "ERROR",
       r"\bstands as a testament\b",
       "importance puffery; state the change",
       "Rule 158, Appendix G5"),
    _c("G5", 158, "ERROR",
       r"\bunderscores the importance\b",
       "importance puffery; state the change",
       "Appendix G5"),
    _c("G5", 158, "ERROR",
       r"\ba shining example of\b",
       "importance puffery; state the change",
       "Appendix G5"),
    _c("G5", 158, "ERROR",
       r"\bspeaks volumes\b",
       "importance puffery; state the change",
       "Appendix G5"),
    _c("G5", 158, "ERROR",
       r"\ba powerful reminder\b",
       "importance puffery; state the change",
       "Appendix G5"),
    _c("G5", 158, "ERROR",
       r"\brepresents a significant (?:milestone|step|advance|shift)\b",
       "importance puffery; state the change",
       "Rule 158, Appendix G5"),

    # ---------------------------------------------------------- Appendix G6
    # Weasel attribution. Rule 160: name the source or cut the claim.
    _c("G6", 160, "ERROR",
       r"\bexperts agree\b",
       "weasel attribution; name the source or cut the claim",
       "Rule 160, Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bstudies show\b",
       "weasel attribution; name the study or cut the claim",
       "Rule 160, Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bresearch suggests\b",
       "weasel attribution; name the research or cut the claim",
       "Rule 160, Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bscientists say\b",
       "weasel attribution; name the source or cut the claim",
       "Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bobservers note\b",
       "weasel attribution; name the observer or cut the claim",
       "Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bindustry leaders believe\b",
       "weasel attribution; name them or cut the claim",
       "Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bdata indicates\b",
       "weasel attribution; name the data set or cut the claim",
       "Appendix G6"),
    _c("G6", 160, "ERROR",
       r"\bit is widely understood\b|\bit" + _APOS + r"s widely understood\b",
       "weasel attribution; name the source or cut the claim",
       "Rule 160"),

    # ---------------------------------------------------------- Appendix G7
    # Interpretive metadiscourse. Rule 163: delete the wrapper, keep the
    # sentence.
    _c("G7", 163, "ERROR",
       r"\bthe key point is\b",
       "interpretive metadiscourse; if it is the key point, state it first",
       "Rule 163, Appendix G7"),
    _c("G7", 163, "ERROR",
       r"\bthis distinction matters\b|\bthis is a crucial distinction\b",
       "interpretive metadiscourse; delete the wrapper",
       "Rule 163, Appendix G7"),
    _c("G7", 163, "ERROR",
       r"\bwhat this means is\b",
       "interpretive metadiscourse; delete the wrapper",
       "Rule 163, Appendix G7"),
    _c("G7", 163, "ERROR",
       r"\bthe takeaway is\b",
       "interpretive metadiscourse; delete the wrapper",
       "Appendix G7"),
    _c("G7", 163, "ERROR",
       r"\bit" + _APOS + r"s important to understand\b|\bit is important to understand\b",
       "interpretive metadiscourse; delete the wrapper",
       "Appendix G7"),
    _c("G7", 163, "ERROR",
       r"\bit is worth noting\b|\bit" + _APOS + r"s worth noting\b",
       "interpretive metadiscourse; delete the wrapper",
       "Rule 163, Appendix G8"),

    # ---------------------------------------------------------- Appendix G8
    # Empty adverbs. Rule 155 says in as many words that this is not a
    # prohibition on adverbs, so these warn and never block.
    _c("G8", 155, "WARN",
       r"\b(?:really|just|literally|genuinely|honestly|simply|actually|deeply"
       r"|truly|fundamentally|inherently|inevitably|interestingly|importantly"
       r"|crucially)\b",
       "empty adverb; delete unless it carries emphasis, uncertainty or rhythm",
       "Rule 155, Appendix G8", prose_only=True),
    # Filler phrases, registered under G8 but with no judgment left in them.
    # Rule 10 is the parent: delete phrases that add no information.
    _c("G8", 10, "ERROR",
       r"\bAt its core\b",
       "filler; cut it",
       "Rule 10, Appendix G8"),
    _c("G8", 10, "ERROR",
       r"\bIn today" + _APOS + r"s\b",
       "filler; cut it",
       "Rule 10, Appendix G8"),
    _c("G8", 10, "ERROR",
       r"\bAt the end of the day\b",
       "filler; cut it",
       "Rule 10, Appendix G8"),
    _c("G8", 10, "ERROR",
       r"\bWhen it comes to\b",
       "filler; name the subject directly",
       "Rule 10, Appendix G8"),
    _c("G8", 10, "ERROR",
       r"\bIn a world where\b",
       "filler; cut it",
       "Rule 10, Appendix G8"),
    _c("G8", 10, "ERROR",
       r"\bThe reality is\b",
       "filler; state the fact",
       "Rule 10, Appendix G8"),

    # ---------------------------------------------------------- Appendix G9
    # Meta-commentary. Rule 163: do not narrate the writing.
    _c("G9", 163, "ERROR",
       r"(?:^|\s)Hint:",
       "meta-commentary; delete the aside",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bPlot twist:|\bSpoiler:",
       "meta-commentary; delete the aside",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bYou already know this, but\b",
       "meta-commentary; delete the aside",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bBut that" + _APOS + r"s another (?:post|story)\b",
       "meta-commentary; delete the aside",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bis a feature, not a bug\b",
       "meta-commentary; state what it does",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bdressed up as\b",
       "meta-commentary; name the thing",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bThe rest of this (?:essay|section|document|post)\b",
       "meta-commentary; the document should move, not announce its structure",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bLet me walk you through\b",
       "meta-commentary; walk through it",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bIn this section, we" + _APOS + r"(?:ll| will)\b",
       "meta-commentary; delete the preview",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bAs we" + _APOS + r"(?:ll| will) see\b",
       "meta-commentary; delete the preview",
       "Appendix G9"),
    _c("G9", 163, "ERROR",
       r"\bI want to explore\b",
       "meta-commentary; explore it",
       "Appendix G9"),

    # --------------------------------------------------------- Appendix G10
    # Performative emphasis. Context decides whether a promise is real, so
    # these warn.
    _c("G10", 162, "WARN",
       r"\bcreeps in\b",
       "performative emphasis; name the actor and the change",
       "Appendix G10", prose_only=True),
    _c("G10", 162, "WARN",
       r",\s*I promise\b|\bI promise\.",
       "performative emphasis; delete the reassurance",
       "Appendix G10", prose_only=True),

    # --------------------------------------------------------- Appendix G11
    # Vague declaratives. Rule 158: name the specific thing instead.
    _c("G11", 158, "ERROR",
       r"\bThe reasons are structural\b",
       "vague declarative; name the specific reason",
       "Appendix G11"),
    _c("G11", 158, "ERROR",
       r"\bThe implications are significant\b",
       "vague declarative; name the implication",
       "Appendix G11"),
    _c("G11", 158, "ERROR",
       r"\bThis is the deepest problem\b",
       "vague declarative; name the problem",
       "Appendix G11"),
    _c("G11", 158, "ERROR",
       r"\bThe stakes are high\b",
       "vague declarative; name what is at stake",
       "Appendix G11"),
    _c("G11", 158, "ERROR",
       r"\bThe consequences are real\b",
       "vague declarative; name the consequence",
       "Appendix G11"),

    # ---------------------------------------------------------- Appendix H1
    # Binary contrasts. Rule 164: state Y directly, drop the negation.
    _c("H1", 164, "ERROR",
       r"\bNot because\b[^.]{1,80}\.\s*Because\b",
       "binary contrast; state the reason directly",
       "Rule 164, Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\bnot because\b[^.]{1,80},\s*but because\b",
       "binary contrast; state the reason directly",
       "Rule 164, Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\bisn" + _APOS + r"t the problem\b|\bis not the problem\b",
       "binary contrast; name the problem directly",
       "Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\bThe (?:answer|question|problem|point|issue) (?:isn" + _APOS
       + r"t|is not)\b",
       "binary contrast; state the answer directly",
       "Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\b(?:not|isn" + _APOS + r"t|aren" + _APOS + r"t|wasn" + _APOS
       + r"t)\b[^.;]{1,50},\s*(?:it|they|that|this)" + _APOS + r"s\b",
       "binary contrast; drop the negation and state the point",
       "Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\b(?:It|That|This)" + _APOS + r"s not\b[^.]{1,60}\.\s*"
       r"(?:It|That|This)" + _APOS + r"s\b",
       "binary contrast; drop the negation and state the point",
       "Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\bstops being\b[^.]{1,60}\band starts being\b",
       "false transformation arc; name what changed",
       "Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\bdoesn" + _APOS + r"t mean\b[^.]{1,80}\bbut actually\b",
       "negation-then-assertion crutch; assert it once",
       "Appendix H1"),
    _c("H1", 164, "ERROR",
       r"\bnot just\b[^.]{1,60}\bbut also\b",
       "additive hedge; name both without the hedge",
       "Appendix H1"),

    # ---------------------------------------------------------- Appendix H2
    # Negative listing. Rule 164.
    _c("H2", 164, "ERROR",
       r"\b(?:It|That|This) wasn" + _APOS + r"t\b[^.]{1,60}\.\s*"
       r"(?:It|That|This) wasn" + _APOS + r"t\b",
       "negative listing; state what it was",
       "Appendix H2"),
    _c("H2", 164, "ERROR",
       r"(?:^|[.!?]\s)Not an?\s\w[^.]{0,40}\.\s*Not an?\s",
       "negative listing; state what it is",
       "Appendix H2"),

    # ---------------------------------------------------------- Appendix H3
    # Dramatic fragmentation. Only the registered performative-simplicity
    # pattern is mechanical; staccato drama is a judgment call.
    _c("H3", 164, "ERROR",
       r"\bThat" + _APOS + r"s it\.\s*That" + _APOS + r"s the\b",
       "dramatic fragmentation; use a complete sentence",
       "Appendix H3"),

    # ---------------------------------------------------------- Appendix H4
    # Rhetorical setups. Rule 164.
    _c("H4", 164, "ERROR",
       r"\bHere" + _APOS + r"s what I mean\b",
       "rhetorical setup; make the point",
       "Appendix H4"),
    _c("H4", 164, "ERROR",
       r"\bThink about it[:.]",
       "rhetorical setup; make the point",
       "Appendix H4"),
    _c("H4", 164, "ERROR",
       r"\bAnd that" + _APOS + r"s okay\b",
       "rhetorical setup; the reader does not need permission",
       "Appendix H4"),
    _c("H4", 164, "WARN",
       r"(?:^|[.!?]\s)What if\b",
       "rhetorical setup; make the point instead of posing it",
       "Appendix H4", prose_only=True),

    # ---------------------------------------------------------- Appendix H5
    # False agency. Rule 6 wants a named actor; a runbook legitimately gives
    # a system a verb, so these warn and drop out under technical=True.
    _c("H5", 6, "WARN",
       r"\bthe data tells us\b",
       "false agency; say who read the data and what they concluded",
       "Rule 6, Appendix H5", prose_only=True),
    _c("H5", 6, "WARN",
       r"\bthe market rewards\b",
       "false agency; name the buyer",
       "Appendix H5", prose_only=True),
    _c("H5", 6, "WARN",
       r"\bthe culture shifts\b",
       "false agency; name whose behavior changed",
       "Appendix H5", prose_only=True),
    _c("H5", 6, "WARN",
       r"\bthe conversation move[sd]?\s+toward\b",
       "false agency; name who steered it",
       "Appendix H5", prose_only=True),
    _c("H5", 6, "WARN",
       r"\bthe decision emerge[sd]?\b",
       "false agency; name who decided",
       "Appendix H5", prose_only=True),
    _c("H5", 6, "WARN",
       r"\ba complaint becomes a fix\b",
       "false agency; name who fixed it",
       "Appendix H5", prose_only=True),

    # ---------------------------------------------------------- Appendix H6
    # Narrator-from-a-distance. Ordinary in technical prose.
    _c("H6", 164, "WARN",
       r"\bNobody designed this\b",
       "narrator-from-a-distance; put the reader in the room",
       "Appendix H6", prose_only=True),
    _c("H6", 164, "WARN",
       r"(?:^|[.!?]\s)This happens because\b",
       "narrator-from-a-distance; put the reader in the room",
       "Appendix H6", prose_only=True),
    _c("H6", 164, "WARN",
       r"(?:^|[.!?]\s)This is why\b",
       "narrator-from-a-distance; put the reader in the room",
       "Appendix H6", prose_only=True),
    _c("H6", 164, "WARN",
       r"\bPeople tend to\b",
       "narrator-from-a-distance; name who does it",
       "Appendix H6", prose_only=True),

    # ---------------------------------------------------------- Appendix H7
    # Sentence starters. "Look," is registered as a straight removal; the
    # wh- opener and the "So" paragraph are crutches, not errors.
    _c("H7", 164, "ERROR",
       r"(?:^|[.!?]\s)Look,",
       "sentence starter 'Look,'; remove it",
       "Appendix H7"),
    _c("H7", 164, "WARN",
       r"(?:^|[.!?]\s)(?:What|When|Where|Which|Who|Why|How)\b",
       "wh- opener; lead with the subject or the verb",
       "Appendix H7", prose_only=True),
    _c("H7", 164, "WARN",
       r"^So[,\s]",
       "paragraph opening on 'So'; start with content",
       "Appendix H7", prose_only=True),

    # ---------------------------------------------------------- Appendix H8
    # Colon-reveal drama. Rule 157: a colon introduces a list, explanation or
    # quotation; it does not license suspense.
    _c("H8", 157, "ERROR",
       r"\bThe (?:best part|kicker|result|truth|irony|twist|upshot|catch):",
       "colon-reveal drama; write one sentence",
       "Rule 157, Appendix H8"),

    # ---------------------------------------------------------- Appendix H9
    # Superficial -ing analysis. Rule 159: end on the act.
    _c("H9", 159, "ERROR",
       r",\s*(?:highlighting|underscoring|demonstrating|showcasing|signalling"
       r"|signaling|cementing|solidifying|emphasizing|illustrating|reflecting"
       r"\s+a\s+broader)\b",
       "superficial -ing analysis; end on the act, or make it a sentence with "
       "an actor",
       "Rule 159, Appendix H9"),
    _c("H9", 159, "ERROR",
       r"\bpaving the way for\b",
       "superficial -ing analysis; name the real consequence",
       "Appendix H9"),

    # --------------------------------------------------------- Appendix H11
    # Fake-profound kickers. Rule 162: end when the content ends.
    _c("H11", 162, "ERROR",
       r"\bAnd that changes everything\b",
       "fake-profound kicker; end on the last real point",
       "Rule 162, Appendix H11"),
    _c("H11", 162, "ERROR",
       r"\bThat" + _APOS + r"s the whole game\b",
       "fake-profound kicker; end on the last real point",
       "Appendix H11"),
    _c("H11", 162, "ERROR",
       r"\bNothing else matters\b",
       "fake-profound kicker; end on the last real point",
       "Appendix H11"),

    # ------------------------------------------------------------- Rule 165
    # Formatting slop. Same check wr001-lint.js already makes, kept here so
    # the hooks do not need node. Decorative bold and header spam are
    # judgment calls and stay out.
    _c("R165", 165, "ERROR",
       r"^#{1,6}\s.*" + _EMOJI,
       "emoji in a heading",
       "Rule 165, Appendix H12"),
]

# Appendix H10, synonym cycling (Rule 161). Document-level: one actor renamed
# every sentence. Two or more members of a group present is the signal.
# prose_only - a runbook that names a scheduler, an orchestrator and a
# coordinator usually has three of them.
SYNONYM_GROUPS = [
    ("scheduler", "orchestrator", "coordinator"),
    ("app", "platform", "solution", "offering"),
    ("users", "individuals", "folks", "stakeholders"),
]


def _blank_uncheckable(lines):
    """Blank what Rule 2 and Rule 153 put out of reach, keeping line numbers
    and column offsets true: fenced code, block quotes, table rows, inline
    code spans, and link targets."""
    out = []
    fenced = False
    for line in lines:
        if re.match(r"\s*(```|~~~)", line):
            fenced = not fenced
            out.append("")
            continue
        if fenced or re.match(r"\s*>", line) or re.match(r"\s*\|", line):
            out.append("")
            continue
        # Inline code and link targets are not AAC prose. Replace with spaces
        # so every column to the right of them still reports truthfully.
        line = re.sub(r"`[^`]*`", lambda m: " " * len(m.group(0)), line)
        line = re.sub(r"\]\([^)]*\)", lambda m: " " * len(m.group(0)), line)
        line = re.sub(r"https?://\S+", lambda m: " " * len(m.group(0)), line)
        out.append(line)
    return out


def scan(text, technical=False):
    """Scan `text` for the mechanically decidable patterns of AAC-WR-001
    Part XXV. Returns a list of hit dicts (see the module docstring).

    technical=True drops the checks that honest technical prose trips: the
    adverb register, false agency, the narrator voice, wh- openers, synonym
    cycling.
    """
    if not text:
        return []

    lines = text.split("\n")
    body = _blank_uncheckable(lines)
    hits = []

    for index, line in enumerate(body):
        if not line.strip():
            continue
        for check in CHECKS:
            if technical and check["prose_only"]:
                continue
            for match in check["re"].finditer(line):
                if not match.group(0).strip():
                    continue
                hits.append({
                    "line": index + 1,
                    "col": match.start() + 1,
                    "id": check["id"],
                    "rule": check["rule"],
                    "severity": check["severity"],
                    "match": match.group(0).strip(),
                    "message": check["message"],
                    "source": check["source"],
                })

    if not technical:
        joined = "\n".join(body)
        for group in SYNONYM_GROUPS:
            present = [w for w in group
                       if re.search(r"\b" + w + r"\b", joined, re.IGNORECASE)]
            if len(present) > 1:
                hits.append({
                    "line": 0,
                    "col": 0,
                    "id": "H10",
                    "rule": 161,
                    "severity": "WARN",
                    "match": ", ".join(present),
                    "message": "synonym cycling; name one actor, system or "
                               "tool the same way throughout",
                    "source": "Rule 161, Appendix H10",
                })

    hits.sort(key=lambda h: (h["line"], h["col"], h["id"]))
    return hits


def _main(argv):
    technical = "--technical" in argv
    paths = [a for a in argv if not a.startswith("--")]
    if paths:
        text = "\n".join(open(p, encoding="utf-8").read() for p in paths)
    else:
        text = sys.stdin.read()
    hits = scan(text, technical=technical)
    for h in hits:
        sys.stdout.write(
            "L%d:%d  %s  [%s] Rule %s  \"%s\" -> %s (%s)\n"
            % (h["line"], h["col"], h["severity"], h["id"], h["rule"],
               h["match"], h["message"], h["source"]))
    errors = [h for h in hits if h["severity"] == "ERROR"]
    sys.stdout.write("%d ERROR, %d WARN  [AAC-WR-001 v%s Part XXV]\n"
                     % (len(errors), len(hits) - len(errors),
                        STANDARD_VERSION))
    return 1 if errors else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    sys.exit(_main(sys.argv[1:]))
