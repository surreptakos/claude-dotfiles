#!/usr/bin/env python3
"""AAC review gate tools. One file, no project folder needed.

  python3 review_gate_tools.py check REVIEW.docx --end 7/23/2026 [--start 7/24/2025] [--direct Erich] [--no-render]
      Gate 1 mechanical format check. Prints fix lines for the Gate 1 email and what passed.
  python3 review_gate_tools.py build BODY.py OUT.docx [--template PATH.docx]
      Build a Gate 1 or Gate 2 email docx from Dan's canonical Format Rejection Template (embedded
      below as base64; --template overrides). BODY.py sets `body = [...]` using
      P("paragraph"), L(level, "text", "99" for the fix list), LB("Bold lead.", " rest").
  python3 review_gate_tools.py template [OUT.docx]
      Write the embedded template to disk.

Requires python-docx. Page count needs LibreOffice (soffice) and pdfinfo; otherwise pass --no-render.
Template (zlib then base64) md5 e323c80215f14bc222717f2457b10b1a (Dan's canonical formatting, saved 9/9/26).
"""
import re, sys, argparse, subprocess, tempfile, os, datetime, shutil
from docx import Document

RATINGS = ["exceeded expectations", "met expectations", "not met expectations", "did not meet expectations"]
RESULTS = ["promotion", "vertical growth", "horizontal growth", "no change", "current role and responsibilities"]
PRESCRIPTIVE = [r"\bneeds? to\b", r"\bshould\b", r"\bmust\b",
                r"\bwould benefit from\b", r"\bought to\b", r"\bis expected to\b", r"\bshall\b"]
ABBR = ["Mr", "Ms", "Mrs", "Dr", "Inc", "Corp", "Co", "Mfg", "St", "Ave", "Blvd", "Jr", "Sr", "vs", "etc", "No", "Dept",
        "a.m", "p.m", "U.S", "e.g", "i.e", "Q1", "Q2", "Q3", "Q4"]
MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"
DATE_NUM = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b")
DATE_TXT = re.compile(r"\b(%s)\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})\b" % MONTHS)
STOP = set("""I He She His Her Him It They Them Their The A An This That These Those In On At For To From With By As Of And But Or
Both Two Three Four Five Six Seven Eight Nine Ten Net New Last Next Q1 Q2 Q3 Q4 RMR GP GPM CCTV AAC CRM Guidance Point Strength
Weakness Core Message Erich""".split())


def sentences(text):
    t = text.strip()
    for a in ABBR:
        t = re.sub(r"\b%s\." % re.escape(a), a.replace(".", "<dot>") + "<dot>", t)
    t = re.sub(r"(\d)\.(\d)", r"\1<dot>\2", t)            # decimals
    t = re.sub(r"\$(\d[\d,]*)\.(\d\d)", r"$\1<dot>\2", t)  # cents
    parts = re.split(r"(?<=[.!?])[\"”’)]?\s+(?=[\"“(]?[A-Z0-9$])", t)
    return [p.replace("<dot>", ".") for p in parts if p.strip()]


def parse_date(s):
    m = DATE_NUM.fullmatch(s.strip())
    if m:
        mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100: y += 2000
        return datetime.date(y, mo, d)
    m = DATE_TXT.fullmatch(s.strip())
    if m:
        mo = [x for x in MONTHS.split("|")].index(m.group(1)) % 12 + 1
        return datetime.date(int(m.group(3)), mo, int(m.group(2)))
    raise ValueError("bad date " + s)


def all_dates(text):
    out = []
    for m in DATE_NUM.finditer(text):
        try: out.append((parse_date(m.group(0)), m.group(0)))
        except ValueError: pass
    for m in DATE_TXT.finditer(text):
        try: out.append((parse_date(m.group(0)), m.group(0)))
        except ValueError: pass
    return out


RANGE_SEP = re.compile(r"^\s*(?:through|thru|to|until|[\u2013\u2014-])\s*$", re.I)


def short_ranges(text, pstart, pend):
    """Date ranges that open on the period start and close before the period end:
    a period figure cut short. A status with its as-of date is not a range and is
    not reached; an event span inside the period does not start on the period
    start and is not reached either."""
    ds = []
    for rx in (DATE_NUM, DATE_TXT):
        for m in rx.finditer(text):
            try:
                ds.append((m.start(), m.end(), parse_date(m.group(0)), m.group(0)))
            except ValueError:
                pass
    ds.sort()
    out = []
    for (s1, e1, d1, t1), (s2, e2, d2, t2) in zip(ds, ds[1:]):
        if RANGE_SEP.match(text[e1:s2]) and d1 == pstart and d2 < pend:
            out.append((t1, t2))
    return out


def has_anchor(text, direct):
    if DATE_NUM.search(text) or DATE_TXT.search(text): return True
    if re.search(r"\$\d", text) or re.search(r"\d+(\.\d+)?%", text): return True
    words = re.findall(r"\b[A-Z][A-Za-z&]+\b", text)
    for i, w in enumerate(words):
        if w in STOP or w == direct or w.rstrip("’'s") == direct: continue
        # sentence-initial words are ambiguous; require the word not to follow a period
        idx = text.find(w)
        before = text[:idx].rstrip()
        if before and before[-1] in ".!?": continue
        if idx == 0: continue
        return True
    return False


def load(path):
    d = Document(path)
    paras = [p.text.strip() for p in d.paragraphs]
    header = {}
    for p in paras:
        m = re.search(r"Dates covered by this review:\s*(.+?)\s*[-–—]\s*(\S+)", p)
        if m: header["start"], header["end"] = m.group(1).strip(), m.group(2).strip()
        m = re.search(r"Delivered by:\s*(.+?)\s+Date:\s*(.+)$", p)
        if m: header["delivered_by"], header["date"] = m.group(1).strip(), m.group(2).strip()
        m = re.search(r"Last Review Date:\s*(\S+)", p)
        if m: header["last_review"] = m.group(1)
    core = next((p[len("Core Message:"):].strip() for p in paras if p.startswith("Core Message:")), "")
    # guidance: after the "Guidance for the next year" line until a signature line
    gi = next((i for i, p in enumerate(paras) if p.lower().startswith("guidance for the next year")), None)
    guidance = []
    if gi is not None:
        for p in paras[gi + 1:]:
            if not p: continue
            if p.startswith("Direct Signature") or p.startswith("Reviewer Signature"): break
            guidance.append(p)
    strengths, weaknesses = [], []
    for t in d.tables:
        hdr = [c.text.strip().lower() for c in t.rows[0].cells]
        if not any("strength" in h for h in hdr): continue
        for r in t.rows[1:]:
            cells = r.cells
            for ci, bucket in ((0, strengths), (1, weaknesses)):
                if ci >= len(cells): continue
                for p in cells[ci].paragraphs:
                    if p.text.strip(): bucket.append(p.text.strip())
    return header, core, strengths, weaknesses, guidance, "\n".join(paras + strengths + weaknesses)


def page_count(path):
    if not shutil.which("soffice"): return None
    out = tempfile.mkdtemp()
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", out, path],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    pdf = [f for f in os.listdir(out) if f.endswith(".pdf")]
    if not pdf: return None
    info = subprocess.run(["pdfinfo", os.path.join(out, pdf[0])], capture_output=True, text=True).stdout
    m = re.search(r"Pages:\s+(\d+)", info)
    return int(m.group(1)) if m else None


def gate1_main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("docx"); ap.add_argument("--end", required=True); ap.add_argument("--start")
    ap.add_argument("--direct", default=""); ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args(argv)
    end = parse_date(a.end)
    header, core, S, W, G, alltext = load(a.docx)
    fixes, passes = [], []

    # 1 header period
    hs, he = header.get("start"), header.get("end")
    try:
        he_d = parse_date(he) if he else None
    except ValueError:
        he_d = None
    if he_d != end:
        fixes.append(f"Header: dates covered end {he or '[missing]'}; must end {end.strftime('%-m/%-d/%Y')}.")
    else:
        passes.append("Header end date")
    if a.start:
        st = parse_date(a.start)
        try:
            hs_d = parse_date(hs) if hs else None
        except ValueError:
            hs_d = None
        if hs_d != st:
            fixes.append(f"Header: dates covered start {hs or '[missing]'}; must start {st.strftime('%-m/%-d/%Y')}.")
        else:
            passes.append("Header start date")
    notes = []
    if not header.get("date") or "[" in header.get("date", "") or "<" in header.get("date", ""):
        notes.append("Header: Date field is a placeholder; it carries the delivery date when the review goes out.")

    # 2 core message
    cs = sentences(core)
    lc = core.lower()
    if len(cs) > 3:
        fixes.append(f"Core Message: {len(cs)} sentences; must be three or fewer.")
    r_hits = [r for r in RATINGS if r in lc]
    if "not met expectations" in lc or "did not meet expectations" in lc:
        r_hits = [r for r in r_hits if r != "met expectations"]
    if len(r_hits) != 1:
        fixes.append("Core Message: Rating phrase missing or doubled; must contain exactly one of exceeded expectations, met expectations, not met expectations.")
    res_hits = [r for r in RESULTS if r in lc]
    if len(res_hits) == 0:
        fixes.append("Core Message: Result phrase missing; must name promotion, vertical growth, horizontal growth, or maintaining current role and responsibilities.")
    elif len(set(res_hits) - {"no change", "current role and responsibilities"}) > 1:
        fixes.append("Core Message: more than one Result named; must name one.")
    if not fixes or all(not f.startswith("Core Message") for f in fixes):
        passes.append("Core Message form")

    # 3 strengths and weaknesses
    for label, items in (("S", S), ("W", W)):
        for i, txt in enumerate(items, 1):
            name = f"{label}{i}"
            n = len(sentences(txt))
            if n not in (2, 4):
                fixes.append(f"{name}: {n} sentences; must be two (Sum-Ex) or four (SEER).")
            # 9/23/26: no date, figure or name is required here. Manager Tools asks for a
            # specific example, not an anchor; Gate 2 reads whether the example is specific.
            for pat in PRESCRIPTIVE:
                m = re.search(pat, txt, re.I)
                if m:
                    fixes.append(f"{name}: contains \"{m.group(0)}\"; not allowed in a Strength or Weakness (write the behavior; an instruction belongs in Guidance).")
                    break
    if not any(re.match(r"[SW]\d+:", f) for f in fixes):
        passes.append(f"Strengths and Weaknesses form ({len(S)} S, {len(W)} W)")

    # 4 second person anywhere
    yous = re.findall(r"\b[Yy]ou(r|rs|rself)?\b", alltext)
    if yous:
        fixes.append(f"Voice: \"you\" or \"your\" appears {len(yous)} time(s); the review is third person about the direct.")
    else:
        passes.append("Third person")
    # the reviewer is first person; "his manager" and the like refer to the reviewer in third person.
    # edge case: a direct who manages people may legitimately have someone else called "his manager."
    mgr = re.findall(r"\b(?:his|her|their|the) (?:manager|supervisor)\b", alltext, re.I)
    if mgr:
        fixes.append(f"Voice: \"{mgr[0]}\" refers to the reviewer in third person; the review is first person for the reviewer.")
    else:
        passes.append("First person for the reviewer")

    # 5 dates after the period end
    late = sorted({s for dt, s in all_dates(alltext) if dt > end and s != header.get("date")})
    if late:
        fixes.append(f"Dates: {', '.join(late)} fall after the period end {end.strftime('%-m/%-d/%Y')}; nothing in the review is dated after it.")
    else:
        passes.append("No dates after period end")

    # figure ranges cut short of the period
    pstart = parse_date(a.start) if a.start else end.replace(year=end.year - 1) + datetime.timedelta(days=1)
    items = [(f"S{i}", t) for i, t in enumerate(S, 1)] + [(f"W{i}", t) for i, t in enumerate(W, 1)] + [("Core Message", core)]
    short = [(lbl, r) for lbl, t in items for r in short_ranges(t, pstart, end)]
    for lbl, (t1, t2) in short:
        fixes.append(f"{lbl}: a figure runs {t1} through {t2}; a range that opens on the period start closes on {end.strftime('%-m/%-d/%Y')}.")
    if not short:
        passes.append("No figure range cut short")

    # 6 guidance
    if not G:
        fixes.append("Guidance: no Guidance points found under \"Guidance for the next year.\"")
    for i, g in enumerate(G, 1):
        # The 9/23/26 template lists Guidance as plain bullets; older drafts label
        # each "Guidance Point N:". Accept either, and check the verb that follows.
        m = re.match(r"Guidance Point (\d+):\s*(.*)$", g, re.S)
        body = m.group(2) if m else g
        label = f"Guidance {m.group(1) if m else i}"
        words = body.split()
        if not words:
            fixes.append(f"{label}: empty.")
            continue
        first = words[0].rstrip(",.:").lower()
        not_verbs = ("you", "your", "he", "she", "his", "her", "the", "a", "an", "it", "this", "guidance")
        if first in not_verbs or (a.direct and first == a.direct.lower()):
            fixes.append(f"{label}: starts with \"{words[0]}\"; must start with an action verb.")
        n = len(sentences(body))
        if n > 3:
            fixes.append(f"{label}: {n} sentences; must be one to three.")
    if not any(f.startswith("Guidance") for f in fixes):
        passes.append(f"Guidance form ({len(G)} points)")

    # 7 one page
    pc = None if a.no_render else page_count(a.docx)
    if pc is None:
        print("(page count not checked)", file=sys.stderr)
    elif pc > 1:
        fixes.append(f"Length: {pc} pages; the review is one page.")
    else:
        passes.append("One page")

    print("GATE 1:", "PASS" if not fixes else f"FAIL ({len(fixes)} fix{'es' if len(fixes) != 1 else ''})")
    for f in fixes: print("  -", f)
    print("Passed:", "; ".join(passes))
    for n in notes: print("Note:", n)
    return 0 if not fixes else 1


TEMPLATE_NAME = "Format Rejection Template.docx"
TEMPLATE_MD5 = "e323c80215f14bc222717f2457b10b1a"


def template_bytes():
    """Dan's canonical rejection docx, kept beside this script in the skill directory."""
    import hashlib
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), TEMPLATE_NAME)
    if not os.path.exists(path):
        raise SystemExit(f"{TEMPLATE_NAME} not found next to {os.path.basename(__file__)}. Pass --template with the file from the project folder.")
    raw = open(path, "rb").read()
    got = hashlib.md5(raw).hexdigest()
    if got != TEMPLATE_MD5:
        raise SystemExit(f"{TEMPLATE_NAME} md5 {got}, expected {TEMPLATE_MD5}. It has been edited; confirm before building from it.")
    return raw


def build_docx(body_path, out_path, template_path=None):
    """Clone Dan's canonical rejection docx and replace the body with the paragraphs defined in body_path
    (a Python file that sets `body = [...]` using P, L, LB)."""
    import zipfile, io, html
    if template_path and os.path.exists(template_path):
        z = zipfile.ZipFile(template_path)
    else:
        z = zipfile.ZipFile(io.BytesIO(template_bytes()))
    d = z.read("word/document.xml").decode()
    paras = re.findall(r'<w:p[ >].*?</w:p>', d, re.S)
    def proto(pred):
        for p in paras:
            if pred(p): return p
    plainP = proto(lambda p: 'numPr' not in p and 'Hey Nick' in p)
    boldL0 = proto(lambda p: '<w:ilvl w:val="0"/>' in p)
    lvl = [boldL0] + [proto(lambda p, l=l: f'<w:ilvl w:val="{l}"/>' in p) for l in (1, 2)]
    numxml = z.read("word/numbering.xml").decode()
    absid = re.search(r'<w:num w:numId="1"[^>]*>.*?w:abstractNumId w:val="(\d+)"', numxml, re.S).group(1)
    absnum = re.search(r'<w:abstractNum w:abstractNumId="%s".*?</w:abstractNum>' % absid, numxml, re.S).group(0)
    absnum2 = re.sub(r'w:abstractNumId="\d+"', 'w:abstractNumId="77"', absnum, 1)
    absnum2 = re.sub(r'<w:nsid w:val="[0-9A-F]+"/>', '<w:nsid w:val="7A7A7A77"/>', absnum2)
    numxml = numxml.replace(absnum, absnum + absnum2, 1).replace("</w:numbering>", '<w:num w:numId="99"><w:abstractNumId w:val="77"/></w:num></w:numbering>')
    def setruns(p, segments, numId=None, before=None):
        pPr = re.search(r'<w:pPr>.*?</w:pPr>', p, re.S).group(0)
        if numId: pPr = re.sub(r'<w:numId w:val="\d+"/>', f'<w:numId w:val="{numId}"/>', pPr)
        if before:
            pPr = re.sub(r'<w:spacing [^/]*/>', '', pPr)
            sp = f'<w:spacing w:before="{before}" w:after="0"/><w:contextualSpacing w:val="0"/>'
            pPr = pPr.replace('<w:rPr>', sp + '<w:rPr>', 1) if '<w:rPr>' in pPr else pPr.replace('</w:pPr>', sp + '</w:pPr>')
        rPr = re.search(r'<w:r>(<w:rPr>.*?</w:rPr>)', p, re.S)
        rPr = rPr.group(1) if rPr else '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>'
        nb = re.sub(r'<w:b/>|<w:bCs/>', '', rPr); b = nb.replace('<w:rPr>', '<w:rPr><w:b/><w:bCs/>')
        runs = "".join(f'<w:r>{b if bold else nb}<w:t xml:space="preserve">{html.escape(t, quote=False)}</w:t></w:r>' for t, bold in segments)
        return f'<w:p>{pPr}{runs}</w:p>'
    ns = {
        "P": lambda t: setruns(plainP, [(t, False)]),
        "L": lambda l, t, n=None: setruns(lvl[l], [(t, False)], n),
        "LB": lambda head, rest, before="240": setruns(boldL0, [(head, True), (rest, False)], None, before),
    }
    exec(open(body_path, encoding="utf-8").read(), ns)
    newdoc = re.sub(r'(<w:body>).*?(<w:sectPr)', lambda m: m.group(1) + "".join(ns["body"]) + m.group(2), d, flags=re.S)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zo:
        for it in z.infolist():
            data = z.read(it.filename)
            if it.filename == "word/document.xml": data = newdoc.encode()
            if it.filename == "word/numbering.xml": data = numxml.encode()
            zo.writestr(it, data)
    open(out_path, "wb").write(buf.getvalue()); print("built", out_path)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("check", "build", "template"):
        print(__doc__); return 2
    cmd, rest = sys.argv[1], sys.argv[2:]
    if cmd == "check": return gate1_main(rest)
    if cmd == "build":
        ap = argparse.ArgumentParser(); ap.add_argument("body"); ap.add_argument("out"); ap.add_argument("--template")
        a = ap.parse_args(rest); build_docx(a.body, a.out, a.template); return 0
    if cmd == "template":
        out = rest[0] if rest else "Format Rejection Template.docx"
        open(out, "wb").write(template_bytes()); print("wrote", out); return 0


if __name__ == "__main__":
    sys.exit(main())
