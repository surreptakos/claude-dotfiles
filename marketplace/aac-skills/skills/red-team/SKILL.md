---
name: red-team
description: Red-team a drafted answer against other vendors' models (GPT, Gemini, Grok) through OpenRouter before sending it. Use when the user asks for a red team or second opinion from other models, or says a reply is important enough to check.
metadata:
  modified: '2026-10-02T15:32:20Z'
  previous-modified: '2026-09-30T19:34:46Z'
  revision: '6'
  content-sha: 56a93167dcb4
---

# red-team

You draft; a **panel** of other-vendor models answers the same question **blind**; a critic from
outside the panel attacks your draft with the panel as evidence; you **integrate**: rule on every
finding, then send. Why this shape (`docs/research/multi-llm-council-2026-09-28.md` in
claude-dotfiles): independent drafts beat collaboration, since a model shown a peer's answer copies
it; a dedicated critic earns its place; and the strongest model merges with the others' names
withheld.

A run costs several frontier calls and a minute or two. Spend it on a decision, recommendation,
research or advice where being wrong is expensive; a lookup, or a code change with tests, already
has a better check.

**What leaves the machine:** the question file and the draft file only, to OpenRouter and on to
each model's provider. Every call carries `provider: { data_collection: "deny" }` (issue 1055), so
OpenRouter routes only to providers it classes as keeping no user data; a model with no such
endpoint fails with a 404 in `errors` and the run goes on with the rest.

## Steps

1. **Draft first.** Write your complete answer as if no red team existed. Done when the draft is a
   file you would send as-is.

2. **Make the question self-contained.** Write a question file holding the user's request plus
   every fact the answer depends on: the panel sees nothing else of this conversation. In both
   files, put placeholders where customer names, personal data, AAC financials and credentials
   would go, and keep the placeholder map in this conversation. Write both as UTF-8. Done when a
   stranger could answer from the question file alone and neither file holds a customer name,
   personal data, an AAC financial figure or a credential.

3. **Run the red team** from anywhere; flags and default models are in the script's header:

   ```bash
   node "<skill base directory>/red-team.js" --question <question.md> --draft <draft.md>
   ```

   In a cloud container the egress proxy injects the key, so no `OPENROUTER_API_KEY` is needed.
   On failure:
   - Exit 2 `cannot read input`: fix the file path and rerun.
   - HTTP 402 `requires more credits`: the OpenRouter account is out of credits; tell the user to
     top it up.
   - Exit 2 `OPENROUTER_API_KEY is not set`, a 402, or exit 1 twice (read `error` and `errors`
     after the first): go to step 6 and send the draft marked unchecked, naming what failed.

   Done when the script exits 0 with a `critique` whose `findings` you can read; a `verdict` of
   `unparsed` means reading the critic's points out of `raw`.

4. **Integrate.** Read the panel answers before `key`, the label-to-model map printed last. Give
   every finding and every `panelOnly` point a ruling: **accept** and revise the draft, or
   **reject** with the reason (evidence the critic lacked, a wrong premise, out of scope). A
   finding stands or falls on its evidence, whatever the number of models agreeing. Done when
   every finding and `panelOnly` point has a ruling.

5. **Loop at most once.** When an accepted high-severity finding changed the recommendation or a
   key fact, run steps 3 and 4 once more on the revised draft. Done when no accepted finding
   changed the recommendation or a key fact, or the second pass is ruled on.

6. **Send.** The revised answer first, then a short red-team block: verdict, each finding in one
   line with its ruling, the models in `key`, and `usage.cost` in dollars. Put the real names and
   figures back in place of the step 2 placeholders. Done when the block lists every ruling from
   step 4 and the answer holds no placeholder.
