---
name: leave-audit-method
description: "Per-employee unplanned-absence / Bradford audit — method, template, and files in the leave-tracking project"
metadata: 
  node_type: memory
  type: project
  originSessionId: 9cddf3e3-b997-4753-8bd7-90d2308275cc
  modified: 2026-07-23T13:55:00.987Z
---

Per-employee absence audits for Active Alarm (2026 coverage Jan 1 - Jul 22). Deep-dive per person, separate from the all-employee `Leave_Tracking_2026.xlsx`. See [[teams-email-history-limits]] and [[teams-leave-source]].

**Deliverable per person** = `Leave_Audit_<Name>_2026.xlsx` with tabs: Ledger (one row per counted unplanned day, FACTS ONLY) + Bradford. Built from `Leave_Audit_TEMPLATE.xlsx` (tabs: How to use / Ledger / Bradford, 40 blank rows, formulas pre-wired). Builders live in the scratchpad (`build_audits.py`, `build_template.py`).

**Ledger columns:** Date, Day, Category, Source (HR/Teams/Both), HR leave type, HR hrs, HR frac, Requested(filed), Filing timing (same-day/retroactive/ahead), Announced by, Teams announcement (verbatim), Stated duration (own words), Emails sent, Teams msgs, Teams coverage, **Absence (days)**, **Counts as occasion (std)**, Notes. Hidden helpers S:W (orig/expflag/SS_orig/SS_std/SS_exp), holidays in X.

**Two decision columns only** (rest is factual): Absence (days) = fraction out (1/0.75/0.5/0.25/0); Counts as occasion (std) = 1/0.

**Three Bradford scenarios (=Spells^2 x Days), all formula-driven. PRIMARY = True-exposure** (D = fractional Absence-days column). User's rationale: S^2 already punishes frequency regardless of length, so D should carry actual magnitude, not double-count length-blindness. Standard (D = count of Counts=1 days, each as 1 full day) kept only as reference for external/HR policy-trigger comparability; Original (every filed row = 1 full day) kept as unaudited reference. On the Bradford tab: True-exposure is the top/gold row, other two demoted. Spell = merges consecutive working days via WORKDAY (Fri+Mon = one spell). US holidays 2026: 1/1,1/19,2/16,5/25,7/3.

**Hard user rules:** NO injected judgments in the sheet (no verdict column, no editorial notes, no judgment shading) - facts only; the numbers carry the conclusion. Bereavement / non-sickness excluded from the sickness Bradford (user's call even when not policy-covered, e.g. Nick 1/7 death of a close friend). Appointments and preapproved-WFH days excluded. Teams-only "sick" days with no HR filing still count unless activity shows a full worked day.

**Primary metric renamed "Bradford Factor (Corrected)"** (was True-exposure), per user: HR/Legal got Bradford wrong by using whole-day D on top of S^2.

**ALL 22 employees audited** (files Leave_Audit_<First>_2026.xlsx). Ranked by Corrected: Wade 1296, Nick 1100, Amanda 668, Daniel 650, Art 446, Palm 384, Chris 343, Freeman 100, Danny 64, Rebecca 56, Martin 27, Mireya 18, Erich 16, Scott 12, Jerry 8, Hal 4, Trevor 3, Tina 2, Brian/Lynne/Marcus 1, David 0. Builders: build_audits.py (Daniel/Nick), build_wade_art.py, build_all_remaining.py (18) driven by remaining_data.json + inline ACT activity dict; template build_template.py.

**Attendance policy work (follow-on):** user diagnosed a lax-attendance culture from the audits. All packaged in project subfolder **Attendance_Reset/**: 00_Attendance_Reset_MASTER.md (the SPINE - process/timeline/doc-map, references the rest), 01_Handbook_Edits.md (3 surgical edits to handbook 2-5 + 5-3; NOT a rewrite - user insisted surgical), 02_Manager_Tool.md (internal manager standard w/ Bradford triggers: phone-ONLY call-in, same-day filing, return-to-work, check-in at Corrected 50 / review at 200), 03_Messages.md (manager pre-brief + Dan's written notice + manager team talking track), 04_Acknowledgment_Form.md (signed form -> personnel file, matches handbook p.74 mechanism). Rollout model = cascade: Dan's written notice to all, then managers reinforce with own teams (NOT an all-hands). Core rule chosen: no morning-of WFH; too sick to come in = off all day offline; guardrails = contagion override + scheduled WFH untouched. Go-live target Aug 17 2026. Audits (Leave_Audit_*.xlsx, 22) stay in project root as private evidence base, referenced by master, never shown to staff. Company handbook = __USERHOME__\Downloads\AAC-Handbook-2026.04.03-Rev6.pdf (80pp; extracted to scratchpad handbook.txt). Reconciled: handbook already requires phone call to manager (5-3), remote-not-a-substitute-for-sick (2-5), doctor's note >3 consecutive days & 2h min sick increments (3-4) - all consistent. Core rule user chose: NO morning-of WFH; too sick to come in = off all day offline; guardrails = contagion override + scheduled WFH untouched. Data caveats: Jerry = no valid mailbox/Teams identity (defaulted full sick from HR); Freeman 3 early Teams dates n/r (email complete); David 6/29 = planned appt filed +17d -> excluded (BF 0); Tina/Hal worked through their sick days (heavy email) -> sharply reduced. Next possible: one-page comparison summary workbook. Activity method: email via delegated mailbox (`outlook_email_search mailboxOwnerEmail=<email>`, complete); Teams via `from:<email>` chronological paging (floor: shared-with-Daniel chats only; reaches back ~6 weeks / ~1000 msgs).
