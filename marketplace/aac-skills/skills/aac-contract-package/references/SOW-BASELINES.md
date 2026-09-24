# Active Alarm Scope of Work Baselines — SOW-BASELINES.md

## Document control
- **Document type:** Companion drafting standard to the Living Standard (operationalizes §5)
- **Audience:** Sales reps, Sales Admin / drafters, contract reviewers, GPT-assisted reviewers
- **Purpose:** Make the SOW on every Schedule of Equipment and Services a repeatable, clinical description of the work. The schedule is incorporated into the master agreement (¶1, ¶30), so SOW prose is operative contract language — it is written once here as a standard, not per-rep.
- **Status:** Active — ratified 2026-06-05. Amended 2026-08-10: the SOW no longer carries an itemized device list, and **the SOW no longer restates the site address** — the Site box at the top of the schedule already carries it. New packages are drafted from these templates; packages already in flight keep the preserve-and-surgically-edit treatment in PROMPT.md. Amended 2026-08-19 (wayfinder ticket #5): §7.3's per-opening sentence is conditioned on the actual device set; §7 now covers every sold system type (§7.6–§7.12) plus a fallback rule for types without a template.

## How to use this file
- The **drafter** writes the schedule SOW by filling the template for each system sold. Proposals may keep sales voice; the schedule does not inherit proposal prose. Translation through this template is the firewall — never copy-paste a proposal SOW into a schedule.
- Square-bracket **[SLOTS]** are mandatory fills. A bracket or placeholder left in a customer-facing export is a hard-stop review failure.
- Job-specific sentences beyond the template are allowed only when supported by the job documents.
- When a baseline sentence conflicts with a job-specific condition, the job-specific condition controls.

## 1) Canonical opening sentence
Every system's SOW begins:

> **"Active Alarm Company will furnish, install, program, and test a [DESIGNATION] [SYSTEM TYPE] at the site listed above, as itemized in the Equipment and Labor section."**

Two cross-references, both fixed:

- **"at the site listed above"** — the Site box at the top of the schedule already carries the site name and full address, and the Equipment and Labor section repeats it on its Site line. Do not type the address a third time. An address written into the SOW is one more place to get it wrong and one more place to update when it changes. Ratified 2026-08-10, replacing "at [SITE ADDRESS]."
- **"as itemized in the Equipment and Labor section"** — replaces the former "consisting of:" opener and its bulleted device list. Ratified 2026-08-10. The trailing "of this schedule" was dropped 2026-08-17 per Dan: phrase SOW sentences without the word "schedule."

The verb set is fixed: **furnish, install, program, and test** — one string, verbatim, every time. It tracks the master agreement's ¶1 operative verbs ("sell, install, and program"), folds "configure" into "program," and matches the standard testing/commissioning clarification.

Deprecated openers — do not use: any variant that spells out the site address, "consisting of:" followed by a device list, "purchase and install," "provide and install," "provide, install, configure and program," "will provide a proposal for," or "custom [system]."

### Per-System labelled paragraph form

*Amended 2026-09-10 (spec 215 stream B, ADR-0001); ratified by Dan 2026-09-18 (PR #238, confirmed on issue 359).* A Project selling more than one System within one Contract family (§3) carries one scope-of-work paragraph per System, in the same order the Systems appear in the Equipment and Labor section. Each paragraph opens with a label — the System's approved name from §3, followed by a colon — and then follows the canonical sentence above and the applicable §5 follow-on sentences for that System. Golden-12 and golden-17 already read this way; see `fixtures/golden/golden-17/expected/` for a three-System example.

The single-System form uses the same labelled shape: one paragraph, the approved system name as its label. Keeping the label on single-System Projects means the drafter, the reviewer and the verifier all read one layout rather than two.

*Multi-Site form, ruled by Dan 2026-09-24 (issue 359).* A Project spanning more than one Site carries one paragraph per Site and System occurrence, in Equipment and Labor order, each label opening with the Site's name, a comma, then the System's approved name and the colon — so two Sites selling the same System read as two distinct paragraphs.

The label is exactly the approved name from §3, verbatim — no synonyms, no site name inside the label, no equipment count in the label, no "System" prefix. Anything else on the label side is a review failure.

### Naming a building or area within the site
Where the work covers only part of a multi-building site, do not solve it in the opening sentence. The scope limitation belongs in Clarifications:

> "This scope applies only to the [building/area]. The adjoining [building/area] is not included."

## 2) Designation token (mandatory)
**[DESIGNATION]** is exactly one of:

| Token | Meaning |
|---|---|
| **new** | No existing system of this type at the site |
| **replacement** | An existing system of this type exists and is being replaced |
| **takeover** | An existing system is being retained and brought under AAC service/monitoring |
| **addition** | Extending an existing AAC system |

Selecting **replacement** or **takeover** triggers the Reused/Taken-Over baselines in BASELINES.md, the removal/disposal exclusion check, and Living Standard §11. Determine the designation from the job documents; a site with an existing system of the same type is not "new." Where "addition" reads awkwardly, write "an addition to the existing [SYSTEM TYPE]" — the token still governs.

## 3) Approved system type names

*Contract family column added 2026-09-10 (spec 215 stream B, ADR-0001); ratified by Dan 2026-09-18 (PR #238, confirmed on issue 359).*

| Approved | Never | Contract family (commercial Projects) |
|---|---|---|
| Intrusion Alarm | burglar alarm, burg, "security system" as a system name | Commercial Security |
| Video Surveillance | CCTV, camera system (CCTV acceptable in internal docs only) | Commercial Security |
| Access Control | — | Commercial Security |
| Fire Alarm | — | Commercial Fire |
| Elevator Monitoring | — | Elevator Monitoring |
| Audio/Visual | Sound system | Commercial Security |
| Nurse Call | — | Commercial Security |
| Area of Refuge | Area of Rescue | Commercial Fire |
| Network | data cabling as a system name | Commercial Security |
| Standalone Intercom | — | Commercial Security |
| Visitor Management | — | Commercial Security |
| Standalone Environmental Monitoring | — | Commercial Security |

**Contract family is derived, never entered.** The taxonomy in the third column is issue #10 ruling 1 (Dan, 2026-08-20): Commercial Fire covers Fire Alarm and Area of Refuge; Elevator Monitoring covers Elevator Monitoring; Commercial Security covers every other commercial system. A commercial Project whose Systems span more than one family in this column is refused with a split instruction — the standing case is the combination fire-and-burglar panel, which the Contract Package Rules already route to both agreements. Residential Projects collapse every System — fire included — into **Residential Security** per the same ruling; the column above governs the commercial side only. The builder cites this table; the deal record never carries a family field.

## 4) Scope description rules — no equipment itemization
**The SOW does not list equipment.** The Equipment and Labor section is the itemized list, and repeating it in prose creates two versions of the same thing that drift apart.

The SOW instead names, in prose:
- the designation and system type, with the site by cross-reference (canonical sentence),
- what the system covers — areas, openings, doors, or camera coverage — matching the placement plan,
- the counts that define the responsibility boundary: cameras, secured openings, points of protection, initiating devices, notification appliances,
- communication path, head-end locations, recurring services, and existing-system disposition per §5.

Never in the SOW: the site address, part numbers, model names, mounts, adapters, dome covers, IR illuminators, PoE injectors, power supplies, batteries, wire, mounting hardware, freight, or misc roll-ups.

Three artifacts, three inclusion thresholds:

| Artifact | Contains |
|---|---|
| Equipment and Labor | Everything sold — devices, accessories, roll-ups |
| SOW | Prose only: system, coverage, and the counts that set the boundary. No itemized equipment, no site address |
| Placement plan | Independently placed, customer-visible devices only |

Traceability runs one direction: every device or system element named in the SOW must trace to a line in the Equipment and Labor section. The reverse is not required.

## 5) Required sentences after the canonical sentence
In this order, as applicable:

**a) Coverage sentence** (all systems). One sentence naming what the system covers and the boundary counts:
- "The system consists of four (4) cameras covering the north exterior elevation, the basketball court, and the indoor pool area."
- "The system secures the main entry and the two rear dock doors."
- "The system provides [N] points of protection across the office suite and the warehouse perimeter."

**b) Communication path** (Intrusion / Fire Alarm):
> "Sensors communicate to the panel via [wireless RF / hardwire]; the panel communicates to the monitoring center via [cellular LTE / phone line / dual-path IP and cellular]."

**c) Head-end locations** (when known):
> "The [alarm panel / recorder] will be installed in the [LOCATION]; the keypad will be installed in the [LOCATION]."

If undetermined at drafting, omit the sentence — never write "TBD" into a schedule SOW.

**d) Recurring services acknowledgment** (when RMR is sold):
- Monitoring: "The system includes 24/7 monitoring by a UL-Listed, US-based monitoring center, with Subscriber app access to arm, disarm, and review system activity."
- Cloud video: "The cameras carry [N] days of cloud backup of recorded footage; cameras record on site primarily. Automatic system updates and cybersecurity patches are pushed to the recorder."
- Hosted access control / other RMR: one sentence naming the service exactly as it appears in the SERVICES section.

The word is always **"schedule."** The word "proposal" must not appear anywhere in a schedule SOW.

**e) Existing-system disposition** (replacement / takeover only):
> "The existing [SYSTEM TYPE] will be [removed by Active Alarm Company / decommissioned and left in place / retained and reprogrammed], as listed."

Must agree with the Equipment and Labor section and pricing. If removal is not priced, omit the sentence.

**f) Closer (fixed):**
> "Upon completion, Active Alarm Company will test the system and provide end-user training."

## 6) Prohibitions (all systems)
- **No site address.** The Site box carries it. See §1.
- **No equipment itemization.** No bulleted device lists, no accessory enumeration, no model names, no part numbers.
- No sales narrative, feature marketing, app walk-throughs, or value statements. The proposal is the selling document; the schedule is the contract.
- No "this proposal," no project history, no internal notes or open questions.
- No subcontractor names. No "others"/"Other" as a responsible party.
- No promises not priced: if it is not in Equipment and Labor or SERVICES, it is not in the SOW.
- No hardware inference (lock work does not imply specific electrified hardware).

## 7) Templates by installation type

Every sold system type has a template below. If a job carries a system type with no template block (a genuinely new offering, or a deal tagged "Other"), the drafter composes the SOW from the §1 canonical opening sentence and the §5 required-sentence set — those rules are system-agnostic — and the package escalates to Dan for review before send. The first real job of that type seeds its template, ratified by PR.

### 7.1 Intrusion Alarm
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] intrusion alarm system at the site listed above, as itemized in the Equipment and Labor section. The system provides [N] points of protection covering [AREAS AND OPENINGS]. Sensors communicate to the panel via wireless RF; the panel communicates to the monitoring center via cellular LTE. [Head-end locations sentence.] The system includes 24/7 monitoring by a UL-Listed, US-based monitoring center, with Subscriber app access to arm, disarm, and review system activity. Upon completion, Active Alarm Company will test the system and provide end-user training.

### 7.2 Video Surveillance
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] video surveillance system at the site listed above, as itemized in the Equipment and Labor section. The system consists of [N] cameras covering [COVERAGE SUMMARY MATCHING THE PLACEMENT PLAN]. [Head-end locations sentence.] The cameras carry [N] days of cloud backup of recorded footage; cameras record on site primarily. Automatic system updates and cybersecurity patches are pushed to the recorder. Upon completion, Active Alarm Company will test the system and provide end-user training.

#### 7.2a Cloud-native camera variant (no recorder)

Amended 2026-08-17 per Dan, from the Riley Building job. Where the cameras are cloud-native (Avigilon Alta and the like) there is no recorder: the cameras connect directly to the network, record locally to onboard SD cards, and back up to the cloud platform. The template's recorder sentence misstates the system. Use instead:

> "The cameras connect directly to the network through the [PLATFORM] cloud platform, record locally to onboard SD cards, and carry [N] days of cloud backup. Automatic system updates and cybersecurity patches are pushed to the cameras."

On a cloud-native job the NVR/DVR rack-space exclusion has no recorder to cover; omit it.

Two phrasing rules from the same direction: avoid "this schedule" as a sentence subject anywhere in the SOW — name the thing instead ("The cameras carry 30 days of cloud backup", not "This schedule includes 30 days of cloud backup") — and the canonical opener's cross-reference reads "as itemized in the Equipment and Labor section" without a trailing "of this schedule."

### 7.3 Access Control
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] access control system at the site listed above, as itemized in the Equipment and Labor section, securing the following opening(s): [DOOR NAMES / NUMBERS]. Each secured opening receives a credential reader, request-to-exit device, and door position contact. Mechanical door hardware is furnished by [Active Alarm Company / Subscriber's designated contractor] as listed. [Recurring hosted/cloud service sentence per the Mapping Appendix.] Upon completion, Active Alarm Company will test the system and provide end-user training.

Each secured door must be identified by name or number. Never infer electrified hardware not listed. The per-opening sentence describes function, not equipment — do not extend it into a parts list.

Amended 2026-08-19 (wayfinder ticket #5): the per-opening sentence above is the ideal full set, not an assertion. It must match the opening's actual device set as itemized in the Equipment and Labor section — drop or swap devices not sold, so §4 traceability holds. The common variance is a reader-and-strike opening:

> "Each secured opening receives a credential reader and electric strike, as itemized in the Equipment and Labor section."

Electrified hardware (strike, maglock) is named only when it appears in the Equipment and Labor section — the no-inference rule above governs.

### 7.4 Fire Alarm
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] fire alarm system at the site listed above, as itemized in the Equipment and Labor section. The system covers [AREAS / BUILDING] with [N] initiating devices and [N] notification appliances. The panel communicates to the monitoring center via [PATH] with [SUPERVISION INTERVAL] supervision. All work is subject to AHJ review and approval. Interfaces to [sprinkler / HVAC / elevator] systems are limited to [LISTED SCOPE]; integration work beyond what is listed is the responsibility of Subscriber's designated [trade] contractor. Upon completion, Active Alarm Company will test the system with the AHJ as required and provide end-user training.

### 7.5 Elevator Monitoring (monitoring-only)
> Active Alarm Company will furnish, install, program, and test a [cellular elevator communicator / elevator phone monitoring connection] for [QTY] elevator(s) at the site listed above, as itemized in the Equipment and Labor section. The device communicates to the monitoring center via [PATH]. The service includes 24/7 elevator phone monitoring by a UL-Listed, US-based monitoring center.

### 7.6 Nurse Call
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] nurse call system at the site listed above, as itemized in the Equipment and Labor section. The system covers [AREAS / ROOMS] with [N] call stations and [N] annunciation devices. [Head-end locations sentence.] [Recurring services sentence per §5d when RMR is sold.] Upon completion, Active Alarm Company will test the system and provide end-user training.

Call stations include pull stations; count them in [N]. Where the work is an addition to an existing nurse call system (the common case), the designation token is **addition** and the existing-system tie-in is named: "The [N] call stations will be added to the existing [MANUFACTURER] nurse call system."

### 7.7 Area of Refuge
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] area of refuge two-way communication system at the site listed above, as itemized in the Equipment and Labor section. The system consists of [N] call stations serving [LOCATIONS] and a base station at [LOCATION]. All work is subject to AHJ review and approval. Upon completion, Active Alarm Company will test the system with the AHJ as required and provide end-user training.

The approved name is **Area of Refuge** — never "Area of Rescue." Code-driven like Fire Alarm: the AHJ sentence and AHJ-witnessed test are mandatory.

### 7.8 Network
> Active Alarm Company will furnish, install, and test [N] [CATEGORY] network cable drops at the site listed above, as itemized in the Equipment and Labor section. The drops serve [AREAS / DEVICE LOCATIONS] and terminate at the [IDF / MDF / HEAD-END LOCATION]. Upon completion, Active Alarm Company will test all cabling and provide test results.

Cabling has no programming step, so the verb string is **furnish, install, and test** — the one sanctioned deviation from the §1 canonical verbs. No monitoring sentence, no end-user training sentence: there is no system to train on. Certification to a named standard is promised only when a certification line is priced.

### 7.9 Standalone Intercom
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] intercom system at the site listed above, as itemized in the Equipment and Labor section. The system consists of [N] intercom stations at [LOCATIONS], communicating to [the master station at LOCATION / the Subscriber's mobile app / telephone service]. [Recurring services sentence per §5d when RMR is sold.] Upon completion, Active Alarm Company will test the system and provide end-user training.

### 7.10 Visitor Management
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] visitor management system at the site listed above, as itemized in the Equipment and Labor section. The system covers [N] entry point(s) with [N] kiosk(s) / workstation(s) and [N] badge printer(s). The [PLATFORM] software licensing is carried in the SERVICES section. Upon completion, Active Alarm Company will test the system and provide end-user training.

On a licensing-only deal (no hardware installed), the opening verb string reduces to **furnish, program, and test**, and the coverage sentence names the licensed seat/location count instead of hardware.

### 7.11 Standalone Environmental Monitoring
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] environmental monitoring system at the site listed above, as itemized in the Equipment and Labor section. The system monitors [temperature / humidity / water detection / power status] at [N] points covering [AREAS]. Sensors communicate to the [panel / gateway] via [PATH]; the [panel / gateway] communicates to the monitoring center via [PATH]. [Recurring monitoring sentence per §5d when RMR is sold.] Upon completion, Active Alarm Company will test the system and provide end-user training.

### 7.12 Audio/Visual
> Active Alarm Company will furnish, install, program, and test a [DESIGNATION] audio/visual system at the site listed above, as itemized in the Equipment and Labor section. The system serves [ROOMS / AREAS] with [N] display(s) and [N] speaker(s), controlled from [CONTROL LOCATION / DEVICE]. [Head-end locations sentence.] Upon completion, Active Alarm Company will test the system and provide end-user training.

The approved name is **Audio/Visual** — never "Sound system" (§3).

### 7.13 Services-only (recurring services on a system installed under a separate agreement)

Ratified by Dan 2026-09-22 from the Z-4260 review: a Subscriber who buys no equipment on this schedule and pays only RMR for a system Active Alarm Company installed under a separate agreement with another party (a landlord or general contractor). The Equipment and Labor section reads `N/A`; the Purchase Price is $0.00. The canonical verb string does not apply; "provide the recurring services listed in the Services section" replaces it. One labelled paragraph per system, then one Repair Service paragraph for all systems.

> Access Control: Active Alarm Company will provide the recurring services listed in the Services section for the [PLATFORM] access control system installed at the site listed above under Active Alarm Company's separate installation agreement with [INSTALLING PARTY]. The system secures [N] openings. The [PLATFORM] access control subscription and Remote Technical Support begin at system commissioning. Remote Technical Support covers remote assistance with system operation, user administration, credential management, basic configuration, and troubleshooting; work requiring an onsite service visit is not Remote Technical Support.
>
> Video Surveillance: Active Alarm Company will provide the recurring services listed in the Services section for the [PLATFORM] video surveillance system installed at the site listed above under the same installation agreement. The system consists of [N] cameras. The video subscriptions include [N] days of cloud video retention. The [PLATFORM] video subscription begins at system commissioning.
>
> Repair Service for both systems covers the equipment listed on the attached Addendum of Covered Equipment and begins upon expiration of Active Alarm Company's one (1) year parts and labor warranty under the installation agreement. The monthly amount is $[X] for one year following installation completion and $[Y] per month thereafter.

Clarifications on a services-only schedule keep only what fits a services deal, the same rule BASELINES.md applies to Elevator Monitoring: validity (as "Pricing is valid for 30 days." with the Repair Service hours sentence as its own bullet, no work-hours clause), payments, training at system commissioning, warranty running under the installation agreement, network, software licensing, recording start, and the Repair Service basis. Exclusions: onsite visits and additions beyond the Services section, periodic inspection, and the catch-all. Installation bullets (labor and materials, access, permits, site conditions, prevailing wage, change-order closer, cosmetic, electrical, core drilling, backing, debris, existing removal, AHJ fees) come out.

## 8) Worked example — CPD Fosco Park, Z-4184
> Active Alarm Company will furnish, install, program, and test an addition to the existing video surveillance system at the site listed above, as itemized in the Equipment and Labor section. The system consists of four (4) cameras covering the north exterior elevation along W. 13th Street and the adjacent grounds, the basketball court, and the indoor pool area. The four cameras will be added to the park district's existing Avigilon Alta video system. The existing analog cameras at the basketball court and the indoor pool will be removed by Active Alarm Company.
>
> The system includes 30 days of cloud video storage with analytics for the four cameras, and Repair Service covering those cameras. Upon completion, Active Alarm Company will test the system and provide end-user training.

The site address appears nowhere in the SOW. The Site box has it. The limitation to the Fosco Pool building sits in Clarifications, not here. The mounts, adapters, dome covers, illuminators, and PoE injectors sit in Equipment and Labor, not here.

## 9) Review checks (template-drafted packages)
- Opening sentence matches the canonical string verbatim, including both cross-references — "at the site listed above" and "as itemized in the Equipment and Labor section."
- **No site address in the SOW.**
- **No equipment itemization in the SOW** — no bulleted device list, no accessories, no model names, no part numbers.
- Designation present and supported by the job documents.
- Every device or system element named in the SOW traces to a line in the Equipment and Labor section. Items in the equipment section the SOW does not name are not a finding.
- Boundary counts reconcile with the Equipment and Labor section and the WU.
- Coverage description matches the placement plan.
- The word "proposal" is absent. No brackets or placeholder text anywhere.
- Recurring services acknowledged and matching the SERVICES section.
- Replacement/takeover designation carries the BASELINES reused-equipment items and the removal/disposal exclusion.

## 10) Companion documents
Active Alarm Contract Package Review Living Standard — Final; Schedule-to-Master Mapping Appendix — Final; BASELINES.md; ACCOUNT-RULES.md; DRAFTER-PRESEND-CHECKLIST.md; PROMPT.md.
