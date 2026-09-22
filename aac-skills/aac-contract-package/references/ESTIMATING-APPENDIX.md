# Estimating Build appendix — ESTIMATING-APPENDIX.md

## Document control
- **Document type:** Parked estimating policy — every price-derivation rule removed from the drafter-facing standards
- **Purpose:** The contract package drafter and reviewer never derive a price; they validate shipped figures against the sources named in SCHEDULE-GENERATION-PROCEDURE §1 and MAPPING-APPENDIX §3a. This file preserves the derivation rules those documents once carried, so nothing is lost before the estimating build starts. It is the seed document for that build.
- **Created:** 2026-08-19 (wayfinder ticket #7), per Dan's direction: "gut the entire package … for anything that belongs to estimating and shove it into an Estimating Build appendix. We'll bolt on estimating much later."
- **Status:** Parked, with two exceptions consulted live: §1's approved labor costs table (read by the prevailing-wage check in SCHEDULE-GENERATION-PROCEDURE §1) and §6's subcontractor pass-through markup tiers (ruled 2026-08-27, consulted whenever a work-up carries a sub furnish-and-install quote).

## 1) Approved labor costs

As of 2026-08-19 (Dan). These are Active Alarm's internal labor **costs**, the figures a work-up's labor cost column carries — not customer-facing sell rates.

| Role | Cost per hour |
|---|---|
| Field Tech | $55.00 |
| Field Tech, Prevailing Wage | $100.00 |
| Programmer | $50.00 |
| PM | $75.00 |

## 2) Repair Service derivation

Ratified 2026-08-03 (per Dan's direction, CUSTOMER-14). Calculate **both** ways and take the **greater**:

1. **FSI method** — run the Fire Repair & Inspection template (or the system-appropriate FSI worksheet) against the verified device count.
2. **1% rule** — 1% of Active Alarm's total cost on the WU.

### Open item — the 1% basis (estimating owns this; flag stays until estimating resolves it)

"Total cost" is unresolved. Chris applied the 1% to $3,100 — the equipment cost. The full CUSTOMER-14 WU cost was $3,140.42, including labor, trip charges, and the misc roll-up. The two bases diverge on a labor-heavy job. Ruled 2026-08-19 (wayfinder ticket #7): this is an estimating decision, not the drafter's; no basis ruling is needed for package work because the drafter never derives a Repair Service price.

## 3) Contracted Inspections derivation

1. Price a service call covering the same amount of time, including the trip charge. This is the **per-inspection price**.
2. Multiply by **0.8** — the customer earns a 20% discount by contracting the work.
3. Divide by **12** for annual inspections, or by **3** for quarterly inspections.

The divisors work out to the same monthly math: one inspection a year spreads a single inspection across twelve months, and four inspections a year spread four inspections across twelve months, which is the per-inspection price ÷ 3.

*Worked example, annual:* a $1,200 inspection ÷ 12 = **$100/month**.
*Worked example, quarterly:* the same $1,200 inspection ÷ 3 = **$400/month**.

## 4) Software support passthroughs

Where a mapping row names a software support passthrough (Honeywell WIN-PAK SMU, Standard Software Support Agreement — Pro-Watch, Software Upgrade Agreement), the price is the supplier's quote **plus a 50% markup**. The quote must be obtained before the package is approved. The passthrough never includes labor to install patches, fixes, or upgrades.

## 6) Subcontractor pass-through markup

Ruled 2026-08-27 (Dan), from the Clearbrook Commons-Krause lockwork review (Anderson Lock quotes #404004, #404414, #404416). Unlike the rest of this appendix, this section is live estimating policy: consult it whenever a work-up carries a subcontractor furnish-and-install quote.

**The 64% whole-job markup standard applies to self-performed scope** — AAC labor, and equipment AAC procures, handles, installs, and warrants. The figure comes from spreading AAC's overhead across the cost of a normal job mix. AAC's own activity consumes that overhead; a sub's furnish-and-install dollar consumes a small fraction of it (PM coordination, insurance, cash float, the warranty wrap), so it earns a lower rate.

**Sub furnish-and-install scope is priced by where it sits on the proposal:**

| Placement | Markup | Reasoning |
|---|---|---|
| Inside a base section | **20–25%** | AAC spec'd the component into its system design, AAC's techs diagnose its failures through AAC's own equipment, and AAC carries the license exposure, warranty wrap, and coordination. Electric strikes, latch retraction kits, maglock installs by lockwork subs. |
| Broken out as a separable or optional section | **10–15%** | The format invites the customer to evaluate, decline, or bid the line alone. Door operators, standalone door hardware scope. |

Placement replaces judgment about how "integrated" the sub's work is: everything a sub installs touches the system, so integration sorts nothing. Scope the customer can carve out is scope the customer can shop, and it takes the lower tier.

**Judge a mixed job by its own-scope markup plus the tiers above, not by the blend.** A sub-heavy job showing 45–55% blended is healthy when the self-performed scope carries the full 64%.

**Software support passthroughs keep the §4 rule (50%).** Those are license lines with no sub labor attached, and the customer cannot bid them out.

### Open item — the gross-profit-per-crew-day floor (estimating owns this)

The job-level health gate is gross profit dollars per AAC crew-day against a floor derived from the P&L; margin percent alone does not tell you whether a job covers its share of expenses. Deferred 2026-08-27 (Dan): P&L not ready for review. Until the floor is computed, 64% on self-performed scope stands as the working standard and no crew-day gate is applied.

## 5) Known divergence — CUSTOMER-14 worked example

The example that shipped in MAPPING-APPENDIX §3a did not reproduce from the FSI Rev.1 on file, and both were cited as authority. Recorded here so the estimating build starts from the truth:

| | §3a formula as written | FSI Rev.1 on file |
|---|---|---|
| Annual inspection | 4 hours at $135/hr plus $50 trip = $590, ×0.8 ÷12 = **$40/month** | $375 one-time, ×0.8 ÷12 = **$25/month** |
| Repair Service | "FSI gave $46" | $46 is the **combined** Repair Service and Inspection program; Repair Service alone is **$21** |

Mark ruled on 2026-08-03 that the customer keeps the $25 she was quoted — the quoted price governs, which is already package law (SCHEDULE-GENERATION-PROCEDURE §1, rank 1). The formula-versus-FSI divergence is estimating's to reconcile when the build starts.
