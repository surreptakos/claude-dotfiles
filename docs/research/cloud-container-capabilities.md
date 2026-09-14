# Cloud container capability inventory

Research for issue #155 (part of #154). Question: what does a claude.ai/code container give
a session, measured and cited from primary sources plus this repo's own evidence?

**Method note on the live probe.** This research was conducted from a session running on the
owner's Windows desktop (`CLAUDE_CODE_ENTRYPOINT=claude-desktop`, `uname` reports MSYS/mingw64,
`CLAUDE_CODE_REMOTE` unset) — **not** inside a claude.ai/code cloud container. Every claim below
is either a direct quote from Anthropic's docs (URL cited), or drawn from this repo's own
committed files and issue history (path or issue number cited). Nothing here is a live
observation from inside a container; the "Open questions needing a live probe" section at the
end names exactly what a real cloud session should run to confirm each inference.

Docs fetched 2026-09-14:
- Claude Code on the web: https://code.claude.com/docs/en/claude-code-on-the-web
- Configure cloud environments: https://code.claude.com/docs/en/cloud-environments
- Hooks reference: https://code.claude.com/docs/en/hooks
- Plugins reference: https://code.claude.com/docs/en/plugins-reference
- Settings files and precedence: https://code.claude.com/docs/en/settings

---

## 1. Which hook events fire, and from which sources

**Docs.** The hooks reference lists the full event set (SessionStart, SessionEnd, UserPromptSubmit,
PreToolUse, PostToolUse, Stop, StopFailure, and many more) and states the configuration-location
table:

| Location | Scope | Shareable |
|---|---|---|
| `~/.claude/settings.json` | All your projects | No, local to machine |
| `.claude/settings.json` | Single project | Yes, can commit to repo |
| `.claude/settings.local.json` | Single project | No, gitignored |
| Managed policy settings | Organization-wide | Yes, admin-controlled |
| Plugin `hooks/hooks.json` | When plugin enabled | Yes, bundled with plugin |

Quoted directly: *"Cloud sessions on Claude Code on the web don't read your local
`~/.claude/settings.json`. Hooks come from the repo and your organization's server-managed
settings. In self-hosted environments, Claude Code runs hooks the operator seeded from the
runner host's `~/.claude/`."* (hooks reference)

The cloud-environments page states the same thing from the setup-script-vs-hook comparison table
and adds the self-hosted variant: *"If you have SessionStart hooks in your user-level
`~/.claude/settings.json`, don't expect them in the cloud. User-level settings stay on your
machine."* Then, split by environment type:

- **Anthropic-hosted environment**: *"Claude Code runs hooks from the repository and from your
  organization's server-managed settings."*
- **Self-hosted environment**: *"Claude Code also runs the hooks the operator seeded from the
  runner host's `~/.claude/`, and the hooks in the runner image's managed settings file..."*

Its "What carries over from your setup" table says explicitly: repo `.claude/settings.json`
hooks — **Yes**, part of the clone; plugins declared in `.claude/settings.json` — **Yes**,
*"Installed at session start from the marketplace you declared. Requires network access to reach
the marketplace source."*

**This repo's evidence.** `.claude/settings.json` (project-level, committed) wires SessionStart
(two hooks: `session-start.sh` then `dotfiles-freshness-hook.js session-start`), UserPromptSubmit
(`dotfiles-freshness-hook.js prompt`), and SessionEnd (`dotfiles-freshness-hook.js session-end`).
Its own comment block records: *"extraKnownMarketplaces + enabledPlugins make cloud sessions
(claude.ai/code) install the aac-skills plugin from this repo at startup... Declaring it here is
the documented path and the one verified 2026-09-09: Claude Code clones the marketplace itself
after credentials are wired up, loads all 56 skills and runs the plugin's SessionStart hook. Not
reproduced 2026-09-11: that session's `installed_plugins.json` was empty (evidence on issue 106)."*

That "not reproduced" claim is corroborated by issue #106's second comment (2026-09-11,
`session_019m3YudV6JesLeDjf9w69RQ`): *"`.claude/settings.json` declares
`extraKnownMarketplaces.claude-dotfiles` + `enabledPlugins["aac-skills@claude-dotfiles"]`, yet in
the container `~/.claude/plugins/installed_plugins.json` was `{"version": 2, "plugins": {}}`,
`~/.claude/plugins/synced/<org>_<account>/` existed and was empty, and no `aac-skills:` skill
appeared in the session's skill list."*

**Inference.** The docs describe the project-settings `enabledPlugins` route as the mechanism that
*should* deliver `marketplace/aac-skills/hooks/hooks.json`'s SessionStart marker hook into a cloud
session; the repo's own issue #106 shows that mechanism failing at least once on 2026-09-11. This
is a **live, contested question**, not settled by docs alone — see the open question at the end.

Separately: the account-level ("synced") plugin route is documented on the plugins-reference page
(quoted below in section on plugins) as a *different* mechanism from the `enabledPlugins` route,
and issue #106's first comment records a deliberate ruling *not* to chase the synced route further
(*"Do not file [a bug report]"*, Dan, grill session 2026-09-10) — the project-settings route is the
standing path by owner decision, independent of whether Anthropic's synced-plugin delivery works.

## 2. Runtimes present: node, python3, pwsh, gh, git — and versions

**Docs.** The cloud-environments "Installed tools" table (Anthropic-hosted environments, Ubuntu
24.04 x86_64) lists, among others: Python 3.x (pip, poetry, uv, black, mypy, pytest, ruff);
Node.js 20, 21, and 22 (22 on `PATH` by default, others at `/opt/node20`, `/opt/node21`,
`/opt/node22`); Ruby 3.1–3.3; PHP 8.3; OpenJDK 21; Go; Rust; C/C++ toolchain; Docker;
PostgreSQL 16; Redis 7.0; and under **Utilities**: *"git, gh, jq, yq, ripgrep, tmux, vim, nano."*

That directly contradicts this repo's own `.claude/hooks/session-start.sh` comment, which says
*"gh: not installed, but GH_TOKEN is injected... so the release tarball installs cleanly,"* and its
own install logic (`command -v gh` check, downloads gh 2.86.0 from GitHub releases if absent). The
docs assert `gh` ships pre-installed on the Anthropic-hosted image; the repo's hook assumes it does
not and installs it defensively. Issue #153 (2026-09-14) is exactly this contradiction surfacing
live: *"A cloud session on 2026-09-14 had no `gh` on PATH,"* even though the installer hook (commit
342bdee, #131) is on `master`. Issue #153's own working theory — not yet confirmed — is that the
hook is **project-scoped** (lives in this repo's `.claude/settings.json`) and never ran because the
observed session was rooted in a different repo with this one cloned alongside it, not that `gh`
is absent from the base image contrary to docs.

**No documented `pwsh`.** The Installed-tools table has no PowerShell entry. This repo's
`session-start.sh` comment states outright: *"PowerShell is deliberately not installed:
tests/restore-test.ps1 and sync.ps1 are Windows-only (junctions, C:\ paths, the py launcher) and
CI's Windows runner covers them on every push."* `tools/dotfiles-freshness-hook.js`'s
`powershellAvailable()` function treats PowerShell's absence from `PATH` (or
`CLAUDE_CODE_REMOTE_SESSION_ID` being set) as the signal to skip the freshness classifier
entirely in a container — issue #107 (closed, PR #140) built exactly this skip path after an
earlier session saw `spawnSync powershell ENOENT` crash the hook.

**git.** Listed in Installed tools; not separately contested by any cited issue.

**Versions.** Docs give no pinned version numbers except Node's three tracks (20/21/22) and
language majors (Python 3.x, Ruby 3.1–3.3, PHP 8.3, OpenJDK 21). Docs point to a live command:
*"To get the versions of most of the tools in this table, ask Claude to run `check-tools` in a
cloud session... For a tool it doesn't report... ask Claude to run the tool's own version
command."* This repo's `session-start.sh` pins its own gh fallback to `GH_VERSION="2.86.0"`
(a repo choice, not a documented platform version) and issue #130 records the container's gh as
`2.86.0` when it was present, measured 2026-09-11.

**Inference.** Whether `gh` truly ships pre-installed and issue #153's "wrong repo root" theory is
the real explanation, versus the Installed-tools table being wrong or stale for this org's image,
is unresolved by docs — it needs the live probe below.

## 3. Cloud environment configuration: env vars, secrets, setup-script timing, persistence

**Environment variables.** Docs: *".env* format, one `KEY=value` pair per line... Each session
copies the environment's values once, at startup, into ordinary environment variables that any
command Claude runs can read... Anyone who uses the environment can read the values."* Explicitly
warned against for secrets: *"On Pro and Max plans, use an API credential instead for a key the
agent proxy can attach to a request."*

**API credentials (Pro/Max only).** A credential is attached by Anthropic's proxy to matching
outbound hosts *after the request leaves the session's VM* — *"The key never reaches Claude, the
commands it runs, or the session's environment variables."* Not available on Team/Enterprise plans
yet per the docs (*"Team and Enterprise plans don't have them yet"*). Which plan this repo's
sessions run under is not established by anything read in this research — see open questions.

**Requests that never get a credential, regardless of plan:** GitHub (its own proxy handles it),
`api.anthropic.com`, `registry.npmjs.org`, `jsr.io`, `npm.jsr.io`, `pypi.org`,
`files.pythonhosted.org`, `index.crates.io`, `proxy.golang.org`, and — directly relevant to this
repo's ticket text — *"Setup script requests: Claude Code connects to the agent proxy when it
launches, after the setup script has run."* That is the doc-level confirmation of the exact ordering
`.claude/settings.json`'s comment block already asserts from observed behaviour: *"the cloud
environment setup script runs before the session's git credentials exist, so cloning a private
marketplace fails there"* — issue #105 (closed) is the ticket that removed two `claude plugin`
lines from the environment Setup Script for exactly this reason, ruled *"Already removed"* by Dan
on 2026-09-10 with the caveat *"no agent-side check possible from a desktop session"* (i.e. that
closure itself rests on the owner's unverified word, not an agent-run check).

**Setup script vs SessionStart hook — timing and persistence, table from the docs:**

| | Setup scripts | SessionStart hooks |
|---|---|---|
| Configure | Environment dialog at claude.ai/code (+ admin page for shared environments) | A settings file such as repo `.claude/settings.json` |
| When | Before Claude Code launches, **skipped when a cached environment exists** | After Claude Code launches, on every session including resumed |
| Where | Cloud sessions only | Local and cloud sessions |

Persistence detail, quoted: *"The setup script runs the first time you start a session in an
environment. After it completes, Anthropic snapshots the filesystem and reuses that snapshot as
the starting point for later sessions... The setup script runs again to rebuild the cache when you
change the environment's setup script or allowed network hosts, and when the cache reaches its
expiry after roughly seven days. Resuming an existing session never re-runs the setup script."*
And on what does/doesn't survive: *"The cache is a filesystem snapshot, so it keeps what the setup
script writes to disk and loses anything that was only running... A database the script started, a
`docker compose up` stack, or any other background process doesn't [persist]."*

**What persists between sessions vs what does not, from the "What carries over from your setup"
table:**

| | Available in cloud sessions |
|---|---|
| Repo `CLAUDE.md`, `.claude/settings.json` hooks, `.mcp.json`, `.claude/rules/`, `.claude/skills\|agents\|commands/` | Yes — part of the clone |
| Plugins declared in `.claude/settings.json` | Yes — installed at session start from the declared marketplace, requires network access |
| Org server-managed settings | Yes — fetched from Anthropic's servers at session start |
| User `~/.claude/CLAUDE.md`, user `~/.claude/skills\|agents\|commands/` | **No** — lives on your machine |
| Plugins enabled only in user settings (`~/.claude/settings.json` `enabledPlugins`) | **No** — declare in repo settings instead, or enable for the account to get synced plugins |
| MCP servers added at local/user `claude mcp add` scope | **No** — writes to `~/.claude.json` on your machine; use `--scope project` |
| Transport env vars in repo settings' `env` block (`NODE_EXTRA_CA_CERTS`, mTLS vars) | **No** — hosting environment manages the API connection; Claude Code ignores these and logs each ignored key |
| API keys/tokens | Only via API credentials (Pro/Max); otherwise a plain, readable env var |
| Interactive auth (AWS SSO etc.) | **No** — not supported |

**Ticket's specific sub-question — "whether `~/.claude` inside the container can carry a
CLAUDE.md, hooks and memory placed there by a SessionStart hook, and whether they load for the
same session or only the next."** Docs do not answer this directly for a hook-*written* (as opposed
to repo-committed) `~/.claude/CLAUDE.md`. What is documented is the read-side: user
`~/.claude/CLAUDE.md` is **not** carried over from *the owner's own machine* into a cloud session
(the table above). Whether a file a SessionStart hook writes to `~/.claude/` mid-container-lifetime
is then picked up — by that same session, or only a later one, or never, since CLAUDE.md is
typically loaded once at session start — is **not stated anywhere in the fetched docs**. This is an
open question needing a live probe (below).

## 4. Egress: which hosts are reachable

**GitHub REST vs GraphQL (issue #130, #102).** The docs' GitHub-proxy section confirms and
generalizes what issue #130 measured: *"the proxy serves only a pinned set of GraphQL operations
for pull-request workflows. The proxy rejects everything else on the GraphQL endpoint with a 403
that says `This GraphQL query is not enabled for this session` and names the REST fallback, `gh api
repos/{owner}/{repo}/...`. The restriction applies to every request through the proxy regardless of
the credentials you supply, so a `GH_TOKEN` you set gets the same 403. Claude can't reach GitHub
APIs that exist only in GraphQL, such as Projects v2, through the proxy."* Issue #130's own
measurement (2026-09-11, gh 2.86.0, `GH_TOKEN` injected): `gh api repos/{owner}/{repo}/...` works;
`gh repo view --json`, `gh issue list --json`, `gh pr list`, `gh issue view` all fail with
`HTTP 403: GitHub GraphQL is not available from Claude Code sessions; use the REST API`. Both
sources agree exactly on mechanism and on the REST-fallback recommendation. Issue #130 landed the
fix (PR #147, merged) porting `tools/tracker-audit.js` and the session-check skill off the
GraphQL-backed `gh` subcommands onto `gh api`.

**GitHub API repository scope**, from the docs, not previously in this repo's evidence: *"GitHub
API and release-asset requests reach only repositories attached to the session, so a setup script
that downloads release assets from an unattached repository gets a 403."* Relevant inference:
issue #102's item 1 (git-plumbing workaround for `gas run`/`gas ref` create-blob 403s from a
container) is consistent with — though not explicitly named by — this repository-scope
restriction; issue #102 attributes the 403 to *"the cloud session proxy refuses GitHub API
writes"* without naming the repository-scope mechanism specifically, so this is an inference
bridging the two, not a confirmed single root cause.

**googleapis.com and graph.microsoft.com (ticket's explicit question).** The default-allowed-domains
list, **Trusted** network access level, under "Cloud platforms" includes `*.googleapis.com`,
`storage.googleapis.com`, `compute.googleapis.com`, `container.googleapis.com`, `cloud.google.com`,
`accounts.google.com`, `gcloud.google.com`. So **googleapis.com (wildcard) is reachable by default**
at Trusted network access — this directly supports the AAC Google stack (service account, Sheets/
Drive/Gmail/Apps Script APIs) working from a Trusted-level cloud container without extra
configuration.

`graph.microsoft.com` does **not** appear anywhere in the default-allowed-domains list. The
Microsoft-related entries present are: `azure.com`, `portal.azure.com`, `microsoft.com`,
`www.microsoft.com`, `*.microsoftonline.com`, `packages.microsoft.com`, `dotnet.microsoft.com`,
`dot.net`, `visualstudio.com`, `dev.azure.com`, and (container registries) `mcr.microsoft.com`,
`*.data.mcr.microsoft.com`. None of those cover the Graph API host. **Inference: a Trusted-level
container cannot reach `graph.microsoft.com` by default** — a session needing it would need
**Custom** network access with `graph.microsoft.com` (or `*.microsoftonline.com` alone is not
enough, since that's the auth/token host, not the Graph API host) added explicitly, or the
requesting code would need to go through an MCP connector, whose traffic *"travels through
Anthropic's servers rather than the session's network"* and so bypasses the allowlist entirely.
This is inference from the domain list, not a live-tested confirmation of a 403/timeout.

**MCP connector traffic and API-credential traffic** both bypass the session's own network
allowlist entirely (quoted above) — worth noting since it means "network access level" and "what a
tool can actually reach" are not the same question once MCP connectors or API credentials are in
play.

**Security proxy.** All outbound traffic in an Anthropic-hosted environment passes through an
HTTP/HTTPS proxy providing *"Protection against malicious requests,"* *"Rate limiting and abuse
prevention,"* *"Content filtering,"* and *"A DNS-level audit trail of requested hostnames."* Docs
name Bun's package-fetching as a known incompatibility with this proxy.

## 5. Whether `~/.claude` can carry hook/memory state placed there by a SessionStart hook, same session or next

Covered partly in section 3. To restate precisely against the ticket wording: docs establish that
(a) the *owner's own* `~/.claude/CLAUDE.md` and skills/agents/commands do not travel into a cloud
container — each container starts from *"a fresh virtual machine... with your repository
cloned"* — and (b) a **repo-committed** `.claude/` tree is what does load. Neither fetched page
describes what happens if a SessionStart hook running *inside* the container writes new content to
`~/.claude/` (memory, CLAUDE.md, hook files) during that same session. Plausible candidate answers,
none confirmed by a primary source read in this research:

- CLAUDE.md is typically read once, early in session start, so a hook-written CLAUDE.md would need
  a *fresh* session (or a resume) to be picked up — consistent with hooks re-running "on every
  session including resumed" per the setup-script-vs-hook table, but that table describes *hook*
  re-execution, not *CLAUDE.md* re-read timing, which is a different mechanism.
- Whether the environment-cache snapshot (setup-script-driven, filesystem-level, ~7-day expiry)
  also captures a SessionStart-hook-written `~/.claude/` tree is unaddressed — the cache section
  describes what the *setup script* writes to disk, not what a SessionStart hook (which runs after
  Claude Code has already launched, per the ordering table) writes.

This is the ticket's least-settled sub-question. See the live probe named for it below.

## Open questions needing a live probe

Each needs to be run from inside an actual claude.ai/code cloud container (this research session
was not one), and reported back with the raw output:

1. **`gh` presence on a fresh Default-environment session with no setup script.** Run `which gh &&
   gh --version` immediately, before any repo hook runs, in a session rooted at this repo and in a
   session rooted at a sibling repo with no `session-start.sh`-equivalent hook. Settles issue #153's
   "wrong repo root" theory versus the docs' "gh pre-installed" claim being wrong or org-specific.
2. **`enabledPlugins` reliability.** In a fresh session on this repo's master, run
   `cat ~/.claude/plugins/installed_plugins.json` and list active skills, to see whether the
   project-settings plugin route (contradicted once, in issue #106's second comment) is reliable
   now or still intermittent.
3. **`pwsh`/`powershell` absence.** `command -v pwsh; command -v powershell` in a fresh container,
   to confirm the repo's `powershellAvailable()` skip logic still matches reality.
4. **`graph.microsoft.com` reachability.** `curl -sS -o /dev/null -w '%{http_code}\n'
   https://graph.microsoft.com/v1.0/` (or equivalent) at the environment's actual configured network
   level, to confirm or refute the inference in section 4.
5. **`~/.claude` hook-written-state persistence.** Have a SessionStart hook write a marker file to
   `~/.claude/CLAUDE.md` or `~/.claude/hook-state/`, then (a) check whether the *same* session's
   context shows it was loaded, and (b) resume the session and check again, to answer section 5
   directly rather than by inference.
6. **Exact tool versions in this org's current image.** Ask Claude to run `check-tools` plus
   `git --version`, `python3 --version`, `node --version`, `gh --version` in a fresh container, to
   replace the single dated data point from issue #130 (gh 2.86.0, 2026-09-11) with a current
   reading and catch drift if Anthropic updates the base image.
