---
name: fable-usage-is-rationed
description: Dan's Fable 5.1 usage is capped per week; fleet and subagent workers keep the Opus 5.5 / Sonnet 5 / Haiku pins, while the orchestrator session itself runs Fable 5.1 high
metadata:
  type: feedback
---

Fable 5.1 weekly usage on Dan's account is limited. Fleet and orchestrator worker model pins
(`implModel: claude-opus-5-5` since 2026-09-22, Opus 5 from #259 on 2026-09-15 until then, `verifyModel: claude-sonnet-5`, Haiku for
deliver/report) stay as they are, even though the Fable prompting guide says Fable at `medium` or `low` is cheaper per task.

**Why:** Dan declined the pin swap on 2026-09-01 ("leave the fleet models alone, I have limited
Fable usage per week"). Cost per task is not the constraint; the weekly Fable quota is, and the
interactive sessions Dan drives are what it must cover.

**How to apply:** Prompt-level improvements to fleet stages are fine. Model or effort changes that
route bulk agent work through `claude-fable-5-1` need Dan's explicit ask.

The orchestrator session itself runs Fable 5.1 at high effort (Dan, 2026-09-24: "which is where
you should be as orchestrator"). The rationing covers bulk worker load, not the session that drives it. See [[marketplace-is-the-distribution-spine]] for where the fleet scripts live.
