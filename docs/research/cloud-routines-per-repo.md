# Cloud Routines: one hourly Routine per repo bound to a master session

Research for ticket #158 (part of #154). Primary sources: [Automate work with routines](https://code.claude.com/docs/en/routines) and [Run prompts on a schedule](https://code.claude.com/docs/en/scheduled-tasks) (code.claude.com, fetched 2026-09-14), the local `/schedule` skill
(`C:\Users\Dan\AppData\Roaming\Claude\local-agent-mode-sessions\skills-plugin\...\skills\schedule\SKILL.md`,
three identical copies found), the `scheduled-tasks` MCP tool descriptions (in-session), issue #158, issue #44
(`gh issue view 44 --repo surreptakos/claude-dotfiles --comments`), `orchestrator/RUNBOOK.md`,
`orchestrator/LOCAL-RUNBOOK.md`. Quotes are cited inline; anything not quoted is inference, labeled as such.

## 1. Creation and binding — the central finding

`RUNBOOK.md` and issue #44 describe the cloud master as a **persistent session** that a Routine wakes
hourly, rebuilt via `update_trigger` with a new `persistent_session_id` at "master rebirth", and workers
spawned with `create_session(source_url = repo)`. Current Anthropic docs describe a **different**
mechanism:

- A Routine is "a saved Claude Code configuration: a prompt, one or more repositories, and a set of
  connectors, packaged once and run automatically" (routines doc). It stores a **prompt**, not a
  session pointer.
- "Each run creates a new session alongside your other sessions" (routines doc, Create a routine step).
- For GitHub-event triggers: "Claude Code doesn't reuse sessions across events, so two PR updates
  produce two independent sessions" (routines doc). The same new-session-per-fire model applies to
  scheduled and API triggers — nothing in the doc describes resuming one persistent session across
  fires.

**Inference:** the documented Routines product does not support "bind a Routine to one persistent
session that accumulates context across hourly wakes." Every fire is a fresh clone + fresh session.
This contradicts the master-rebirth design in `RUNBOOK.md` (`create_session` a successor, `update_trigger`
to retarget). Two explanations, not resolved by docs:
(a) the orchestrator was built against an older/internal trigger API (`trig_01…` ids, `update_trigger`,
`persistent_session_id`) that predates or sits outside the current public Routines surface, or
(b) continuity in the current model has to live in the **state issue** (already true per `RUNBOOK.md`
— "the state issue is the only memory that must survive a master rebirth") and each hourly Routine fire
is simply a fresh session that reads the state issue, does one heartbeat's work, and exits — no
`update_trigger`/rebirth choreography needed at all, since there's no persistent session to retarget.
**Doc is silent on which; live probe:** create a test Routine with an hourly schedule and a prompt that
reads/writes a scratch GitHub issue, let it fire twice, and check in `claude.ai/code/routines` run list
whether the two runs are the same session id or two different ones (WebFetch/browser needed — not
done here, no live claude.ai session in this environment).

`create_session(source_url=...)` for worker spawning: **not found in any fetched public doc.** Searched
the routines page, the scheduled-tasks page, and a web search for `"create_session" "source_url"`
turned up only the unrelated Claude Platform Managed Agents "Create Session" API (a different product).
Doc-silent. Live probe: from inside a running cloud/web session, list available tools and check for one
named `create_session` (or equivalent) accepting `source_url`.

## 2. Does a Routine session load the repo's `.claude/settings.json` and account connectors?

- **Connectors: documented, yes, scoped per-routine.** "When you create a routine, all of your
  currently connected connectors are included by default. Remove any that aren't needed" (routines
  doc). These are **account-level claude.ai connectors**, not local `claude mcp add` servers: "MCP
  servers you added locally in the CLI... are stored on your machine rather than your claude.ai
  account, so they do not appear in the connectors list. To use one of those servers in a routine, add
  it as a connector... or declare it in a committed `.mcp.json`."
- **Repo files / skills: documented, yes.** "The session can run shell commands, use skills committed
  to the cloned repository, and call any connectors you include." Each repo is cloned fresh from its
  default branch every run.
- **`.claude/settings.json` specifically (plugin pointer, hooks): doc-silent on hook execution.** The
  doc states routines "run autonomously as full Claude Code cloud sessions: there is no permission-mode
  picker and no approval prompts during a run." That directly implies permission-gating hooks
  (PreToolUse-style approval gates, like this repo's `ask_matt_gate.py declare-claude` route check)
  do not block a Routine run the way they block an interactive session — but the doc doesn't say
  whether such hooks still *fire* (and get auto-approved) or are skipped entirely, nor whether
  non-gating hooks (SessionStart, Stop, etc.) run. **Live probe:** fire a test Routine against a repo
  whose `.claude/settings.json` has a SessionStart hook that writes a marker, and check the run
  transcript for the marker.

## 3. Limits

| Limit | Value | Source |
| --- | --- | --- |
| Minimum schedule interval | 1 hour | "The minimum interval is one hour; expressions that run more frequently are rejected." (routines doc) — matches the ticket's hourly plan. |
| Per-org / per-account Routine count | **Doc-silent.** No maximum count stated. | — |
| Run duration cap | **Doc-silent.** No maximum stated. | — |
| Daily run cap | Exists, shared per account, **exact number not published**: "routines have a daily cap on how many runs can start per account. See your current consumption and remaining daily routine runs at claude.ai/code/routines or claude.ai/settings/usage." | routines doc |
| One-off runs vs daily cap | Excluded: "One-off runs do not count against the daily routine run cap." | routines doc |
| GitHub-trigger events | "subject to per-routine and per-account hourly caps. Events beyond the limit are dropped until the window resets." (not applicable to this ticket's schedule-only use) | routines doc |

**Four Routines (one per repo) sharing one account:** doc doesn't forbid it, but the daily cap is
account-wide, not per-routine: "Routines belong to your individual claude.ai account... they count
against your account's daily run allowance" (singular allowance). **Inference:** four hourly Routines
draw against **one shared daily-run budget**, so they contend with each other for that budget the same
way the four PC masters would have contended for one serialized watchdog slot — contention exists, just
shaped differently (a shared counter, not a shared process). Exact headroom is doc-silent; check the
live count at claude.ai/code/routines before enabling all four.

**Weekly usage limit (the 2026-09-01 event):** not a Routines-specific limit. "Routines draw down
subscription usage the same way interactive sessions do." So the account's ordinary weekly/subscription
usage cap applies identically to Routine runs as to interactive sessions — which matches what actually
happened per issue #44: *"The account hit its weekly usage limit ~08:40 UTC; the master's 15:16
heartbeat failed with 'You've hit your weekly limit · resets Sep 4, 11am (UTC)'"* — the cloud master's
own turn was rejected exactly like a normal session would be, not treated specially as a Routine.

**On hitting the cap (daily or weekly):** "When a routine hits the daily cap or your subscription usage
limit, organizations with usage credits turned on can keep running routines on metered overage. Without
usage credits, additional runs are rejected until the window resets." No retry/backoff behavior
documented beyond that — a rejected run is just rejected, not queued.

**Retired heartbeat Routine:** `trig_01AjdGv13s2TQNukiF2cGU3f`, disabled 2026-09-01/02 per issue #44
("heartbeat Routine `trig_01AjdGv13s2TQNukiF2cGU3f` disabled" / "master session archived, heartbeat
Routine disabled"). Its id shape (`trig_...`) and the `update_trigger` verb used to manage it in issue
#44 match neither the routine ids nor the management verbs (`/schedule`, web UI, `/fire` API) in the
current public docs — further evidence for the doc/implementation gap in finding 1.

## 4. Cost shape vs. the PC numbers

No separate Routines pricing exists: "Routines draw down subscription usage the same way interactive
sessions do." **Inference:** a cloud-Routine master costs the same, token-for-token, as the PC's
`--remote-control` interactive master — there is no cloud premium or discount documented. The
~$25/day figure in `LOCAL-RUNBOOK.md` for hourly PC master overhead should transfer roughly as-is to a
cloud Routine running the same heartbeat cadence and worker-spawn pattern, since both draw from the
same per-token subscription usage pool. The one *structural* cost difference: four separate cloud
Routines (one per repo, per this ticket's design) run **concurrently**, unlike the PC's single
serialized watchdog slot (`RUNBOOK.md`: *"Two masters on one repo is the double-run that exhausted the
weekly limit... several masters on several repos is the intended shape"* — already the sanctioned
model). Concurrency itself isn't a cost multiplier per run, but four independently-heartbeating masters
burn the shared weekly/daily budget faster in aggregate than one serialized PC watchdog did — exactly
the mechanism that caused the 2026-09-01 exhaustion (cloud Routine + PC fleet running at once against
one account).

## Where docs are silent — live probes needed

1. Whether a Routine fire resumes one persistent session or always starts fresh (finding 1).
2. Whether `create_session(source_url=...)` exists as a callable tool from a live cloud session
   (finding 1).
3. Whether project `.claude/settings.json` hooks execute (and which kinds) during a Routine run
   (finding 2).
4. Exact per-account daily Routine-run cap and max run duration (finding 3) — read at
   `claude.ai/code/routines` / `claude.ai/settings/usage` with a live login, not available in this
   headless environment.

## Three most consequential findings, for the issue comment

1. Routines don't bind to a persistent session — every fire is a fresh session ("each run creates a
   new session"). `RUNBOOK.md`'s `update_trigger`/`persistent_session_id` rebirth mechanism doesn't
   match the current documented product; continuity has to live entirely in the state issue.
2. `create_session(source_url=repo)` for worker spawning is not in any fetched Anthropic doc — doc-silent,
   needs a live-session probe before the design depends on it.
3. Minimum interval is confirmed at 1 hour (matches plan), but the daily run cap is a single shared
   pool per account, not per-routine — four hourly repo-Routines contend for one budget, and the
   2026-09-01 exhaustion shows the weekly subscription cap applies to Routine turns exactly like
   interactive sessions, with no special headroom.
