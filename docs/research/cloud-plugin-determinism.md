# Why cloud plugin install is nondeterministic (issue #157)

Research for #157, part of #154. Primary sources: code.claude.com docs (fetched 2026-09-14),
this repo's git history and current files, and the evidence already on issues #106, #100, #104,
#105. No live cloud-container probe was run in this pass — none was requested to be launched, and
the tool available here (`gh`) cannot start a claude.ai/code session. Every claim below is either a
docs quote, a repo citation, or an issue-comment quote; gaps are named as gaps, not filled by
inference dressed as fact.

## Bottom line

The project-settings route (#100/#104) is real and documented — Claude Code's own docs list
"Plugins declared in `.claude/settings.json`" as available in cloud sessions, "Installed at
session start from the marketplace you declared. Requires network access to reach the marketplace
source" (code.claude.com/docs/en/cloud-environments, "What carries over from your setup" table).
It is not documented as guaranteed on every session start, and nothing in the docs promises
retry-on-failure for that specific install path. The 2026-09-09 vs 2026-09-11 difference cannot be
fully explained from primary sources available here — several candidate variables are identified
below, each with the live probe that would confirm or rule it out. The single fact most likely to
explain silent, intermittent failure: Claude Code's git-credential behavior for marketplace clones
differs between an interactive/foreground install and a background one, and the background path
**disables credential helpers by default** (quoted below) — if session-start plugin installation
from committed settings is implemented on that background code path, a plain race on when the
container's GitHub proxy credentials are wired up would produce exactly the symptom seen: same
settings, same repo, silently empty `installed_plugins.json` on one run and a full 56-skill load on
another.

## Ticket bullets, answered

### 1. Exact startup sequence for plugin install in a container; SKIP_PLUGIN_MARKETPLACE; project-settings marketplaces subject to it?

**Startup sequence, from docs (code.claude.com/docs/en/cloud-environments, "Setup scripts vs.
SessionStart hooks"):**

> Setup scripts ... run before Claude Code launches, skipped when a cached environment exists ...
> SessionStart hooks ... run after Claude Code launches, on every session including resumed.

And separately (same page, "Requests that never get the credential"):

> **Setup script requests**: Claude Code connects to the agent proxy when it launches, after the
> setup script has run.

So the fixed order is: setup script (if the environment is not cached) → Claude Code launches →
agent/GitHub proxy connection is established → SessionStart hooks fire. The docs place
"Plugins declared in `.claude/settings.json`" ... "Installed at session start" in the same table,
but do not say whether that install happens before or after the GitHub-proxy connection completes,
or before or after SessionStart hooks. This ordering gap is the most direct candidate for
nondeterminism and is not resolvable from the docs alone — see Probe 3 below.

**`SKIP_PLUGIN_MARKETPLACE`:** not found in any fetched Anthropic doc — not in
`/docs/en/env-vars` (env-var reference page fetched in full and grepped for `SKIP_PLUGIN`,
`CLAUDE_CODE_PLUGIN_*`: no match), not in `/docs/en/cloud-environments`, not in
`/docs/en/plugin-marketplaces`, not in `/docs/en/plugins`. A web search for the exact string
returned no Anthropic source. Its only attestation anywhere is issue #106's own observation inside
a container:

> `SKIP_PLUGIN_MARKETPLACE=true` is set in the container environment.

That is Claude-sourced, from-inside-the-box evidence (issue #106, 2026-09-09), not a documented
contract. Whether it is Anthropic's internal switch for the **account-level sync** specifically, or
a global flag that also gates the **project-settings** marketplace-add path, is unestablished here.
Issue #100's verified 2026-09-09 test loaded all 56 skills via project settings in a container where
(by #106's same-day observation) `SKIP_PLUGIN_MARKETPLACE=true` was presumably also set — which is
weak evidence the project-settings route is *not* blocked by it, but the two observations come from
different sessions, so this is inference, not a controlled comparison. **Unresolved**, live probe
below.

### 2. What made the 2026-09-09 run succeed

From #100's own body, the "verified" run had a caveat that is easy to miss:

> Caveat: the test used the same keys at user scope, because a project-level change cannot be
> picked up without restarting the session. ... The first cloud session opened on this branch
> confirms the project-level path.

So there were, in effect, two 2026-09-09 successes reported: one at **user scope** in a
restarted session, and one presented as project-scope confirmation ("the first cloud session opened
on this branch"). Neither #100 nor #106 records the CLI version of the *successful* run; #106
records CLI `2.1.266` for its own (failing, account-sync) session the same day, but that is a
different session from #100's. Whether #100's success and #106's same-day failure ran the same CLI
build is not stated anywhere in the two issues.

Established / not established, bullet by bullet:

| Variable | 2026-09-09 (#100, success) | 2026-09-11 (#106 comment, failure) | Established from evidence here? |
|---|---|---|---|
| CLI version | Not recorded in #100 | Not recorded in the 09-11 comment (only #106's own 09-09 session logged `2.1.266`, a different session) | No — neither run's CLI build is pinned in the issue text |
| Settings scope tested | User scope (restarted session) *and* a separate project-scope session on the branch | Project scope, on `master`, per the committed `.claude/settings.json` | Partially — 09-09's clean win was user-scope; project-scope's 09-09 support is one line ("the first cloud session ... confirms") with no log excerpt attached |
| Repo root vs. subdirectory | Not stated | Not stated | No |
| Session started on this repo or another | #100: "on this branch" (claude-dotfiles) | #106 comment: explicitly "on this repo" (claude-dotfiles, session `session_019m3YudV6JesLeDjf9w69RQ`) | Both on claude-dotfiles — repo identity is not the differentiator |
| `.claude/settings.json` content | Declares the two keys (committed in #100/beaa6e5, 2026-09-09) | Same two keys still present (verified live in this worktree — see below) plus a same-day-unrelated addition from #131 (`session-start.sh` hook, `permissions.allow`) landed 2026-09-11 15:36:55 -0500 = 20:36:55Z, six minutes *after* the 20:30:24Z failure comment, so the failing session ran the pre-#131 file | Established from `git log --since=2026-09-08 --until=2026-09-13 -- .claude/settings.json` in this worktree: two commits, `beaa6e5` (2026-09-09, adds the marketplace/plugin keys) and `342bdee` (2026-09-11 15:36:55-05:00, adds the SessionStart hook + permissions). The plugin-declaring keys themselves were unchanged between the two dates. |
| Environment caching state | Unknown — first session in environment runs the setup script; later ones reuse a filesystem snapshot | Unknown | No — neither issue says whether the container was a fresh environment or a cached one, and the docs' cache section (below) makes this a live candidate |

**Live probe that would settle CLI version and cache state:** start a fresh cloud session on
`master`, immediately run `claude --version`, `cat ~/.claude/plugins/installed_plugins.json`, and
check the session's own diag/debug log for a `plugins_sync_*` or equivalent event tied to the
project-settings path (the account-sync path's event names, `plugins_sync_starting` /
`plugins_sync_no_changes`, are already known from #106 — whether the project-settings path emits a
parallel, differently-named event was not found in any fetched doc and was not visible from inside
this worktree, since diag logs are session-local and not committed anywhere in the repo).

### 3. Can a SessionStart hook or the environment setup script install the plugin deterministically? What credential does it need?

**Setup script: no, ruled out by direct prior evidence.** #100's own body:

> A `claude plugin marketplace add surreptakos/claude-dotfiles` in the cloud environment setup
> script fails with `could not read Username for 'https://github.com'`. The setup script runs
> before the session's git credentials are wired up.

This matches the docs exactly: "Claude Code connects to the agent proxy when it launches, after
the setup script has run" (cloud-environments doc, "Requests that never get the credential").
Setup scripts run as root before Claude Code (and therefore before the GitHub proxy) exists, so any
`claude plugin marketplace add` there has nothing to authenticate a private-repo clone with. #105
confirms this was tried, failed the same way, and the lines were removed from the Setup Script
(closed 2026-09-10, "Already removed").

**SessionStart hook: plausible but unverified here, and the docs put it *after* Claude Code
already needs to know about the marketplace.** SessionStart hooks "run after Claude Code launches,
on every session including resumed" (cloud-environments doc) — by then the GitHub proxy is up, so a
hook running `claude plugin marketplace add ... && claude plugin install ... -y` should have
working git credentials for a private repo, the same way the already-present
`.claude/hooks/session-start.sh` (added in #131, 2026-09-11, `.claude/settings.json` lines 43-58 in
this worktree) successfully installs `gh` from a GitHub release tarball inside the same kind of
container. But: (a) this repo's SessionStart hooks are declared in `.claude/settings.json`, the very
file that is only *available* in the cloud session as "Part of the clone" (cloud-environments
"What carries over from your setup" table) — so a SessionStart-hook plugin install has the same
bootstrapping dependency as the current `enabledPlugins` declaration: it only runs once the repo
(and that file) is already cloned, same as now; (b) nothing in the fetched docs describes running
`claude plugin install` from inside a hook as a supported or tested pattern, and no evidence in
this repo shows it tried. **Credential needed:** whatever the GitHub proxy already provides to `gh`
and git inside the container — no additional credential, per the docs' description of the GitHub
proxy ("the git client inside the VM uses a scoped credential, which the proxy verifies and swaps
for your actual GitHub token" — cloud-environments doc, "GitHub proxy" section) — the same
credential path `session-start.sh`'s `gh` install and the committed `enabledPlugins` marketplace
clone both already rely on.

**Deterministic in principle, not proven deterministic:** a SessionStart hook running the install
command explicitly, with a non-zero-exit check and a loud failure (rather than the current silent
"empty `installed_plugins.json`, no explanation" behavior of the built-in path), would at minimum
convert a silent nondeterministic failure into a visible one. It does not remove whatever root
cause makes the built-in install skip work some runs and not others, unless that root cause is
purely about *timing* relative to Claude Code's own launch sequence (in which case a hook — which
definitely runs after the proxy is live — sidesteps the race entirely). This is the thing Probe 3
below is for.

### 4. Fallback that never fails

Two candidates, ranked by moving parts:

**A. Vendor `aac-skills/` into each repo's `.claude/skills/` (harness change).** Cost: every
harnessed repo carries a full copy of every AAC skill (56 at last count, per #104) instead of one
line pointing at a marketplace; the vendored copy drifts from the plugin unless the harness or
`update-cloud-plugin`'s packager (`tools/build-cloud-plugin.py`) is taught to also write it into
every downstream repo on every publish, which does not exist today — `update-cloud-plugin`'s
`SKILL.md` currently only pushes to the marketplace and the account Skills-page zip fallback, not
to per-repo `.claude/skills/`. Docs confirm this channel is unconditionally available: "Your repo's
`.claude/skills/`, `.claude/agents/`, `.claude/commands/`" — "Yes" — "Part of the clone"
(cloud-environments "What carries over from your setup" table). No network dependency, no
credential, no timing race: it is on disk the moment the repo is cloned, which docs list as the
very first thing a cloud session has ("Cloud sessions start from a fresh clone of your repository").
This is the fewest-moving-parts fix for the specific failure mode in #106 (repo-settings plugin
install racing or silently no-op-ing) because it removes plugin install from the cloud-session path
entirely for the skills that matter. Cost: skill updates require re-syncing every downstream repo
(a fan-out job, not a single push), and the harness's step-16 vendoring script does not exist yet —
this ticket only proposes it; building and wiring it is separate work.

**B. A SessionStart hook that explicitly runs `claude plugin marketplace add` + `claude plugin
install -y` and fails loudly (non-zero exit / an obvious error line) if it doesn't work,
falling back to nothing more exotic.** Cost: adds a network round-trip and a credential dependency
(the GitHub proxy) to every session start; per section 3 above this is plausible but unverified as
actually deterministic — it converts silent failure into loud failure, which is real value, but
does not by itself guarantee success every time unless the root cause is a pure launch-order race
that a later-running hook avoids. Fewer moving parts than option A (no packager change, no per-repo
skills fan-out) but not proven to "never fail."

Given the "never fails" framing in the ticket, **A is the recommended fallback**: it has no network
dependency, no credential dependency, and no ordering dependency — the three variables everything
else in this research turns on. The cost is real (a fan-out sync job that does not exist yet, and
duplicate copies of skill content per repo) but it is a build cost, not a runtime risk.

## Primary-source quotes used above

- Setup script timing: code.claude.com/docs/en/cloud-environments, "Setup scripts" and "Setup
  scripts vs. SessionStart hooks" sections (fetched 2026-09-14).
- "Requests that never get the credential" / GitHub proxy: same page, "Add API credentials" and
  "GitHub proxy" sections.
- Plugins-declared-in-settings availability: same page, "What carries over from your setup" table,
  row "Plugins declared in `.claude/settings.json`".
- Environment caching: same page, "Environment caching" section.
- Marketplace background-refresh credential behavior: code.claude.com/docs/en/plugin-marketplaces
  (fetched 2026-09-14): "the background refresh disables git credential helpers for its `git
  pull`, so the pull can't authenticate to private repositories over HTTPS even when a helper is
  configured" and "When the background pull fails, Claude Code falls back to re-cloning the
  marketplace from scratch. The re-clone does use your stored git credentials, but it can time
  out on large repositories."
- `strictKnownMarketplaces` (ruled out — not set anywhere in this repo, confirmed by
  `grep -rn strictKnownMarketplaces .` returning nothing in this worktree 2026-09-14).
- Issue text: `gh api repos/surreptakos/claude-dotfiles/issues/{157,106,100,104,105}` and their
  `/comments` endpoints, fetched 2026-09-14 (quoted inline above).
- Repo evidence: `.claude/settings.json` (this worktree, read 2026-09-14); `.claude/hooks/session-start.sh`;
  `agents/skills/project-harness/SKILL.md` (step 16, lines ~124-141; v17 row, line 296);
  `claude/skills/update-cloud-plugin/SKILL.md`; `docs/skills-sharing-verification-2026-08-31.md`;
  `git log --since=2026-09-08 --until=2026-09-13 -- .claude/settings.json` (two commits:
  `beaa6e5`, 2026-09-09 14:10:53-05:00; `342bdee`, 2026-09-11 15:36:55-05:00).

## What is genuinely unknown, and the probe for each

1. **Whether `SKIP_PLUGIN_MARKETPLACE` gates the project-settings install path, not just the
   account-level sync.** Probe: in a fresh cloud session on this repo, run
   `env | grep SKIP_PLUGIN_MARKETPLACE` and, in the same session, check
   `~/.claude/plugins/installed_plugins.json`. If the var is set and the file is populated, the
   var does not block this path; if the var is set and the file is empty, it likely does.
2. **CLI version on the 2026-09-09 success vs. the 2026-09-11 failure.** Probe: capture
   `claude --version` (or the session's own startup banner) at the top of every future repro
   session and paste it into the issue; retroactively unrecoverable for the two dates already
   passed, since neither issue recorded it and no artifact from those sessions is checked into
   this repo.
3. **Ordering of "plugin install from committed settings" relative to the GitHub proxy coming up,
   and whether it is a foreground (credentialed) or background (credential-helpers-disabled)
   operation in Claude Code's own implementation.** Probe: repeat the 2026-09-09/09-11 comparison
   several times back-to-back on fresh (uncached) environments, capturing the session's debug log
   (`claude --debug` output during startup, or whatever line prints "plugin marketplace add" would
   print interactively) each time; a flip between runs with everything else held constant is
   the signature of a race, and stable failure across repeats would point at something more
   structural (e.g., environment caching serving a stale/empty snapshot).
4. **Environment caching state on each date.** Probe: check (or ask the owner to check) whether the
   claude.ai/code environment used on 2026-09-09 and 2026-09-11 was the same cached environment or
   two fresh ones — the admin/environment UI shows this; nothing in git or the issues records it.
5. **Repo root vs. subdirectory, and whether the session opened on `claude-dotfiles` vs. another
   repo, for the 2026-09-14 aac-routines occurrence mentioned in #157's body.** Not investigated
   here — #157's body names it but no linked issue or comment for that specific session was found
   in #106/#100/#104/#105. Probe: locate the aac-routines session referenced in #157 (session ID
   not given in the ticket body) and pull its debug log the same way.
