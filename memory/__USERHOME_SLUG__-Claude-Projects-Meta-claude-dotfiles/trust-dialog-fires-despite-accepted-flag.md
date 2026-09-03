---
name: trust-dialog-fires-despite-accepted-flag
description: An interactive claude launch in a clone whose .claude settings pre-approve permissions shows the folder-trust dialog even when hasTrustDialogAccepted is already true; unattended masters stall on it
metadata: 
  node_type: memory
  type: project
  originSessionId: 875883c6-da05-4675-89d5-32e9839997be
  modified: 2026-09-03T22:35:56.032Z
---

Reproduced 2026-09-02 through winpty in the contract-builder clone: `claude --dangerously-skip-permissions` rendered "Accessing workspace ... This folder pre-approves 28 tool permissions in .claude/settings.json and .claude/settings.local.json ... Yes, I trust this folder / No, exit" while `~/.claude.json` already carried `hasTrustDialogAccepted: true` for both path spellings. The bypass-mode disclaimer is a different dialog and IS persisted (`skipDangerousModePermissionPrompt` in user settings). Headless `-p` skips the trust dialog; interactive launches do not.

**Why:** the dialog's gate is not the per-project flag alone; the pre-approved-permissions variant re-renders. The persisted key for that variant was not found in `~/.claude.json` or settings after Dan accepted it.

**How to apply:** treat a watchdog-launched master with a launch line in `watchdog.log` but no Heartbeat 1 in its state issue as parked on this dialog. Tracked in claude-dotfiles (ticket filed 2026-09-03 at session end). Candidate fixes: find the persisted acceptance path in the CLI, or strip `permissions.allow` from the four clones' `.claude/settings*.json` since bypass mode makes pre-approvals moot. Related: [[ps51-scripts-need-a-bom]].
