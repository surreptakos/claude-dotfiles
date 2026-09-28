# Do multi-LLM councils beat one strong model?

Research for Dan, 2026-09-28. The question: does running several LLMs together (parallel
ensembles, mixture-of-agents, debate, councils, LLM-as-judge synthesis, red-team or critic stages,
sequential refinement) give more accurate or better answers than one strong model, and if so for
which tasks, with which models in which roles, and in what topology.

Primary sources only: arXiv papers and first-party vendor posts, fetched on 2026-09-28. Each
citation links to a local snapshot under `docs/research/sources/multi-llm-council-2026-09-28/`
holding the source's URL, its abstract and the verbatim passages this note relies on, so
`tools/check-evidence.js` can check every number against the text it came from. Where a paper's
numbers sat in a table or figure the HTML did not carry, the note says less rather than guess.
Anything marked **Inference** is my reading across sources, not a claim any one source makes.

## TL;DR

- **Yes, but most of the lift comes from more samples plus a good selector, not from the conversation.**
  Sampling several answers and voting or synthesising is the robust gain
  ([self-consistency](sources/multi-llm-council-2026-09-28/self-consistency-2203.11171.txt):
  GSM8K "+17.9%"). Once compute is matched, multi-agent debate usually does not beat it: in a
  replication, debate with 9 responses scored 83.0 on GSM8K against 88.2 for self-consistency with 9
  ([Huang et al.](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt)), and
  "Majority Voting alone accounts for most of the performance gains typically attributed to MAD"
  ([Choi et al. 2025](sources/multi-llm-council-2026-09-28/debate-or-vote-2508.17536.txt)).
- **Open-ended and research tasks gain most from synthesis; low-headroom tasks lose.** On a
  deep-research benchmark (DRACO), a fused panel scored 69.0% against 65.3% for the best single
  model, and fusing Opus 4.8 with itself took it from 58.8% to 65.5%
  ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)). Anthropic
  reports a multi-agent research system beat single-agent Claude Opus 4 "by 90.2%" on an internal
  eval ([Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt)). But
  in a controlled 260-configuration study, results ranged "from +80.8% on decomposable financial
  reasoning to -70.0% on sequential planning", and multi-agent setups did slightly worse than one
  agent on SWE-bench Verified
  ([Kim et al., Google and MIT](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)).
- **Agents talking to each other can make answers worse.** Agents conform and flip correct
  answers to wrong ones ([Talk Isn't Always Cheap](sources/multi-llm-council-2026-09-28/talk-not-cheap-2509.05396.txt));
  one 2026 study measured modal adoption of the majority answer "up to 85.5%" and debate costing
  "2.1-3.4" times the tokens of isolated self-correction "for equal or lower accuracy"
  ([Cost of Consensus](sources/multi-llm-council-2026-09-28/cost-of-consensus-2605.00914.txt)).
  So round 1 should be independent, and a critic needs a way to be overruled on the evidence.
- **Mixing vendors helps only when the models are close in quality.** Heterogeneous panels beat
  same-model panels in debate studies
  ([Stop Overvaluing MAD](sources/multi-llm-council-2026-09-28/stop-overvaluing-2502.08788.txt),
  [X-MAS](sources/multi-llm-council-2026-09-28/x-mas-2505.16997.txt)), but a panel built only from
  the single best model beat the mixed one by 6.6 points on AlpacaEval 2.0, because "MoA is highly
  sensitive to proposer quality"
  ([Self-MoA](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt)). The aggregator matters:
  some models are good proposers but poor aggregators
  ([MoA](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt)).
- **Dan's topology holds up in part.** The evidence supports independent drafts, then a
  dedicated adversarial critic, then a single integrator that checks against evidence. MAI-DxO's
  panel has a devil's-advocate "Dr. Challenger" and reaches 85.5% on hard NEJM cases
  ([Microsoft](sources/multi-llm-council-2026-09-28/mai-dxo-2506.22405.txt)), and architectures with
  a central verifier propagate fewer errors
  ([scaling study](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)). *Agents
  collaborate first* is the weak step: exchanging drafts before they are independent is what
  causes the conformity. No source compares looping back to the team against stopping at an
  integrator head to head.

## 1. Does it improve accuracy, and by how much?

### Where the gains are measured

| Method | Benchmark | Single model | Multi-LLM | Source |
|---|---|---|---|---|
| Self-consistency (one model, many samples, vote) | GSM8K | baseline | "+17.9%" | [Wang et al.](sources/multi-llm-council-2026-09-28/self-consistency-2203.11171.txt) |
| Multi-agent debate, 3 agents, 2 rounds | GSM8K | 77.0 | 85.0 (majority vote without debate: 81.0) | [Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt) |
| Same | Arithmetic | 67.0 | 81.8 | [Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt) |
| Same | Biographies (factuality) | 66.0 | 73.8 | [Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt) |
| Mixture-of-Agents, open models only | AlpacaEval 2.0 | GPT-4 Omni 57.5% | 65.1% | [Wang et al. 2024](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt) |
| Self-MoA (best model sampled many times, then aggregated) | AlpacaEval 2.0; MMLU, CRUX, MATH | Mixed MoA | +6.6%; average +3.8% | [Li et al. 2025](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt) |
| ReConcile (ChatGPT, Bard, Claude2 round table) | seven reasoning benchmarks | prior baselines | "up to 11.4%" | [Chen et al.](sources/multi-llm-council-2026-09-28/reconcile-2309.13007.txt) |
| OpenRouter Fusion (panel, judge, synthesis) | DRACO deep research, 100 tasks | Fable 5 65.3%, GPT-5.5 60.0%, Opus 4.8 58.8% | Fable 5 + GPT-5.5: 69.0% | [OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt) |
| Anthropic Research (Opus 4 lead, Sonnet 4 subagents) | internal research eval | single-agent Opus 4 | outperformed it by 90.2% | [Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt) |
| MAI-DxO (orchestrated virtual doctor panel) | 304 NEJM-CPC cases | generalist physicians 20% | 80% with o3; 85.5% at max accuracy | [Nori et al.](sources/multi-llm-council-2026-09-28/mai-dxo-2506.22405.txt) |
| LLM crowd of twelve models | 31 binary forecasting questions | — | "not statistically different from the human crowd" of 925 | [Schoenegger et al.](sources/multi-llm-council-2026-09-28/silicon-crowd-2402.19379.txt) |

Caveats that come with these numbers:

- The Fusion Fable 5 figures cover 93 of 100 tasks: "7 of the 100 DRACO tasks were not completed
  because Fable 5’s content filters blocked them". OpenRouter graded with Gemini 3.1 Pro Preview,
  and DRACO scores shift "10–25 point" between judges, "though relative system rankings remain
  stable" ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)).
  It is a vendor benchmark of its own product.
- Anthropic's 90.2% is on an internal eval that is not published
  ([Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt)).

### When it does not help

**Compute-matched baselines erase most debate gains.** Huang et al. re-ran Du et al.'s debate on
the full GSM8K test set with gpt-3.5-turbo-0301, "3 agents and 2 rounds of debate". Standard
prompting scored 76.7. Self-consistency with 3, 6 and 9 responses scored 82.5, 85.3 and 88.2;
debate with 6 and 9 responses scored 83.2 and 83.0. Their reading: "multi-agent debate
significantly underperforms simple self-consistency using majority voting"
([Huang et al.](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt)). Later
studies agree:

- MAD systems "do not reliably outperform other proposed prompting strategies, such as
  self-consistency and ensembling using multiple reasoning paths", though tuning helps
  ([Smit et al.](sources/multi-llm-council-2026-09-28/should-we-go-mad-2311.17371.txt)).
- Across 5 MAD methods, 9 benchmarks and 4 models, "MAD often fail to outperform simple
  single-agent baselines such as Chain-of-Thought and Self-Consistency, even when consuming
  significantly more inference-time computation"
  ([Zhang et al. 2025](sources/multi-llm-council-2026-09-28/stop-overvaluing-2502.08788.txt)).
- "Majority Voting alone accounts for most of the performance gains typically attributed to MAD";
  debate "induces a martingale over agents' belief trajectories, implying that debate alone does
  not improve expected correctness"
  ([Choi et al. 2025](sources/multi-llm-council-2026-09-28/debate-or-vote-2508.17536.txt)).
- For math, "MAD offers limited advantages over self-agent scaling but becomes more effective with
  increased problem difficulty and decreased model capability"
  ([Revisiting MAD, 2025](sources/multi-llm-council-2026-09-28/revisiting-mad-2505.22960.txt)).
- On open-ended opinion questions, "For final answers, debate brings no measurable quality gain"
  across "all 299 pairs"
  ([Layered analysis, September 2026](sources/multi-llm-council-2026-09-28/layered-debate-2609.08016.txt)).

**Conformity and sycophancy between agents.**

- "models frequently shift from correct to incorrect answers in response to peer reasoning,
  favoring agreement over challenging flawed reasoning", even "where stronger (i.e., more capable)
  models outnumber their weaker counterparts". Telling agents they are paid for correctness did not
  fix it ([Wynn et al. 2025](sources/multi-llm-council-2026-09-28/talk-not-cheap-2509.05396.txt)).
- With 10 homogeneous 7-8B agents: sycophantic conformity with "modal adoption up to 85.5%", contextual fragility with a
  "vulnerability rate up to 70.0%", and "consensus collapse, where
  plurality voting discards correct answers already present in the generation pool (oracle gap up
  to 32.3 percentage points)"
  ([Cost of Consensus, 2026](sources/multi-llm-council-2026-09-28/cost-of-consensus-2605.00914.txt)).
- "strict conformity is 29% in the primary setting and remains predominantly harmful across model
  replications (57-77% correct-to-wrong)", and "even vacuous reasoning is associated with 20-39%
  error adoption among resistant agents"
  ([Not All Flips Are Conformity, 2026](sources/multi-llm-council-2026-09-28/not-all-flips-2606.00820.txt)).
- Identity bias is "widespread, with sycophancy far more common than self-bias"; stripping model
  identities from the transcript reduces it
  ([Identity bias](sources/multi-llm-council-2026-09-28/identity-bias-2510.07517.txt)). Telling
  agents how sycophantic each peer is "improves final discussion accuracy by an absolute 10.5%"
  ([Too Polite to Disagree, 2026](sources/multi-llm-council-2026-09-28/too-polite-2604.02668.txt)).
- Du et al. already saw this: agents were relatively "agreeable", and prompts making them more
  stubborn "led to longer debates and better final solutions"
  ([Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt)).

**One bad panelist can wreck the aggregate.** In a 3-layer MoA of 6 agents on AlpacaEval 2.0, a
single carefully instructed deceptive agent cut LC win rate from 49.2% to 37.9%, "effectively
nullifying all MoA gains"; on QuALITY accuracy fell "by a staggering 48.5%"
([Doge paper](sources/multi-llm-council-2026-09-28/doge-moa-deception-2503.05856.txt)). This was a
deliberately adversarial agent; ordinary errors are milder.

**More calls is not monotone.** Voting accuracy "can first increase but then decrease as a function
of the number of LM calls": more calls help on "easy" queries and hurt on "hard" ones
([Chen et al. 2024](sources/multi-llm-council-2026-09-28/more-calls-2403.02419.txt)). Compare
[More Agents Is All You Need](sources/multi-llm-council-2026-09-28/more-agents-2402.05120.txt), which
finds sampling-and-voting scales with agent count on its benchmarks.

**Capability saturation and task shape.** In 260 controlled configurations with matched token
budgets, "tasks where single-agent performance already exceeds 45% accuracy experience negative
returns", tool-heavy tasks pay coordination overhead, and "Independent systems amplify trace-level
errors" while centralized coordination contains them
([Towards a Science of Scaling Agent Systems, December 2025](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)).

**Why multi-agent systems fail.** Across 1600+ traces from 7 frameworks, MAST finds 14 failure
modes in three groups: system design, inter-agent misalignment, and task verification. Examples:
step repetition 15.7%, disobeying the task spec 11.8%, incomplete verification 8.20%, incorrect
verification 9.10%. "many existing verifiers perform only superficial checks"
([Cemri et al. 2025](sources/multi-llm-council-2026-09-28/mast-2503.13657.txt)).

**Self-critique without outside feedback is unreliable.** "LLMs struggle to self-correct their
responses without external feedback, and at times, their performance even degrades after
self-correction" ([Huang et al.](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt)).
Self-Refine reports "~20% absolute" gains across 7 tasks "ranging from dialog response generation
to mathematical reasoning", but there the same model critiques itself with no outside check
([Madaan et al.](sources/multi-llm-council-2026-09-28/self-refine-2303.17651.txt)).

**Cost and latency.** Anthropic: "agents typically use about 4× more tokens than chat interactions,
and multi-agent systems use about 15× more tokens than chats"
([Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt)). OpenRouter:
the default three-model Fusion panel "costs roughly four to five times as much as one completion on
the same prompt and often takes two to three times longer"
([OpenRouter explainer](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt)).

## 2. Which task types benefit most

| Task | Evidence | Verdict |
|---|---|---|
| Research / fact-finding | Anthropic: multi-agent "excel especially for breadth-first queries"; "token usage by itself explains 80% of the variance" on BrowseComp ([Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt)). Fusion on DRACO: every fused panel beat its members ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)). But on BrowseComp-Plus, "independent agents catastrophically underperforming relative to SAS (-35%)" ([scaling study](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)). | **Strongest case**, if a lead agent coordinates and synthesises. Uncoordinated parallel agents can do worse. |
| Writing / document authoring | MoA's AlpacaEval 2.0 lead ([MoA](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt)); Self-MoA's +6.6 ([Self-MoA](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt)). STORM's multi-perspective pre-writing: more articles judged organized "(by a 25% absolute increase)" and broad "(by 10%)" ([Shao et al.](sources/multi-llm-council-2026-09-28/storm-2402.14207.txt)). Self-Refine ~20% on generation tasks ([Madaan et al.](sources/multi-llm-council-2026-09-28/self-refine-2303.17651.txt)). | **Good case.** Caveat: these are judged by LLMs, which prefer longer text (section 3). |
| Advice / expert judgment | MAI-DxO 85.5% on NEJM-CPC; gains "generalize across models from the OpenAI, Gemini, Claude, Grok, DeepSeek, and Llama families" ([Nori et al.](sources/multi-llm-council-2026-09-28/mai-dxo-2506.22405.txt)). Forecasting crowd of LLMs matches the human crowd ([Schoenegger et al.](sources/multi-llm-council-2026-09-28/silicon-crowd-2402.19379.txt)). OpenRouter recommends Fusion for "expert critique, and decisions where an incorrect answer creates more cost" ([explainer](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt)). | **Good case** when the panel has roles (hypothesis, challenger, checklist). Opinion-style debate showed no gain ([layered analysis](sources/multi-llm-council-2026-09-28/layered-debate-2609.08016.txt)). |
| Math / closed-answer reasoning | Debate raises GSM8K 77.0 to 85.0 ([Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt)), but self-consistency matches or beats it at equal compute ([Huang et al.](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt)). Mixing a chatbot and a reasoner: "a remarkable 47% performance boost on the AIME dataset" ([X-MAS](sources/multi-llm-council-2026-09-28/x-mas-2505.16997.txt)). | **Use voting.** Debate and councils add cost for little over self-consistency. |
| Coding | On SWE-bench Verified, "all MAS architectures show slight degradation relative to SAS (mean 0.522)" ([scaling study](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)). A trained critic's critiques were "preferred over human critiques in 63% of cases" and caught more bugs than paid contractors, though critics can hallucinate bugs ([CriticGPT](sources/multi-llm-council-2026-09-28/criticgpt-2407.00215.txt)). Universal self-consistency "matches the execution-based voting performance on code generation" ([Chen et al.](sources/multi-llm-council-2026-09-28/usc-2311.17311.txt)). OpenRouter: "Fusion isn’t a drop-in replacement for coding models" ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)). | **Weak for writing code; good for reviewing it.** Tests are the real verifier; a critic stage helps. |
| Factuality / hallucination | Debate improved biographies 66.0 to 73.8 and MMLU 63.9 to 71.1 ([Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt)). Adversarial debate helped a weaker judge: "76% and 88% accuracy" for model and human judges against "48% and 60%" baselines ([Khan et al.](sources/multi-llm-council-2026-09-28/debate-persuasive-2402.06782.txt)). | **Moderate case.** Cross-checking helps, but conformity can spread a confident error (section 1). |

## 3. Model diversity and roles

**Heterogeneous panels: mostly better, but quality comes first.**

- For diversity: ReConcile finds "the diversity originating from different models is critical to
  its superior performance" ([Chen et al.](sources/multi-llm-council-2026-09-28/reconcile-2309.13007.txt)).
  After 4 rounds of debate, a mixed set (Gemini-Pro, Mixtral, PaLM 2-M) scored 91% on GSM-8K,
  against 82% for 3 Gemini-Pro instances
  ([Hegazy](sources/multi-llm-council-2026-09-28/diversity-debate-2410.12853.txt)). Model
  heterogeneity is "a universal antidote to consistently improve current MAD frameworks"
  ([Zhang et al.](sources/multi-llm-council-2026-09-28/stop-overvaluing-2502.08788.txt)). Moving to
  heterogeneous models yields "up to 8.4% performance improvement on the MATH dataset"
  ([X-MAS](sources/multi-llm-council-2026-09-28/x-mas-2505.16997.txt)). In the original MoA,
  "using multiple different LLMs consistently yielded better results" than one model sampled
  several times ([MoA](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt)).
- Against: Self-MoA "outperforms standard MoA that mixes different LLMs in a large number of
  scenarios", and "mixing different LLMs often lowers the average quality of the models". Mixed-MoA
  won only narrowly, by 0.17% and 0.35%, in its best case
  ([Li et al.](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt)). For math debate,
  "agent diversity shows little benefit"
  ([Revisiting MAD](sources/multi-llm-council-2026-09-28/revisiting-mad-2505.22960.txt)).
- Frontier data point: on DRACO, Opus 4.8 + GPT-5.5 scored 67.6% and Opus 4.8 + Opus 4.8 scored
  65.5%, both synthesized by Opus 4.8, so mixing vendors added about 2 points on top of the 6.7 that
  self-fusion gave ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)).
  **Inference:** at the frontier, most of the lift comes from sampling plus synthesis, and vendor
  diversity is a smaller extra.
- 2026 synthesis: choose proposers by complementarity, "where the value of an LLM lies in its
  complementarity with others", not by accuracy or diversity alone
  ([Mixture of Complementary Agents](sources/multi-llm-council-2026-09-28/complementary-agents-2605.24048.txt)).

**Roles are not interchangeable.**

- MoA: "GPT-4o, Qwen, LLaMA-3 emerged as a versatile model effective in both assisting and
  aggregating tasks. In contrast, WizardLM demonstrated excellent performance as an proposer model
  but struggled to maintain its effectiveness in aggregating responses from other models". A
  generating aggregator "significantly outperforms an LLM-ranker" that just picks one answer
  ([MoA](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt)).
- X-MAS scores 27 LLMs on five agent functions (question-answering, revise, aggregation, planning,
  evaluation) and finds "No single LLM excels universally", and that size is not destiny: in
  revise-coding, "Qwen2.5-7B-Instruct (79.2) outperforms Qwen2.5-72B-Instruct (77.3)"
  ([X-MAS](sources/multi-llm-council-2026-09-28/x-mas-2505.16997.txt)).
- A task-specific aggregator adds "1-2 points"
  ([Self-MoA](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt)).
- Every Fusion panel OpenRouter published used Opus 4.8 as synthesizer, and its `general-budget`
  preset pairs "cheaper panelists with a frontier judge"
  ([announcement](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt),
  [explainer](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt)).
  **Inference:** use the strongest model you have as integrator; proposers can be cheaper.

**By model family (thin evidence; treat as anecdotes, not rankings):**

- On Finance Agent, centralized multi-agent gains were "+127.5%" for Anthropic, "+164.3%" for
  Google and "+69.9%" for OpenAI models; on PlanCraft all three degraded. "No vendor achieves
  universal multi-agent dominance"
  ([scaling study](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)).
- In MetaGPT coding runs, GPT-4o "generally performs better than Claude" 3.7 Sonnet, with 39%
  fewer system-design failures ([MAST](sources/multi-llm-council-2026-09-28/mast-2503.13657.txt)).
- On DRACO solo, DeepSeek V4 Pro (60.3%) matched GPT-5.5 (60.0%) and Opus 4.8 (58.8%); OpenRouter
  suspects Opus "would score higher with a larger tool-calling budget". A budget panel of Gemini 3
  Flash, Kimi K2.6 and DeepSeek V4 Pro scored 64.7%, "within 1% of Fable 5’s score while being 50%
  of the cost" ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)).
- MAI-DxO's gains held across the OpenAI, Gemini, Claude, Grok, DeepSeek and Llama families
  ([Nori et al.](sources/multi-llm-council-2026-09-28/mai-dxo-2506.22405.txt)).
- No source here isolates Grok in a proposer, aggregator or critic role.

**Judge biases:**

- Position: "Most LLM judges favor the first position"; "Only GPT-4 outputs consistent results in
  more than 60% of cases" ([Zheng et al.](sources/multi-llm-council-2026-09-28/mt-bench-judge-2306.05685.txt)).
  Swapping order let Vicuna-13B "beat ChatGPT on 66 over 80 tested queries with ChatGPT as an
  evaluator" ([Wang et al.](sources/multi-llm-council-2026-09-28/not-fair-evaluators-2305.17926.txt)).
- Self-preference: "GPT-4 favors itself with a 10% higher win rate; Claude-v1 favors itself with a
  25% higher win rate", though the authors could not say it was a real self-favouring effect
  ([Zheng et al.](sources/multi-llm-council-2026-09-28/mt-bench-judge-2306.05685.txt)). Models
  recognise their own text, with "a linear correlation between self-recognition capability and the
  strength of self-preference bias"
  ([Panickssery et al.](sources/multi-llm-council-2026-09-28/self-recognition-2404.13076.txt)).
  The bias tracks familiarity: judges rate "outputs with lower perplexity" higher, "regardless of
  whether the outputs were self-generated"
  ([Wataoka et al.](sources/multi-llm-council-2026-09-28/self-preference-2410.21819.txt)).
  And "LLMs might not be a fair judge if different LLMs are used for agents"
  ([Liang et al.](sources/multi-llm-council-2026-09-28/mad-divergent-2305.19118.txt)).
- Verbosity: "GPT-4 prefers longer answers more than humans"
  ([Saito et al.](sources/multi-llm-council-2026-09-28/verbosity-bias-2310.10076.txt)). DRACO
  counters length-gaming with negative-weight criteria
  ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)).
- Judge choice alone moves DRACO scores "10–25 point"
  ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)).

## 4. Topology: what the evidence says about Dan's pipeline

Dan's recollection: *agents collaborate first, then pass the result to a red-team agent, then to a
final integrator or back to the team.* Taking it step by step:

**Round 1 should be independent, not collaborative. Supported.**

- Anthropic's subagents "operating in parallel with their own context windows" provide
  "separation of concerns", which "reduces path dependency and enables thorough, independent
  investigations" ([Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt)).
- Fusion's panelists "independently answer the prompt" before the judge sees them
  ([explainer](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt)).
- Conformity "reaches high levels at minimal peer exposure ($K{=}2$) and intensifies with greater
  initial diversity" ([Cost of Consensus](sources/multi-llm-council-2026-09-28/cost-of-consensus-2605.00914.txt)).
- A "diversity-aware initialisation" that raises the chance "that a correct hypothesis is present
  at the start of debate", plus confidence-weighted updates, beat both vanilla MAD and majority
  vote on six QA benchmarks ([Demystifying MAD, 2026](sources/multi-llm-council-2026-09-28/demystifying-mad-2601.19921.txt)).
- **Inference:** *collaborate first* should mean *draft independently, then share*. Letting agents
  see each other's drafts before committing is where anchoring and conformity come from.

**Aggregate by synthesis for open-ended work, by vote for checkable answers. Supported.**
MoA's generating aggregator beats selection
([MoA](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt)). Fusion's judge maps "consensus,
contradictions, partial coverage, unique insights, and blind spots" rather than voting, since
"Three models repeating the same unsupported claim don’t automatically make that claim correct"
([explainer](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt)). For
closed-answer tasks, voting captures most of the gain
([Choi et al.](sources/multi-llm-council-2026-09-28/debate-or-vote-2508.17536.txt)); universal
self-consistency extends LLM-picked "most consistent" answers to free-form output
([Chen et al.](sources/multi-llm-council-2026-09-28/usc-2311.17311.txt)).

**A dedicated adversarial critic helps when it has a defined job. Supported with caveats.**

- MAI-DxO's "Dr. Challenger – Acts as devil’s advocate by identifying potential anchoring bias,
  highlighting contradictory evidence, and proposing tests that could falsify the current leading
  diagnosis". The authors credit that adversarial role when MAI-DxO "often sought disconfirming
  evidence and switched its diagnostic path", while plain o3 "seemed to anchor on initial
  impressions" ([Nori et al.](sources/multi-llm-council-2026-09-28/mai-dxo-2506.22405.txt)).
- Liang et al.'s angel/devil debate with a judge counters "Degeneration-of-Thought" in
  self-reflection, but needs "the adaptive break of debate" and only a modest level of tit-for-tat
  ([Liang et al.](sources/multi-llm-council-2026-09-28/mad-divergent-2305.19118.txt)).
  Tuning agreement intensity gave "a substantial (15%) improvement in performance for
  Multi-Persona" ([Smit et al.](sources/multi-llm-council-2026-09-28/should-we-go-mad-2311.17371.txt)).
- A trained code critic catches more bugs than contractors, but can produce "hallucinated bugs
  that could mislead humans"; human-plus-critic teams hallucinate less
  ([CriticGPT](sources/multi-llm-council-2026-09-28/criticgpt-2407.00215.txt)).
- The risk: critique is persuasion, and persuasion flips correct answers
  ([Wynn et al.](sources/multi-llm-council-2026-09-28/talk-not-cheap-2509.05396.txt)). Even
  "vacuous reasoning" moved 20-39% of resistant agents
  ([Not All Flips](sources/multi-llm-council-2026-09-28/not-all-flips-2606.00820.txt)).
  **Inference:** the red-team's findings should go to an integrator that must check each one
  against evidence (sources, tests), not to a vote of the drafting agents.

**A central integrator or verifier is better than none. Supported.** "architectures without
centralized verification tend to propagate errors more than those with centralized coordination"
([scaling study](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt)). Verification
failures (premature termination, missing and incorrect verification) make up a whole MAST
category, and "many existing verifiers perform only superficial checks"
([MAST](sources/multi-llm-council-2026-09-28/mast-2503.13657.txt)).

**Loop back to the team, or stop at the integrator? Not settled.** No source compares these head
to head. Related evidence:

- Du et al. used 2 rounds and "found further gains with both more agents and rounds of debate"
  ([Du et al.](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt)).
- Later work finds accuracy falling as rounds go on, with correct-to-incorrect flips outnumbering
  the reverse ([Wynn et al.](sources/multi-llm-council-2026-09-28/talk-not-cheap-2509.05396.txt)).
  In Huang's replication, round 2 did not beat round 1 (83.0 against 83.2)
  ([Huang et al.](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt)).
- MoA's full version uses 3 layers; a 2-layer MoA-Lite is offered as the cheaper variant
  ([MoA](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt)). Sequential Self-MoA "is as
  effective as aggregating all outputs at once"
  ([Self-MoA](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt)).
- Self-correction without outside feedback can degrade answers
  ([Huang et al.](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt)).
- **Inference:** loop back only when the red-team found a specific, checkable defect that needs
  new work (a missing source, a failing test), and cap it at one extra round. Otherwise the
  integrator should fix and finish.

## 5. Industry products and vendor data

**OpenRouter Fusion.** Announced in a post dated 6/12/2026, "Surpassing Frontier Performance with
Fusion" ([OpenRouter](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt)):

- *What it is:* "we dispatch it to a panel of models in parallel, each with web search and web
  fetch enabled. A judge model reads every panel response and produces structured analysis"; "The
  calling model then writes the final answer grounded in that analysis."
- *Benchmark:* "100 deep research tasks from the DRACO benchmark" (by Perplexity AI), each with a
  rubric of "roughly 39 weighted criteria" covering factual accuracy, breadth and depth,
  presentation and citation quality. Scores: Fable 5 + GPT-5.5 69.0%; Opus 4.8 + GPT-5.5 + Gemini
  3.1 Pro 68.3%; Opus 4.8 + GPT-5.5 67.6%; Opus 4.8 + Opus 4.8 65.5%; budget panel 64.7%; solo
  Fable 5 65.3%, DeepSeek V4 Pro 60.3%, GPT-5.5 60.0%, Opus 4.8 58.8%, Kimi K2.6 53.7%, Gemini 3.1
  Pro 45.4%, Gemini 3 Flash 43.1%. All panels were synthesized by Opus 4.8.
- *Self-fusion:* "a 6.7-point jump over solo Opus 4.8" suggests "a meaningful chunk of Fusion’s
  lift comes from the synthesis step itself, not just from combining different model
  architectures".
- *Contamination:* panelists with web search were "finding the DRACO grading rubric online";
  OpenRouter excluded those domains.
- *Limits, from its own FAQ:* not a replacement for Fable ("DRACO also doesn’t include
  long-horizon tasks"); for coding, the model should call Fusion only for things like
  "architecture decisions or research on best practice approaches"; when invoked it is "often 2-3x
  longer than a standard call".

The explainer ([OpenRouter, 9/10/2026](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt))
adds: panels of "Between one and eight participant models"; roughly 4-5x the cost of one
completion; results are "Non-deterministic by design"; and it tells you to skip it for
latency-sensitive paths, for evals and regression suites, and for "simple, well-scoped tasks a
single mid-tier model already handles". It recommends "selective escalation".

**Anthropic, "How we built our multi-agent research system"**
(published Jun 13, 2025; [Anthropic](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt)):

- It is an orchestrator-worker design, not a council.
- "Multi-agent systems work mainly because they help spend enough tokens to solve the problem."
- On BrowseComp, "three factors explained 95% of the performance variance", and "token usage by
  itself explains 80% of the variance, with the number of tool calls and the model choice as the
  two other explanatory factors".
- Costs: about 4× the tokens of chat for agents and 15× for multi-agent systems. Domains "that
  require all agents to share the same context or involve many dependencies between agents are not
  a good fit".
- Failure modes seen: "spawning 50 subagents for simple queries". Effort is now scaled to the
  query: "Simple fact-finding requires just 1 agent with 3-10 tool calls".
- Evaluation: one LLM judge scoring against a rubric, plus human testers, who caught agents
  preferring "SEO-optimized content farms".
- **Inference:** Anthropic's lift comes from parallel search with separate contexts, not from
  models arguing. It supports *more independent work, synthesised by a lead*, not debate.

**Other first-party data (briefer):**

- xAI says Grok 4 Heavy uses "parallel test-time compute, which allows Grok to consider multiple
  hypotheses at once" and is "the first model to score 50% on Humanity's Last Exam"
  ([xAI](sources/multi-llm-council-2026-09-28/xai-grok-4.txt)).
- Google says Gemini 2.5 Deep Think uses "parallel thinking techniques" to "generate many ideas at
  once and consider them simultaneously, even revising or combining different ideas over time"
  (Aug 01, 2025; [Google](sources/multi-llm-council-2026-09-28/google-deep-think.txt)).
- Both are single-vendor parallel sampling with internal aggregation, the same pattern Self-MoA
  studies. No OpenAI first-party council data was gathered for this note.

## Recommended design for Dan's red-team setup (Inference)

**Everything in this section is inference** from the sources above, not a result any one of them
reports.

1. **Escalate, don't default.** Run the council only on high-stakes research, advice and document
   work, as OpenRouter and Anthropic both advise. Skip it for simple tasks and closed-answer
   questions: sample the strong model several times and vote instead
   ([explainer](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt),
   [Choi et al.](sources/multi-llm-council-2026-09-28/debate-or-vote-2508.17536.txt)).
2. **Stage 1, independent drafts (3 proposers).** Give them no view of each other. Use two or three
   frontier models close in quality, or the single best model sampled several times if the others
   are clearly weaker ([Self-MoA](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt)).
   For research, give each a distinct sub-question and its own tools, as Anthropic's subagents do.
3. **Stage 2, integrator drafts a synthesis.** Use the strongest model. Have it list consensus,
   contradictions, unique claims and gaps (the Fusion judge's categories) before writing. Strip
   model names from the drafts to reduce identity and self-preference bias
   ([identity bias](sources/multi-llm-council-2026-09-28/identity-bias-2510.07517.txt)).
4. **Stage 3, a red-team with a narrow brief.** A Dr. Challenger-style job: find anchoring,
   contradicting evidence, and the claim most likely to be wrong, each finding tied to a source or
   a test. Use a different vendor from the integrator where possible, to avoid self-preference.
5. **Stage 4, the integrator rules on each finding against evidence.** Accept, reject or verify
   each one. Do not put findings to a vote of the drafters, and do not let the critic's
   confidence decide.
6. **Loop at most once,** and only for a concrete defect that needs new work. More rounds show
   falling returns and growing conformity.
7. **Measure it.** Keep 10-20 real prompts with rubrics and compare against the single strong model
   at matched cost. Judge in both answer orders with a judge that is not the integrator's model, and
   penalise length.

## Sources

Snapshots with the verbatim passages used are under
[the snapshot folder's first file](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt) and its
siblings; each file's first line gives the original URL.

Foundational:

- [Wang et al. — Self-Consistency](sources/multi-llm-council-2026-09-28/self-consistency-2203.11171.txt) — https://arxiv.org/abs/2203.11171
- [Du et al. — Multiagent Debate](sources/multi-llm-council-2026-09-28/du-debate-2305.14325.txt) — https://arxiv.org/abs/2305.14325
- [Liang et al. — MAD, divergent thinking](sources/multi-llm-council-2026-09-28/mad-divergent-2305.19118.txt) — https://arxiv.org/abs/2305.19118
- [Madaan et al. — Self-Refine](sources/multi-llm-council-2026-09-28/self-refine-2303.17651.txt) — https://arxiv.org/abs/2303.17651
- [Huang et al. — LLMs Cannot Self-Correct Reasoning Yet](sources/multi-llm-council-2026-09-28/cannot-self-correct-2310.01798.txt) — https://arxiv.org/abs/2310.01798
- [Zheng et al. — Judging LLM-as-a-Judge](sources/multi-llm-council-2026-09-28/mt-bench-judge-2306.05685.txt) — https://arxiv.org/abs/2306.05685
- [Wang et al. — LLMs are not Fair Evaluators](sources/multi-llm-council-2026-09-28/not-fair-evaluators-2305.17926.txt) — https://arxiv.org/abs/2305.17926
- [Saito et al. — Verbosity Bias](sources/multi-llm-council-2026-09-28/verbosity-bias-2310.10076.txt) — https://arxiv.org/abs/2310.10076
- [Jiang et al. — LLM-Blender](sources/multi-llm-council-2026-09-28/llm-blender-2306.02561.txt) — https://arxiv.org/abs/2306.02561
- [Chen et al. — ReConcile](sources/multi-llm-council-2026-09-28/reconcile-2309.13007.txt) — https://arxiv.org/abs/2309.13007
- [Chen et al. — Universal Self-Consistency](sources/multi-llm-council-2026-09-28/usc-2311.17311.txt) — https://arxiv.org/abs/2311.17311
- [Smit et al. — Should we be going MAD?](sources/multi-llm-council-2026-09-28/should-we-go-mad-2311.17371.txt) — https://arxiv.org/abs/2311.17371
- [Li et al. — More Agents Is All You Need](sources/multi-llm-council-2026-09-28/more-agents-2402.05120.txt) — https://arxiv.org/abs/2402.05120
- [Chen et al. — Are More LLM Calls All You Need?](sources/multi-llm-council-2026-09-28/more-calls-2403.02419.txt) — https://arxiv.org/abs/2403.02419
- [Khan et al. — Debating with More Persuasive LLMs](sources/multi-llm-council-2026-09-28/debate-persuasive-2402.06782.txt) — https://arxiv.org/abs/2402.06782
- [Shao et al. — STORM](sources/multi-llm-council-2026-09-28/storm-2402.14207.txt) — https://arxiv.org/abs/2402.14207
- [Schoenegger et al. — Wisdom of the Silicon Crowd](sources/multi-llm-council-2026-09-28/silicon-crowd-2402.19379.txt) — https://arxiv.org/abs/2402.19379
- [Panickssery et al. — LLM Evaluators Favor Their Own Generations](sources/multi-llm-council-2026-09-28/self-recognition-2404.13076.txt) — https://arxiv.org/abs/2404.13076
- [Wang et al. — Mixture-of-Agents](sources/multi-llm-council-2026-09-28/moa-2406.04692.txt) — https://arxiv.org/abs/2406.04692
- [McAleese et al. — LLM Critics Help Catch LLM Bugs (CriticGPT)](sources/multi-llm-council-2026-09-28/criticgpt-2407.00215.txt) — https://arxiv.org/abs/2407.00215
- [Hegazy — Diversity of Thought in MAD](sources/multi-llm-council-2026-09-28/diversity-debate-2410.12853.txt) — https://arxiv.org/abs/2410.12853
- [Wataoka et al. — Self-Preference Bias in LLM-as-a-Judge](sources/multi-llm-council-2026-09-28/self-preference-2410.21819.txt) — https://arxiv.org/abs/2410.21819

2025-2026:

- [Li et al. — Rethinking Mixture-of-Agents (Self-MoA)](sources/multi-llm-council-2026-09-28/self-moa-2502.00674.txt) — https://arxiv.org/abs/2502.00674
- [Zhang et al. — Stop Overvaluing Multi-Agent Debate](sources/multi-llm-council-2026-09-28/stop-overvaluing-2502.08788.txt) — https://arxiv.org/abs/2502.08788
- [Google — Co-Scientist](sources/multi-llm-council-2026-09-28/co-scientist-2502.18864.txt) — https://arxiv.org/abs/2502.18864 (background only; not cited for numbers)
- [Doge paper — Deception and Robustness in MoA](sources/multi-llm-council-2026-09-28/doge-moa-deception-2503.05856.txt) — https://arxiv.org/abs/2503.05856
- [Cemri et al. — Why Do Multi-Agent LLM Systems Fail? (MAST)](sources/multi-llm-council-2026-09-28/mast-2503.13657.txt) — https://arxiv.org/abs/2503.13657
- [X-MAS — Heterogeneous LLM MAS](sources/multi-llm-council-2026-09-28/x-mas-2505.16997.txt) — https://arxiv.org/abs/2505.16997
- [Revisiting MAD as Test-Time Scaling](sources/multi-llm-council-2026-09-28/revisiting-mad-2505.22960.txt) — https://arxiv.org/abs/2505.22960
- [Nori et al. — Sequential Diagnosis (MAI-DxO)](sources/multi-llm-council-2026-09-28/mai-dxo-2506.22405.txt) — https://arxiv.org/abs/2506.22405
- [Choi et al. — Debate or Vote](sources/multi-llm-council-2026-09-28/debate-or-vote-2508.17536.txt) — https://arxiv.org/abs/2508.17536
- [Wynn et al. — Talk Isn't Always Cheap](sources/multi-llm-council-2026-09-28/talk-not-cheap-2509.05396.txt) — https://arxiv.org/abs/2509.05396
- [When Identity Skews Debate](sources/multi-llm-council-2026-09-28/identity-bias-2510.07517.txt) — https://arxiv.org/abs/2510.07517
- [Towards a Science of Scaling Agent Systems](sources/multi-llm-council-2026-09-28/scaling-agents-2512.08296.txt) — https://arxiv.org/abs/2512.08296
- [Demystifying Multi-Agent Debate](sources/multi-llm-council-2026-09-28/demystifying-mad-2601.19921.txt) — https://arxiv.org/abs/2601.19921
- [Too Polite to Disagree](sources/multi-llm-council-2026-09-28/too-polite-2604.02668.txt) — https://arxiv.org/abs/2604.02668
- [The Cost of Consensus](sources/multi-llm-council-2026-09-28/cost-of-consensus-2605.00914.txt) — https://arxiv.org/abs/2605.00914
- [Mixture of Complementary Agents](sources/multi-llm-council-2026-09-28/complementary-agents-2605.24048.txt) — https://arxiv.org/abs/2605.24048
- [Not All Flips Are Conformity](sources/multi-llm-council-2026-09-28/not-all-flips-2606.00820.txt) — https://arxiv.org/abs/2606.00820
- [What Does Multi-Agent LLM Debate Actually Change?](sources/multi-llm-council-2026-09-28/layered-debate-2609.08016.txt) — https://arxiv.org/abs/2609.08016

Vendor:

- [Anthropic — How we built our multi-agent research system](sources/multi-llm-council-2026-09-28/anthropic-multi-agent-research.txt) — https://www.anthropic.com/engineering/multi-agent-research-system
- [OpenRouter — Surpassing Frontier Performance with Fusion](sources/multi-llm-council-2026-09-28/openrouter-fusion-announcement.txt) — https://openrouter.ai/blog/announcements/fusion-beats-frontier/
- [OpenRouter — Fusion: How It Works and When to Use It](sources/multi-llm-council-2026-09-28/openrouter-fusion-explainer.txt) — https://openrouter.ai/blog/insights/fusion-explainer/
- [xAI — Grok 4](sources/multi-llm-council-2026-09-28/xai-grok-4.txt) — https://x.ai/news/grok-4
- [Google — Gemini 2.5 Deep Think](sources/multi-llm-council-2026-09-28/google-deep-think.txt) — https://blog.google/products/gemini/gemini-2-5-deep-think/

`openrouter.ai/fusion` itself renders client-side and returned only its title to a plain fetch;
the two OpenRouter blog posts above are the readable primary sources for it.
