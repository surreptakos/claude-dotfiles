# claude-dotfiles memory

The committed memory for this repo: one file per note, `name` and `description` front matter,
the index below. Notes are owner rulings, environment quirks that cost real time, and pointers
to external artifacts — never anything derivable from the repo or the tracker (global rules,
"Memory governance"). The plugin's SessionStart hook (`tools/repo-memory-load.js`) injects the
index lines below, so a cloud session and a desktop session start from the same memory.

Add one: write `docs/agents/memory/<name>.md`, add its line here, commit. That commit is the
whole publish — there is no live `~/.claude` copy to keep in step (issue 210), and
`node --test tools/repo-memory-load.test.js` fails when a note and this index drift apart.

- account-enforcement-is-a-warning: warns, never blocks
- agent-remote-isolation-runs-locally: ran on the desktop
- answer-yes-no-in-one-line: outcome, action, timing
- bash-tool-collapses-backslashes: `\\` arrives as `\`
- caveman-base-url-stays-with-the-proxy: never env-level or synced
- cloud-containers-can-run-powershell: install the 7.4.6 tarball
- cloud-only-criteria-stall-the-desktop-fleet: prove from cloud
- cowork-runs-plugin-hooks: obeys text, not hooks
- cowork-scheduled-tasks-live-in-session-uploads: no registry
- cowork-transcripts-not-local: history is server-side
- desktop-scheduled-tasks-are-per-org: per account+org
- environment-verification-log: proof behind the rules
- fable-usage-is-rationed: weekly cap; keep the pins
- gate-declare-bare-command: nothing appended
- install-mirror-prs-to-live-before-sync-push: live first
- marketplace-is-the-distribution-spine: installs from here
- msys-mangles-git-rev-colon-path: MSYS_NO_PATHCONV=1
- personal-profile-parity: one-way, pull only
- powershell-7-is-the-tool-engine: JSON indents 2
- pr-merge-from-worktree-needs-manual-branch-delete: by hand
- ps51-scripts-need-a-bom: Task Scheduler runs 5.1
- restore-test-reads-live-skill-copies: live edit fails others
- scratchpad-path-too-long-for-git-clone: use a short root
- sed-strips-crlf-in-this-repo: never sed -i a .ps1
- session-end-fixes-all-drift: every finding, any cause
- state-a-standing-rule-once: no reinforcing copies
- three-skill-channels: only local is in the repo
- trust-dialog-fires-despite-accepted-flag: strip permissions.allow
- user-scope-plugin-wins-over-project-scope: project scope loses
- verify-before-filing-a-sweep-ticket: re-list at publish time
- workflow-runtime-quirks: scriptPath; no Date.now; LF
