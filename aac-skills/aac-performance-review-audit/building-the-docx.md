# Building the Outlook docx (Gate 1 and Gate 2)

Write a body file, then build:

```python
# body.py
body = [
P("Hey Mark,"),
P("This is a much better draft. [what passed]. However, there are five format fixes needed before I review the content:"),
L(0, "Header: dates covered end 6/30/26; must end 7/23/2026.", "99"),
L(0, "S5: 3 sentences; must be two (Sum-Ex) or four (SEER).", "99"),
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
python3 review_gate_tools.py build body.py "Erich Rojek 2026 - Audit of Rev 2 (paste into Outlook).docx" --review REVIEW.docx
```

`--review` names the draft the email is about. The build refuses (exit 2, "NOT BUILT") when that file has no gate record, when the record is for an earlier version of it, when `check` or `meaning` has not run on it, or when `meaning` exited 2; the reason is printed. Run what it names and build again.

Before building, lint the body text through the release gate in SKILL.md; the docx carries the same words. Render to PDF (`soffice --headless --convert-to pdf`) and look at it before delivering. Dan opens the docx in Word, selects all, copies, pastes into Outlook, so every email docx comes from the template through `build`: HTML, a docx built from scratch and Outlook connector drafts all lose the list formatting.

The template is "Format Rejection Template.docx" beside the script in the folder `latest.py` printed (Dan's canonical formatting), md5-checked on every build; `python3 review_gate_tools.py template [OUT.docx]` writes a copy if Dan needs the file itself. If the build stops because the file is missing, run `python3 latest.py` again (an interrupted fetch is replaced) and build from the folder it prints. If it stops on an md5 mismatch, the template was edited: confirm with Dan before building from it.
