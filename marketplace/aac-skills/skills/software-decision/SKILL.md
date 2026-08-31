---
name: software-decision
description: Decide whether to adopt a new paid software tool, with the amount of analysis scaled to the size of the decision. Use whenever someone proposes buying or subscribing to new software, wants a tool evaluated, or is comparing tools — from a low-cost utility to a multi-year platform. Produces a written decision (yes / no / not yet) and, if yes, a rollout plan. Trigger on "should we get [tool]", "evaluate [tool]", "we're thinking about buying [software]", "compare [tool] vs [tool]".
metadata:
  argument-hint: <tool name, or the problem a tool would solve>
---

# Software Decision

Runs AAC's software adoption decision with the user. This skill is the active form of the procedure in `reference/decision-guide.md`.

**Files in this skill (read by relative path from this folder):**
- `reference/decision-guide.md` — full criteria, tier thresholds, scorecard, and worksheet.
- `reference/decision-analysis-prompt.md` — the engine for Major decisions only.

**Operating principles.**
1. Scale the analysis to the size of the decision. A low-cost, cancel-anytime tool is decided in minutes; a multi-year platform takes weeks. Do not run the full process on a small tool.
2. Tool selection is one part of the decision; rollout and adoption are the other. Do not record a "yes" without an owner, a go-live date, and an adoption measure.

## When to use
- Use for any decision to pay for new software, expand a paid tool, or replace one.
- Do not use for free, single-use utilities with no data access, or for configuring a tool already approved.

## Workflow

Ask the most relevant question first and fill gaps as the conversation proceeds; do not present the full list at once. Pull from connected tools before asking the user for information the tools already hold.

### 1. Pull context (if tools are connected)
- **Zoho CRM / Google Drive / Microsoft 365:** locate the current tool or process this would replace, any existing contract, and current spend. Use this to ground the analysis and the integration test.
- If nothing is connected, work from user input. Do not ask the user to connect tools.

### 2. The three gates (every tool — a "no" on any one stops the process)
Confirm a specific answer to each:
1. **Problem and current cost.** Obtain a number — dollars or hours per month. If no number can be stated, stop.
2. **Replacement and integration.** Identify what it replaces, and confirm it connects to the systems of record (Zoho CRM, QuickBooks Desktop, Alarmbiller). If it replaces nothing and connects to nothing, it adds overhead; stop. Before approving a new tool, confirm Zoho One or Microsoft 365 (already licensed) does not already cover the need. For any "QuickBooks integration," confirm it works with QuickBooks Desktop, not Online.
3. **Owner.** One named person for setup, training, and support. If the owner is the proposer, account for that time as a cost.

If all three pass, continue. If any fails, recommend no / not yet and state which gate failed.

### 3. Assign a tier
Assign by the highest factor that applies; one factor is sufficient.

| Factor | Small | Standard | Major |
|---|---|---|---|
| All-in yearly cost | < ~$2,500 | ~$2,500–$15,000 | > ~$15,000 |
| Reversibility | cancel anytime | annual; some switching cost | multi-year lock; painful exit |
| People affected | one / one task | one department | multi-department, or replaces a core system |
| Money / data | none | indirect | billing, recurring revenue, monitoring, or customer site/access data |

State the tier and the reason. Basis: apply heavier analysis only when a wrong choice is both costly and difficult to reverse.

### 4. Set the threshold
- **Revenue tool** (sales / win rate / recurring revenue / customer experience): estimate the conservative annual upside; require at least 2–3× the annual cost. Record the estimate and its assumptions.
- **Internal / cost tool:** estimate annual hours saved × loaded rate, plus any subscription replaced, minus the owner's time to run it; the result must exceed the annual cost. General efficiency claims do not qualify; count only quantifiable dollars or hours.

### 5. Run the tier

**Small** — confirm cancel-anytime, decide, and set a check ~60 days after adoption to confirm use; cancel if not in use. No scorecard or stakeholder review.

**Standard**
1. List 2–3 options, including "continue current process."
2. Run a free trial targeting the factors most likely to cause failure: integration with Zoho / QuickBooks Desktop, and adoption by the intended users (have 2–3 of them use it).
3. Consult the intended users and the budget holder before deciding.
4. Total the real annual cost (subscription + setup + training time + likely per-user increases + cost to leave). Buy only the modules to be used.
5. Contract check (self-serve): cancellation terms, auto-renewal, price-increase clause, data-export rights. No attorney at this tier.
6. Decide against the threshold from step 4.

**Major** — run the full structured analysis. Open and follow `reference/decision-analysis-prompt.md` (the engine), then:
1. Define success in numbers, with a review date.
2. List all options, including doing nothing and one deliberately different approach.
3. Score every option on the scorecard in the guide (0/3/5 × weight); score "do nothing" as well.
4. Check the leading option: does it exceed the others on every factor that matters, and would reversal within a year be costly?
5. Pilot the top one or two with real use before signing.
6. Security / data review (required if it holds customer, billing, or building-access data): SOC 2, data location, breach history. AAC sells security; apply a higher standard to vendor data handling.
7. Attorney review of the contract (required): lock-in length, early-cancel penalty, data-export rights.
8. Write the one-page recommendation (Situation, Options, Comparison, Recommendation, Request) for the approver.

During the Major path, identify the assumption most likely to invalidate the decision and the lowest-cost way to test it before committing.

### 6. Capacity check before committing (any tier)
Determine whether other tool or system rollouts are in progress. Organizational capacity for change is limited; if other rollouts are active, queue this one and record its start date.

### 7. Output
Produce:
- The completed worksheet from the guide (the record of the decision).
- The rollout plan: owner, go-live date, the adoption measure, the review date, and the defined failure conditions and response.
- For Major decisions: the one-page recommendation.

## Notes
- Calibrate the tier (step 3) accurately: over-processing a small tool and under-processing a major one are both errors.
- Complete the rollout plan (step 7) for every "yes." An adopted tool without an owner and an adoption measure is the common failure mode.
- Treat outside resources as references, not requirements.
- Do not include the company's ownership, sale, or exit plans in any internally shared output.
