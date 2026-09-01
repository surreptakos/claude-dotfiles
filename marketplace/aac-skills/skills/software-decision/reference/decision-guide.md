# Software Adoption Decision (AAC)

**Audience.** AAC staff proposing payment for a new software tool, or evaluating one. No prior background is required.

**Output.** A written decision (yes / no / not yet) and, for an adopted tool, a rollout plan. Record it on the worksheet at the end.

**Principle.** The amount of analysis scales with the size of the decision. A $40/month tool that can be cancelled at any time does not require the process applied to a $20,000/year multi-year commitment. Tool selection is one part of the decision; rollout and adoption are the other. This procedure covers both.

---

## Step 1 — Three gates every tool must pass

Answer all three before proceeding. If any cannot be answered, the decision is **not yet**; stop.

**1. What problem does this solve, and what is the problem costing now?**
Record the cost as a number: dollars per month, hours per month, or both.
- *Method:* Estimate it (e.g., "service technicians spend ~5 hours/week on call handoffs"; "~2 deals/month are lost to delayed lead response"). Estimates are acceptable. If no number can be stated, do not proceed.

**2. What does this tool replace, and does it connect to the systems of record?**
- *Method:* Identify what it eliminates — a spreadsheet, a manual step, another subscription. If it replaces nothing and connects to nothing, it adds overhead; stop.
- The systems of record are **Zoho CRM**, **QuickBooks Desktop**, and **Alarmbiller**. If the tool must share data with any of them, verify the integration in a live test before relying on the vendor's claim.
- Two rules: (a) Before adding a new tool, confirm that **Zoho One** or **Microsoft 365** (already licensed) does not already cover the need. (b) For any "QuickBooks integration," confirm it works with QuickBooks **Desktop**, not QuickBooks Online.

**3. Who owns this tool after the demonstration?**
Name one person — not "the team" — responsible for setup, training, and support.
- *Method:* If no owner can be named, the decision is not yet. If the owner will be the proposer, account for that person's time as a cost.

If all three pass, continue. If any fails, the decision is no or not yet.

---

## Step 2 — Assign a tier

Assign a tier using the table below. The tier is the highest one any single factor reaches; one factor is sufficient. A low-cost tool that touches customer data or billing is a Major decision.

| Factor | Small | Standard | Major |
|---|---|---|---|
| All-in yearly cost | < ~$2,500 | ~$2,500–$15,000 | > ~$15,000 |
| Reversibility | cancel anytime | annual contract; some switching cost | multi-year lock; data/number porting required |
| People affected | one person / one task | one department | multiple departments, or replaces a core system (Zoho, QuickBooks, Alarmbiller) |
| Money / data | none | indirect | billing, recurring revenue, monitoring, or customer site/building-access data |
| Process applied | decide in under an hour | a few days | a few weeks |

*(Leadership sets these dollar thresholds; they may change.)*

**Basis for the tiers.** Heavier analysis is applied only when a wrong choice would be both costly and difficult to reverse.
- **Small:** low cost, reversible; a wrong choice costs little. Decide quickly.
- **Standard:** recoverable within a year. Apply moderate diligence.
- **Major:** multi-year commitment, or it touches money, customer data, or a core system. Reversal is expensive. Apply the full process — scoring, piloting, security review, attorney review.

**Examples.**
- *Small:* one additional Zoho seat, a $50/month utility, a browser extension.
- *Standard:* a call-recording / meeting-notes tool, a security-awareness training platform, an HR/payroll provider change, a sales-prospecting tool. (HR/payroll holds employee personal and pay data, which can raise it to Major.)
- *Major:* a company-wide phone system, replacing QuickBooks or Alarmbiller, or any tool that writes to billing or alarm monitoring.

---

## Step 3 — Set the threshold the tool must meet

Before comparing options, define the return the tool must produce. Two cases.

**Revenue tool** (affects sales, win rate, recurring revenue, or customer experience):
- *Method:* Estimate the conservative annual upside — new revenue, faster sales cycle, reduced customer loss. Require the conservative annual upside to be at least **2–3× the annual cost**. Record the estimate and its assumptions on the worksheet.

**Internal / cost tool** (saves time or reduces administrative work):
- *Method:* Estimate annual savings — hours saved × loaded labor rate, plus any subscription it replaces — then subtract the owner's time to run it. The remaining savings must exceed the annual cost. Break-even is a no, unless there is a separate stated reason such as compliance or risk reduction.
- General efficiency claims do not qualify. Count only time or cost savings that can be quantified. Time saved that is not reallocated to other work does not count as a saving.

Measure each option against this threshold.

---

## Step 4 — Run the evaluation for the tier

### Small
Confirm the tool can be cancelled at any time, then decide. Do not build a scorecard or convene stakeholders. Requirement: it must replace something, and a check ~60 days after adoption must confirm it is in use; cancel it if it is not.

### Standard
1. **List 2–3 options, including "continue current process."** Do not evaluate a single option in isolation.
2. **Run a free trial targeting the factors most likely to cause failure.** Usually two:
   - *Integration:* does it connect to Zoho / QuickBooks Desktop? Test data flow in both directions.
   - *Adoption:* will the intended users use it? Have two or three of them use it during the trial.
3. **Consult before deciding.** Ask the intended users and the budget holder before committing.
4. **Total the real annual cost** — not the sticker price: subscription + setup + training time + likely per-user increases + cost to leave. Buy only the modules to be used.
5. **Contract check (self-serve, no attorney at this tier):** cancellation terms, auto-renewal clause, price-increase clause, and data-export rights.
6. **Decide** against the threshold from Step 3.

### Major
Complete the Standard list, then the following, in order.

1. **Define success in numbers, with a review date.** *Method:* concrete targets (e.g., for a phone system: "calls answered by the correct department ≥95%," "total phone cost ≤ current," "in use by ≥90% of staff within 6 months"). Set the review date, typically 6–24 months out.
2. **List all options,** including doing nothing and one deliberately different approach, to avoid anchoring on the obvious choice.
3. **Score each option on the scorecard** (below): rate each line 0, 3, or 5, multiply by its weight, and total. Score the "do nothing" option as well.
4. **Check the leading option two ways:**
   - Does one option exceed the others on every factor that matters? If so, the comparison is clear.
   - If this option had to be reversed within a year, would that be costly? If so, re-examine before proceeding.
5. **Pilot the top one or two with real use before signing.** Test the assumptions most likely to cause failure (integration, field-device performance, support responsiveness).
6. **Security / data review** — required if the tool holds customer information, billing, or building-access data. Obtain the SOC 2 report, data-storage location, and breach history. AAC sells security; apply a higher standard to vendor data handling than a general buyer.
7. **Attorney review of the contract** — required at this tier: lock-in length, early-cancel penalty, and data-export rights. Multi-year commitments carry financial and liability exposure; attorney review is the main step that distinguishes Major from Standard.
8. **Write the one-page recommendation** using these headings and bring it to the approver:
   - **Situation** — the problem and what it costs (2–3 sentences).
   - **Options** — those considered, including doing nothing.
   - **Comparison** — the scorecard result and the two or three factors that decided it.
   - **Recommendation** — the choice, plus the largest risk and its mitigation.
   - **Request** — the specific ask: "approve $X over Y term," or "approve the pilot."

The one-page format is a standard decision briefing — Situation, Options, Comparison, Recommendation, Request. AAC's decision approach follows the Manager Tools decision-making guidance; that guidance is not required to complete this step.

---

## Step 5 — Capacity check before committing

Before signing, at any tier, determine whether other tool or system rollouts are already in progress.

Organizational capacity for change is limited. A tool introduced during other active rollouts may fail on adoption regardless of its merits. If other rollouts are in progress, queue this one and record its start date.

---

## Step 6 — Plan the rollout

The decision is complete only after rollout is planned. These five items scale with tier: for a Small tool, an owner and a check-in date; for a Major tool, a full rollout plan.

1. **Communicate intent.** State the problem being solved and the intended end state, not only operating instructions. Staff who understand the objective require less detailed direction.
2. **Assign one owner** for setup, training, and support. Not a committee.
3. **Set a go-live date and milestones.**
4. **Define one adoption measure** (e.g., percent of staff using it, percent of calls logged) and a date to review it.
5. **Define failure conditions in advance** and the response (fix or cancel).

---

## Scorecard (Major decisions)

Rate each option on each line: **0 = fails, 3 = adequate, 5 = excellent.** Multiply by the weight and total. Score every option, including "do nothing."

The weights are a starting point. **Adjust them for the specific tool** — a security-training tool weights data protection and content currency higher; an HR/payroll tool weights the QuickBooks Desktop connection and compliance higher; a phone system weights reliability and call quality higher.

| # | Criterion | Weight | How to check |
|---|---|---|---|
| 1 | Solves the defined problem | 15 | Match each must-have to a feature; verify in a live demonstration |
| 2 | Connects to the systems of record (Zoho / QuickBooks Desktop / Alarmbiller) | 15 | Run a live two-way data test; for QuickBooks confirm Desktop |
| 3 | Reliability and uptime guarantee | 8 | Read the uptime guarantee and status page; confirm service credits |
| 4 | Data protection and storage location | 12 | SOC 2, data location, breach history — weight higher if it holds customer or billing data |
| 5 | Total cost over the next several years | 12 | Subscription + setup + training + growth + cost to leave |
| 6 | Exit terms | 10 | Contract length, early-cancel penalty, data-export rights |
| 7 | Vendor support | 6 | Response time; escalation path for serious problems |
| 8 | Rollout effort and adoption | 8 | First-week onboarding plan; sample usage report |
| 9 | Access control and permissions | 4 | Permission levels; change-history log |
| 10 | Scalability | 4 | Handles more users / another office without a rebuild |
| 11 | Margin over the "do nothing" option | 6 | Compare totals |
| | **Total** | **100** | |

---

## Worksheet (one per decision)

Complete one per proposed tool. This is the record of the decision.

```
TOOL / VENDOR: ___________________________   DATE: __________   EVALUATED BY: __________

STEP 1 — THREE GATES
  Problem + what it costs now (number): ____________________________________________
  What it replaces / connects to (Zoho? QuickBooks Desktop? Alarmbiller?): _________
  Owner (one named person): ________________________________________________________
  PASSED ALL THREE?   YES / NO       (If NO: stop; record "not yet".)

STEP 2 — TIER
  Tier (highest factor wins):   SMALL / STANDARD / MAJOR
  Reason: __________________________________________________________________________

STEP 3 — THRESHOLD
  Type:  REVENUE TOOL / COST TOOL
  Threshold (annual upside or savings) + assumption: ______________________________

STEP 4 — EVALUATION
  Options considered (include "do nothing"): ______________________________________
  Trial result (integration; adoption): ___________________________________________
  All-in annual cost: ______________________________________________________________
  Contract check (cancellation / auto-renewal / price increases / data export): ___
  [MAJOR] Scorecard totals per option: ____________________________________________
  [MAJOR] Security / data review: _________________________________________________
  [MAJOR] Attorney review done?  YES / NO / N/A

STEP 5 — CAPACITY
  Other rollouts in progress?  YES / NO
  If yes, start date for this one: _________________________________________________

DECISION:   YES  /  NO  /  NOT YET
Reason: __________________________________________________________________________

STEP 6 — ROLLOUT (if YES)
  Owner: ___________________________   Go-live date: ___________________________
  Adoption measure: ________________________________________________________________
  Review date: _____________________________________________________________________
  Failure conditions and response: _________________________________________________
```

---

*This is the condensed, operational version of AAC's software adoption decision. The full method — defining the decision, separating fact from judgment, testing assumptions, and the briefing format — is in the Manager Tools decision-making guidance. It is not required to run this procedure.*
