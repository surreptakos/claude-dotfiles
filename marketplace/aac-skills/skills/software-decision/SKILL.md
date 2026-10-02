---
name: software-decision
description: AAC software adoption decision, whether to buy, expand or replace a paid tool, with the analysis scaled to the size of the decision. Use when someone proposes a tool ("should we get [tool]"), wants one evaluated, or is comparing tools.
metadata:
  argument-hint: <tool name, or the problem a tool would solve>
  modified: '2026-10-02T15:37:18Z'
  previous-modified: '2026-09-16T04:45:28Z'
  revision: '3'
  content-sha: 0ce3e45977fc
---

# Software Decision

Runs AAC's software adoption decision with the user. `reference/decision-guide.md` is the procedure (gates, tier table and examples, thresholds, the evaluation per tier, scorecard, worksheet): **read it in full before step 2.** The steps below follow its Steps 1 to 6 and add only what running it in conversation needs. `reference/decision-analysis-prompt.md` is the engine the Major tier opens. Both are read by relative path from this folder.

Two principles carry every step:

1. **Scale the analysis to the decision.** A low-cost, cancel-anytime tool is decided in minutes; a multi-year platform takes weeks. The tier is that judgement, and it matters in both directions: over-processing a small tool and under-processing a major one are equally wrong.
2. **Selection is half the decision; rollout and adoption are the other half.** Every "yes" records an owner, a go-live date and an adoption measure. An adopted tool missing those is the common failure mode.

Scope: any decision to pay for new software, expand a paid tool, or replace one. Free single-use utilities with no data access, and configuration of an already-approved tool, sit outside it.

## Workflow

Ask the most relevant question first, one at a time, and fill gaps as the conversation proceeds. Pull from connected tools before asking the user for anything they already hold.

1. **Pull context.** With Zoho CRM, Google Drive or Microsoft 365 connected, find the current tool or process this would replace, any existing contract, and current spend, to ground the analysis and the integration test. With nothing connected, work from user input.
2. **The three gates** (guide Step 1). Done when each has a specific answer: the problem's current cost as a number, what it replaces and how it connects to the systems of record, and one named owner. A "no" on any gate stops the process: recommend no or not yet and name the gate that failed.
3. **Assign the tier** (guide Step 2). State the tier and the factor that set it.
4. **Set the threshold** (guide Step 3). Record the estimate and its assumptions.
5. **Run the tier** (guide Step 4). For Major, open and follow the engine first, then the guide's Major list, and name the assumption most likely to invalidate the decision with the lowest-cost way to test it before committing.
6. **Capacity check** (guide Step 5), at every tier, before committing.
7. **Output.** The completed worksheet from the guide (the record of the decision); the rollout plan (guide Step 6: owner, go-live date, adoption measure, review date, failure conditions and response); and for Major, the one-page recommendation. Done when every worksheet line the tier reaches is filled.

## Notes

- Outside resources, such as the Manager Tools guidance the guide cites, are references, not requirements.
- Keep the company's ownership, sale and exit plans out of every internally shared output.
