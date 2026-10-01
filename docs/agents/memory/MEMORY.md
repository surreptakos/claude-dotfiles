# claude-dotfiles memory

The committed memory for this repo: one file per note, `name` and `description` front matter,
the index below. Notes are owner rulings, environment quirks that cost real time, and pointers
to external artifacts — never anything derivable from the repo or the tracker (global rules,
"Memory governance"). The plugin's SessionStart hook (`tools/repo-memory-load.js`) injects the
note names below, so a cloud session and a desktop session start from the same memory.

Add one: write `docs/agents/memory/<name>.md`, add its line here, commit. That commit is the
whole publish — there is no live `~/.claude` copy to keep in step (issue 210), and
`node --test tools/repo-memory-load.test.js` fails when a note and this index drift apart.

The hook after the colon is for whoever reads this file: the SessionStart injection carries the
note NAME alone, about 35 bytes against a 1968-byte cap (issue 589). So write the hook for a human
and give the note a name that says what it is — adding one costs its own line and nothing else.

- account-enforcement-is-a-warning: warns only
- agent-remote-isolation-runs-locally: desktop
- answer-yes-no-in-one-line: outcome, action, timing
- bash-tool-collapses-backslashes: `\\` -> `\`
- caveman-base-url-stays-with-the-proxy: proxy-only
- classifier-refusals-are-shape-not-action: retry; MCP
- cloud-containers-can-run-powershell: 7.4.6 tarball
- cloud-home-snapshot: image frozen 09-21, no seat; multi-repo sessions need the setup-script bootstrap
- cloud-only-criteria-stall-the-desktop-fleet: cloud proof
- cowork-plugin-cache-can-go-stale: account-side, not packager
- cowork-runs-plugin-hooks: mcp__workspace__bash
- cowork-scheduled-tasks-live-in-session-uploads: uploads
- cowork-transcripts-not-local: server-side
- desktop-rpm-copy-is-account-synced: read rpm/manifest.json, not the path; the app's own sync writes the copy
- desktop-scheduled-tasks-are-per-org: per org
- dotfiles-public-for-cloud-clone: no env sources; BOOTSTRAP_DOTFILES_TOKEN askpass path for a private repo (issue 1047)
- plugin-auto-updates-never-tell-dan: desktop marketplace autoUpdate true; never tell Dan to run claude plugin update
- environment-verification-log: log
- fable-usage-is-rationed: weekly cap; workers stay pinned, orchestrator runs Fable high
- gate-declare-bare-command: nothing appended
- hook-exit-126-is-the-mode-bit: diag log; seat PLUGIN_ROOT
- leave-dates-token-rides-the-proxy: proxy-held
- marketplace-is-the-distribution-spine: installs read it
- msys-mangles-git-rev-colon-path: MSYS_NO_PATHCONV=1
- never-point-dan-at-github: URL or contents
- personal-profile-parity: junctions, two-way
- powershell-7-is-the-tool-engine: JSON indents 2
- pr-merge-from-worktree-needs-manual-branch-delete: manual
- ps51-scripts-need-a-bom: BOM or ASCII-only strings
- routine-sessions-run-acceptedits: allow-list every tool
- scratchpad-path-too-long-for-git-clone: short root
- sed-strips-crlf-in-this-repo: no sed -i on .ps1
- session-end-fixes-all-drift: every finding
- session-env-carries-zoho-and-gas-tokens: names only
- state-a-standing-rule-once: once
- three-skill-channels: only local in repo
- user-scope-plugin-wins-over-project-scope: user wins
- verify-before-filing-a-sweep-ticket: re-list first
- workflow-runtime-quirks: scriptPath; no Date.now; LF; absolute scriptPath, cwd stale; no cd mid-run
- workflow-prompt-needs-allow-rule: bare Workflow in allow
- vendored-copy-provenance-needs-upstream-history: diff every upstream revision
- cloud-skips-third-party-marketplaces: hooks clone and copy skills, agents, MCP; keys stay in the environment
- cloud-cannot-reach-user-projects: GraphQL and /users REST both 403; Sales Report auto-add is on, nothing owed; GH_DEBUG=api before naming a gh cause
- status-report-is-not-a-request: past tense is a report; check Teams first
- chain-prompts-keep-skill-labels: never force a label upstream; widen the fleet's tickets list
- artifact-submit-goes-to-last-publisher: Submit reaches only sessions watching the page; publishing watches, reading does not; name receiver and publisher from records

Source: tools/repo-memory-load.js, tools/repo-memory-load.test.js, https://github.com/surreptakos/claude-dotfiles/issues/210, https://github.com/surreptakos/claude-dotfiles/issues/589, profile/claude/CLAUDE.md, docs/agents/memory/hook-exit-126-is-the-mode-bit.md, docs/agents/memory/cloud-containers-can-run-powershell.md, https://github.com/surreptakos/claude-dotfiles/pull/652
- [Keep Dan's name for the thing](keep-dans-name-for-the-thing.md) — call a deliverable by the word he used; a new name reads as a different thing
