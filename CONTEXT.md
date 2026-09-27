# claude-dotfiles — glossary

Terms settled while designing this repository's governance. One definition per term; a decision
that is hard to reverse goes in `docs/adr/`, not here.

## Route

The ask-matt flow a turn runs under: `direct-answer`, `grill-with-docs`, `implement`, `to-spec`,
`diagnosing-bugs` and the rest of `ALLOWED_FLOWS` in `profile/codex/hooks/ask_matt_gate.py`. A
route is chosen before any other tool runs in the turn.

## Route gate

The part of `ask_matt_gate.py` that records a turn's route and blocks tools until one is recorded.
Until 2026-09-25 the model named its own route and the gate checked only that the name was on the
list, so a build request could run as `direct-answer` (Dan, 2026-09-25).

Who picks (Dan, 2026-09-25): **Jev picks, the model may appeal once.** Jev walks the route tree
over the user's message and names the route. The model may appeal it once per turn with a written
reason, and the appeal is shown in the reply so the user sees it. A switch must later be able to
turn appeals off, leaving Jev's pick final.

When Jev cannot answer (Dan, 2026-09-25): no key, service down, or over its time budget, the
model picks the route as before, and its reply opens with `route unchecked: Jev unavailable`. The
fallback is never silent, never the heaviest route, and never a blocked turn.

## Route tree

Adversarial pass (2026-09-25) found: the prompt hook has 5 s and already spends up to 3 s on one Jev
call, so the whole tree must be one POST (every level's question at once, the correction check
folded in) walked in code afterwards; `jev.py` builds only Noul questions today, so a Choice needs
adding to the client. Decision record: `docs/adr/0002-jev-picks-the-route.md`.

Scope (Dan, 2026-09-25): **the gate routes engineering work only.** The tree's first question is
whether the message is software work in a repository or other work. Other work (contract packages,
review audits, Todoist triage and the like) runs as it does today, with no route tool limits.

The TypeSafe Jev questions that pick a route: one pick-one question per level, walked from the top
(question or change?) down to one route. The tree is the one table `ROUTE_TREE` in
`profile/codex/hooks/ask_matt_gate.py` (issue 839).

What Jev reads (Dan, 2026-09-25): the user's message, the previous turn's route, and the model's
last question to the user. The first question is **continuation**: does this message continue the
previous route's work? Full transcripts are not sent, to stay inside the time budget.

Continuation has three answers (Dan, 2026-09-25): **same step** keeps the route; **next step**
moves along the ask-matt map, and only to a move the map lists (grill-with-docs to to-spec or
implement, to-spec to to-tickets, to-tickets to implement, wayfinder to to-spec); **new topic** walks
the tree from the top. A move the map does not list is never taken as "next step".

## Route tool limits

What a route lets the model do, enforced in plain code at PreToolUse with no model call. Build
routes (`implement`, `tdd`, `diagnosing-bugs` and the like) must open their skill with the Skill
tool before the first edit. That is the only limit (Dan, 2026-09-25): an earlier answer made the
talk routes read-only, and it was dropped after the adversarial pass showed those routes must write
(the pre-send lint draft, this glossary, research notes) and shell commands write unchecked anyway.
A Jev check that each reply fits its route is deferred until the limits have run for a week.

Helpers are exempt (Dan, 2026-09-25): a tool call carrying the hook input's `agent_id` (set only for
subagent calls, per the Claude Code hooks docs) skips the route limits. Starting the helper already
passed the gate, and a helper's skill load never shows in the main transcript.

## Scheduled run

A turn started by a scheduled task, not typed by the user; its prompt carries the task file's text
inside a `<scheduled-task>` block. For now (Dan, 2026-09-25) scheduled runs skip the route gate
entirely: no Jev pick and no route tool limits. A switch must be able to turn on a **routine**
route instead, where the task file names the route and the run may make only the writes that file
lists.

Routine route (issue 844): `routine_route` in the settings file, off by default. On, a scheduled
run records the route its task file names on a `route: <flow>` line (`routine` when none), and an
Edit, Write, MultiEdit or NotebookEdit whose path matches no pattern under the file's `writes:`
list is refused. Shell writes stay unchecked, as on every route. No scheduler-started signal
exists: the hook input carries session id, transcript path, cwd, permission mode and prompt, none
of which says who sent the prompt, so the `<scheduled-task>` block stays the signal and its
spoofing risk is accepted.

## Route gate settings

The switches that change how strict the route gate is: appeals on or off, and the routine route on
or off for scheduled runs. They live in one committed settings file in this repository (Dan,
2026-09-25), so a change is a commit, reaches every machine and cloud session alike, and shows in
git history. Never a per-machine flag file. The file is `profile/codex/hooks/route-gate.json`,
beside the gate script it ships with.

## Appeal

The model's one written objection to Jev's route in a turn. It names the route it wants and why,
and it appears in the reply. Mechanism (Dan, 2026-09-25): the appeal is a gate command that logs
the wanted route and the reason; the pre-send lint then refuses the reply until its first line
reads `Route appeal: <wanted> instead of <Jev's>, because <reason>`.
