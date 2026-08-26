---
name: o3-directs-include-techs
description: "Org structure source of truth is config/org-chart.yaml (owner PDF 2026-08-19); Rob owns Projects side, Nick owns Services side — people.yaml manages lists drift"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5faad2cd-370b-439d-b979-fc8b8447a1b5
  modified: 2026-08-25T22:49:08.389Z
---

Authoritative org structure: `config/org-chart.yaml` on main (rebuilt 2026-08-19 from Dan's own org chart PDF "260819 AAC Org Chart.pdf", OneDrive Desktop\SAVE ME\Org Chart). Rob Olsen's directs: Palm Gatsakos (Project Admin), Christopher Freeman + Hal Henderson (Project Managers), Danny/Jerry/Martin Martinez + TJ Hansen (Project Technicians), Art Sotelo + Chris Gatsakos (System Specialists). Nick Remblake's directs: Becky Runyan, Mireya Torres, Tina Romanchek, Juan Martinez, Scott Taggart, Brian Martin, Matt Jansen, Mike Wade. Departed, never treat as staff: Jane Musel, Mary Gatsakos, Doug Davenport.

**Why:** Earlier note said Rob's directs = 4 named leads + "all field technicians" (Dan's 2026-08-18 correction). The 2026-08-19 chart splits technicians: project techs under Rob, service/support under Nick — Mike Wade and Mireya Torres are Nick's, not Rob's. `config/people.yaml` `rob.manages` still reads `[Palm Gatsakos, Chris Gatsakos, Christopher Freeman, Art Sotelo, all field technicians]` as of 2026-08-25 (verified live); drift was flagged 2026-08-19 with ticket publish gated on Dan's `[approve-tickets]`, and no ticket has been filed since. Six-day gap suggests either the drift-fix ticket is stuck or the plan changed — flag if the answer matters for the next O3 run.

**How to apply:** For O3 scope or any "Rob's directs / Nick's directs" question, read `config/org-chart.yaml` `reports_to` edges, not people.yaml `manages`. Write "all your directs" in docs without enumerating. Related: [[o3-prep-surface-outputs]].
