# Part translation dictionary — PART-TRANSLATIONS.md

## Document control
- **Document type:** Governing dictionary, part number to customer-facing schedule description
- **Purpose:** SCHEDULE-GENERATION-PROCEDURE.md §6 names this file as step 2 of the description resolution order. When a work-up's own Description field does not pass muster, the schedule name comes from here, so the same SKU always ships under the same name.
- **Created:** 2026-08-19, seeded from the six translations ratified in §6 (wayfinder ticket #4)
- **Status:** Active. Grows one row per newly shipped translation; every addition is a Dan-ratified PR, like any reference change.

## Rules

- Key is the work-up part code, verbatim.
- The description is what the customer would call the device: plain English, no part numbers, no vendor jargon.
- A SKU already in this table always translates to its listed description. Divergence is a defect.
- The PartList snapshot in `fixtures/exports/` identifies parts (SKU, manufacturer, cost); it never names them.

## Dictionary

| Part code | Schedule description |
|---|---|
| `XR150DNFC-R` | Fire Alarm Control Panel |
| `263LTE-2` | Cellular Communicator |
| `630F-R` | Remote Annunciator |
| `1164-W` | Wireless Smoke Detector with Sounder |
| `1184-W` | Wireless Carbon Monoxide Detector |
| `NP12-12` | Battery Backup |
