---
name: where-the-reports-time-goes
description: "Re-measured after the fixes — the two server legs are ~1.9s, down from ~5.3s; the client half is now the biggest unknown."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3ef79b06-15a0-4db5-a082-fb32e5b11563
  modified: 2026-08-02T06:38:24.694Z
---

**Superseded numbers.** The original entry recorded Dan's HARs (doGet 2.7s, getBoardData 3.1s, 5.3s of a 6.3s
load). Those were fixed on 2026-08-02.

Now, on the deployed page:

- `GET /exec` **1.1–1.8s**. Split with `?probe=1`: **~85 ms is template evaluation, ~1.3 s is the Apps Script
  platform** — a floor, not fixable inside `doGet` (#130, closed as a stated floor).
- `getBoardData` **0.2–1.2s** warm, from 1.9–2.1s. The bundle was 72–88% of it and is now **6–57 ms**: read
  each tab once (#101), cache the unfiltered read per week and scope per rep on top (#102), cache each read as
  its own part so a save costs the refresh one tab (#103).
- Rep switch **0.5–1.2s** from 2.1s, with neither the payload nor the bundle re-read (#108).
- A prior week with **no stored payload blob costs 70–80 s** — that is what "prior weeks are not available"
  turned out to mean (#131, open).

**How to apply:** the server is no longer the dominant cost, so stop aiming there. The unmeasured leg is the
client half — boot, React off unpkg (#71), board render — and #100 stays open because the report runs in a
cross-origin sandbox the Browser pane cannot see into. Measurement recipe:
[[ops-endpoint-measurement-recipe]].

Related: [[perf-bypass-is-live-and-expires]], [[milestone-map-2026-08-02]].
