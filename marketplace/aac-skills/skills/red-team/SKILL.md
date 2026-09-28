---
name: red-team
description: Red-team a drafted answer against other vendors' models (GPT, Gemini, Grok, DeepSeek) through OpenRouter before sending it. Use when the user asks to red-team, cross-check or get a second opinion on an answer from other models, or says a reply is important enough to check.
metadata:
  modified: '2026-09-28T17:37:41Z'
  previous-modified: '2026-09-28T04:52:52Z'
  revision: '2'
  content-sha: fd40f04dd21e
---

# red-team

You draft, a **panel** of other-vendor models answers the same question **blind**, a critic from
outside the panel attacks your draft with the panel as evidence, and you **integrate**: rule on every
finding, then send the revised answer. The design follows the evidence in
`docs/research/multi-llm-council-2026-09-28.md` in claude-dotfiles: independent drafts beat
collaboration (agents shown a peer's answer copy it), a dedicated critic earns its place, and the
merge is done by the strongest model with the others' names withheld.

Each run costs several frontier calls and a minute or two. It fits a decision, a recommendation,
research or advice where being wrong is expensive; a lookup or a code change with tests already
has a better check.

## Steps

1. **Draft first.** Write your complete answer as if no red team existed. Done when the draft is a
   file you would send as-is.

2. **Make the question self-contained.** Write a question file holding the user's request plus
   every fact the answer depends on, since the panel sees nothing else of this conversation.
   Everything in both files leaves for OpenRouter and four vendors: replace customer names,
   personal data, AAC financials and every credential with placeholders, and keep the
   placeholder map in this conversation. Write both files as UTF-8. Done when a stranger could
   answer from the question file alone, and neither file holds a customer name, personal data,
   an AAC financial figure or a credential.

3. **Run the red team.** The script sits in this skill's base directory; run it from anywhere:

   ```bash
   node "<skill base directory>/red-team.js" --question <question.md> --draft <draft.md>
   ```

   Defaults: panel `google/gemini-3.1-pro-preview`, `x-ai/grok-4.7`, `deepseek/deepseek-v4-pro`;
   critic `openai/gpt-5.5`, kept outside the panel so it never judges its own answer.
   `--panel a,b,c` and `--critic m` take any OpenRouter model id; `--max-tokens n` caps each call's
   output (default 16000); `--dry-run` prints the requests without sending. In a cloud container
   the egress proxy injects the key, so no `OPENROUTER_API_KEY` is needed there. Exit 2 `cannot
   read input`: fix the file path. HTTP 402 `requires more credits`: the OpenRouter account is out
   of credits; tell the user to top it up. Exit 2 `OPENROUTER_API_KEY is not set`, a 402, or exit 1
   twice (read `error` and `errors` after the first): skip to step 6 and send the draft marked as
   unchecked, naming what failed. Done when the script exits 0 with a `critique` whose
   `findings` you can read; a `verdict` of `unparsed` means reading the critic's points out of
   `raw` instead.

4. **Integrate.** Read the panel answers before `key`, the label-to-model map printed last. Give
   every finding a ruling: **accept** and revise the draft, or **reject** with the reason
   (evidence the critic lacked, a wrong premise, out of scope). Treat `panelOnly` points as
   findings too. A finding decides on its evidence, never on how many models agree. Done when
   every finding and every `panelOnly` point has a ruling.

5. **Loop at most once.** When an accepted high-severity finding changed the answer's
   recommendation or a key fact, run steps 3 and 4 once more on the revised draft. Done when no
   accepted finding changed the recommendation or a key fact, or the second pass is ruled on.

6. **Send.** The revised answer first, then a short red-team block: verdict, each finding in one
   line with its ruling, the models in `key`, and `usage.cost` in dollars. Put the real names
   and figures back in place of the step 2 placeholders. Done when the block lists every ruling
   from step 4 and the answer holds no placeholder.
