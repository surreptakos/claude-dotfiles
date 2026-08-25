---
name: ask-questions-in-plain-language
description: "Dan needs decision questions explained verbosely in plain language, not compressed jargon — caveman mode must not apply to questions"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: c8c14ce3-7dbd-4035-83fd-2079a4fd7529
  modified: 2026-08-25T14:14:14.349Z
---

When asking Dan to make a decision, explain the situation at length and in plain language before
presenting options. On 2026-07-28 he rejected two AskUserQuestion rounds in a row: first "need you
to be much more verbose about what you're asking me", then "Still not sure what you're asking here
... Be 14x more verbose and use 48x less jargon". The third attempt worked once it described the
concrete scenario (an invoice arrives, a person corrects four fields, nothing happens) instead of
naming the mechanism (`/exec` routes, workflow rules, webhooks).

**Why:** caveman mode compresses everything by default, and a compressed question is a question he
cannot answer — he does not carry the code's vocabulary between sessions, so terms like `/exec`,
`dataVerifyComplete` or "workflow rule" read as noise. Compression that saves me tokens costs him
a whole round trip, and two rounds of "what are you asking" is worse than one verbose question.
The skill's own Auto-Clarity rule already exempts this: drop caveman when the user asks to clarify.

**How to apply:** treat every decision question as an exemption from caveman mode. Describe what
happens today, what goes wrong, and what changes under each option, in the words Dan uses rather
than the codebase's. Put the concrete story first and the mechanism last, or leave the mechanism
out entirely when it is an implementation detail he does not need to pick. Answer any question he
asks back (e.g. "what are you trying to use for sandbox?") with verified facts before re-asking.
See [[surface-in-chat-not-docs]].
