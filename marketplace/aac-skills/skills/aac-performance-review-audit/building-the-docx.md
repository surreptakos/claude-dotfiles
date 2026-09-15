# Building the Outlook docx (Gate 1 and Gate 2)

Write a body file, then build:

```python
# body.py
body = [
P("Hey Mark,"),
P("This is a much better draft. [what passed]. However, there are five format fixes needed before I review the content:"),
L(0, "Header: dates covered end 6/30/26; must end 7/23/2026.", "99"),
L(0, "S5: no date, figure, or named account or person; must contain one.", "99"),
P("See the standards below:"),
LB("Strengths and Weaknesses.", " Each is two sentences (Sum-Ex) or four sentences (SEER). ..."),
L(1, "sub-point under a standard, if any"),
L(2, "sub-sub-point"),
LB("Review period.", " Dates covered are 12 months. ... For this review: 7/24/2025 through 7/23/2026."),
P("Please resubmit once the review meets the above."),
P("Thanks,"),
]
```

`P` is a plain paragraph. `L(level, text, "99")` is a numbered item; pass `"99"` on every fix-list item so that list restarts at 1 separately from the standards list. `LB(bold_lead, rest)` is a top-level standard with a bold lead phrase and 12pt space before. Then:

```
python3 review_gate_tools.py build body.py "Erich Rojek 2026 - Audit of Rev 2 (paste into Outlook).docx"
```

Render to PDF (`soffice --headless --convert-to pdf`) and look at it before delivering. Dan opens the docx in Word, selects all, copies, pastes into Outlook. Never build a docx from scratch; HTML and Outlook connector drafts lose the list formatting. `python3 review_gate_tools.py template` writes the embedded template to disk if Dan needs the file itself. If the script reports "embedded template corrupt," pass `--template` with "Format Rejection Template.docx" from the project folder.
