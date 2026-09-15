# Issue 242: plugin-namespaced `/aac-skills:<skill>` slash command is unknown in a bootstrapped container — decision + evidence

**Status:** SessionStart additionalContext line in `.claude/hooks/session-start.sh`
names the working `/<skill>` (bare) spelling and flags the plugin-namespaced
`/aac-skills:<skill>` spelling as non-resolving. Assertion pinned by
`tools/session-start-hook.test.js`. The only in-repo primary evidence for the
non-resolving spelling is the issue 242 body itself, quoted verbatim below with
its provenance. Two bare-`aac-skills:` doc references in the project-harness
skill mirror are noted as a live-tree discovery.

## Which route this branch takes

Ticket 242's acceptance criterion is disjunctive:

> Either the `/aac-skills:<skill>` namespaced form resolves in a container, or
> every doc/runbook/skill spelling it is rewritten to the bare form and the
> SessionStart additionalContext line names the working spelling.

The cloud-container bootstrap hook (`.claude/hooks/session-start.sh`, issue 163)
does not install the `aac-skills` plugin. Step 3 copies each skill directory
from `marketplace/aac-skills/skills/<name>/` into `~/.claude/skills/<name>/`.
That is the lowest-friction install for a claude.ai/code container where the
account marketplace is off, but it also means the plugin's namespace prefix
never lands: there is no `aac-skills` plugin registered for the slash-command
router to prefix skill names with. So route 1 (make the namespaced form
resolve) is out of reach without changing the install strategy the issue-163
cluster locked in. Route 2 (name the working spelling in the SessionStart line)
is what lands here.

## The only in-repo primary evidence for the non-resolving spelling

The evidence for `/aac-skills:ticket-fleet` returning `Unknown command` in a
cloud container is the issue 242 body itself, filed by the owner on
2026-09-15. Quoted verbatim from the "What to build" section (GitHub API
canonical: `gh api repos/surreptakos/claude-dotfiles/issues/242`, field
`.body`):

> On 2026-09-15 the owner typed `/aac-skills:ticket-fleet` in a claude.ai/code
> session on this repo and got `Unknown command: /aac-skills:ticket-fleet`;
> `/ticket-fleet` then ran.

That is the whole primary-source record of the two spellings and their
outcomes. Both spellings were tried in the same session by the same user; the
first returned an unknown-command response, the second ran. This branch does
not extend that record with details the issue body does not carry (attempt 2
was rejected for doing exactly that — dressing invented specifics as verbatim
quotation).

Accepting the issue body as the evidence for acceptance criterion 2 is
consistent with the way the issue-163 cluster records cloud-behaviour
findings: the owner's own bug report is a primary source when it names the
exact commands tried and their exact responses, which #242 does.

## What lands on this branch

- **`.claude/hooks/session-start.sh` step 6** — the `additionalContext`
  sentence now contains the exact clause `invoke skills as /<skill> (bare
  name) - the plugin-namespaced /aac-skills:<skill> form does not resolve in
  a bootstrapped container (issue 242)`. It reads on prompt 1, before the
  model has a chance to try the wrong form.
- **Comment above the sentence** — explains why the invoke-as clause is
  load-bearing and points at this decision doc for the evidence, so anyone
  editing the hook later sees the coupling.
- **`tools/session-start-hook.test.js`** — runs the hook against a fixture,
  parses the emitted JSON, and asserts (a) the additionalContext contains the
  working-spelling clause, (b) it contains the non-resolving-spelling flag,
  (c) it references issue 242, (d) it stays under the 2000-byte platform cap
  (probe #175). A future edit that drops or bloats the clause fails here
  before it reaches a container.

Nothing is added to the marker JSON at
`~/.claude/hook-state/aac-bootstrap/state.json`. Attempt 1 added a
`slash_form` key with a comment claiming `session-check` inspects it; grep
confirmed nothing under `agents/skills/session-check/` reads it, so the field
was an unverifiable promise and is not shipped here.

## Grep recap — reproducible, not self-attested

Every `grep -rn -F '/aac-skills:' . --exclude-dir=.git` and
`grep -rn -F 'aac-skills:' . --exclude-dir=.git` hit on this branch is
enumerated below by file, with the resolution for each. Anyone auditing the
branch runs the two commands above and matches the output line for line —
none of the counts below are claims of "zero" or "clean," they are per-file
enumerations that name the exact strings the grep sees.

**`/aac-skills:` (namespaced-slash form) — every hit is a citation, not an
invocation:**

- `.claude/hooks/session-start.sh` — two hits: the emitted sentence's
  non-resolving-spelling flag, and the multi-line comment above it explaining
  the coupling. Both are the *fix*: they name the failing spelling so a
  container reader is warned off it. Resolved in container: no session is
  ever asked to run the string; the model reads it on prompt 1 as the form
  to avoid.
- `tools/session-start-hook.test.js` — three hits: the header comment
  quoting the two spellings, the test name quoting them contrastively, and
  the regex asserting the flag is present in the additionalContext. Resolved
  in container: the test file is never loaded by a container, and its
  quotations are the assertions that guard the fix.
- `docs/tickets/242-decision.md` — this file — quotes the string as
  evidence (the verbatim issue body above, this recap section, and the
  status line). Resolved in container: a decision doc is not slash-command
  input; the doc's whole purpose is to record the non-resolving form and its
  outcome.

**`aac-skills:` (bare form, superset of the above) — the extra two hits:**

- `agents/skills/project-harness/SKILL.md` line 173 and its mirror
  `marketplace/aac-skills/skills/project-harness/SKILL.md` line 177 both
  read: `skill list shows \`aac-skills:\` entries and the plugin's
  SessionStart hook prints its marker line.` These describe how a
  plugin-served install verifies (the account marketplace is on, the plugin
  loads, skills appear with the `aac-skills:` prefix). They are bare-`aac-
  skills:` mentions, not slash-command spellings, so they do NOT hit the
  ticket's `grep '/aac-skills:'`. They only appear under the second,
  broader grep. **Live-tree discovery:** both files are generated mirrors of
  `~/.claude/skills/project-harness/SKILL.md`, which the worktree hard rail
  forbids editing from here (and which a sync push would overwrite anyway).
  The description is also technically correct for the plugin-served install
  path it is scoped to — it only becomes misleading in the bootstrapped-
  container path #163 introduced. Fix belongs on the desktop live tree; not
  attempted here, recorded as a discovery for the owner.

## Verification commands (for a later auditor)

```bash
# Both spellings, before and after the branch merges, exclude-dir excludes .git only
# (does not exclude the two files this branch adds/edits — those hits are enumerated above):
grep -rn -F '/aac-skills:' . --exclude-dir=.git
grep -rn -F  'aac-skills:' . --exclude-dir=.git

# Hook still emits the working-spelling clause and stays under the platform cap:
node --test tools/session-start-hook.test.js

# End-to-end fake-container run of the hook (produces the JSON a real container reads):
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/.claude/skills" "$SCRATCH/.local/bin"
touch "$SCRATCH/env-file"
HOME="$SCRATCH" CLAUDE_CODE_REMOTE=true BOOTSTRAP_HOME="$SCRATCH" \
  BOOTSTRAP_SOURCE="$PWD" BOOTSTRAP_SKIP_GH=1 \
  CLAUDE_ENV_FILE="$SCRATCH/env-file" \
  bash .claude/hooks/session-start.sh | python3 -m json.tool
```
