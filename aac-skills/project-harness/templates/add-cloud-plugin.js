#!/usr/bin/env node
// project-harness step 16: make a repo cloud-ready in one command (issue 218). Three deliveries,
// all idempotent — a second run changes nothing:
//
//   1. the CLOUD BOOTSTRAP HOOK, the one per-repo artefact (issue 163, spec #207): copies
//      `templates/session-start.sh` to <repo>/.claude/hooks/session-start.sh and wires one
//      SessionStart entry for it. The hook body is the same file claude-dotfiles runs, generated
//      from it by `tools/build-harness-bootstrap-hook.js` there; no repo carries skill content,
//      because the hook installs the payload from dotfiles master at session start.
//   2. the PLUGIN DECLARATION (extraKnownMarketplaces + enabledPlugins), so a cloud session
//      (claude.ai/code) installs aac-skills at startup.
//   3. the PERMISSION POSTURE: permissions.defaultMode auto + a blanket allow list, and the
//      widened autoMode.allow ruling (Dan, 2026-09-17, issue 543, superseding issue 245), so every
//      cloud or Routine session — attended or unattended — is sanctioned to run every action its
//      work requires, destructive and irreversible included.
//
// MERGES into whatever the file already holds (extraKnownMarketplaces, enabledPlugins,
// permissions, autoMode.allow, hooks.SessionStart) and leaves everything else byte-for-byte;
// creates the file when absent.
//
//   node add-cloud-plugin.js <repo-root>
//
// Why project settings and not the account or the environment: see templates/claude-settings.json.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.argv[2];
if (!root) { console.error('usage: node add-cloud-plugin.js <repo-root>'); process.exit(2); }
const file = path.join(root, '.claude', 'settings.json');

const MARKETPLACE = 'claude-dotfiles';
const SOURCE = { source: 'github', repo: 'surreptakos/claude-dotfiles' };
const PLUGIN = 'aac-skills@claude-dotfiles';

// Widened autoMode.allow ruling — issue 543 (Dan, 2026-09-17), superseding the issue 245 text this
// line used to repeat. READ from templates/claude-settings.json beside this script rather than
// duplicated here: a 2KB rule kept in two hand-maintained copies is a copy nobody diffs, and what
// this script merges into a repo has to be the text the template documents. Merged as a prose entry
// into the existing autoMode.allow array; a repo may keep its own entries (including the superseded
// 245 text) alongside this one — they are elaboration, not gates.
const AUTOMODE_ALLOW_RULING =
  JSON.parse(fs.readFileSync(path.join(__dirname, 'claude-settings.json'), 'utf8')).autoMode.allow[0];
// `Workflow`, `Agent`, `Task` and the session tools are what a Routine master actually dispatches
// with, and none of them were listed: on 2026-09-21 the master-contract-builder wake parked on a
// `Workflow` approval prompt for ticket-fleet.js and held its venue claim until the 90-minute
// guard expired, because auto mode sends an unlisted tool to the classifier and an unattended
// session has nobody to answer it. The autoMode.allow ruling below sanctions the action; only a
// permissions.allow entry removes the decision point.
const PERMISSIONS_ALLOW = [
  'Bash(*)', 'Edit', 'Write', 'mcp__github__*',
  'Workflow', 'Agent', 'Task', 'mcp__Claude_Code_Remote__*',
];

let settings = {};
let rawBefore = null;
if (fs.existsSync(file)) {
  rawBefore = fs.readFileSync(file, 'utf8');
  settings = JSON.parse(rawBefore); // throws on a broken file: never overwrite one
}
// The file's own line endings survive the rewrite. claude-dotfiles pins its `.claude/settings.json`
// as a CRLF blob (`.gitattributes -text`, issue 87) because every Windows text-mode writer
// re-serializes it as CRLF; a delivery that re-emitted it LF would reopen the phantom ` M` that pin
// exists to close, on the one repo that runs this script against itself.
const EOL = rawBefore && rawBefore.includes('\r\n') ? '\r\n' : '\n';
const before = JSON.stringify(settings);

settings.extraKnownMarketplaces = Object.assign({}, settings.extraKnownMarketplaces);
settings.extraKnownMarketplaces[MARKETPLACE] = Object.assign(
  {}, settings.extraKnownMarketplaces[MARKETPLACE], { source: SOURCE });
settings.enabledPlugins = Object.assign({}, settings.enabledPlugins, { [PLUGIN]: true });

// permissions: install defaultMode:auto + a blanket allow list when neither is set. Never
// downgrade an existing defaultMode (a repo may explicitly want bypassPermissions or acceptEdits
// for local reasons) and never shrink an existing allow list; only add entries this rule
// requires. permissions is the object; we set defaultMode only if absent and union the allow list.
settings.permissions = Object.assign({}, settings.permissions);
if (!settings.permissions.defaultMode) settings.permissions.defaultMode = 'auto';
const existingAllow = Array.isArray(settings.permissions.allow) ? settings.permissions.allow : [];
const mergedAllow = existingAllow.slice();
for (const entry of PERMISSIONS_ALLOW) {
  if (!mergedAllow.includes(entry)) mergedAllow.push(entry);
}
settings.permissions.allow = mergedAllow;

// autoMode.allow: union the ruling prose in. A repo may carry additional narrow-rule entries
// (Self-Modification / External System Writes elaboration); keep them.
settings.autoMode = Object.assign({}, settings.autoMode);
const existingAutoAllow = Array.isArray(settings.autoMode.allow) ? settings.autoMode.allow : [];
if (!existingAutoAllow.includes(AUTOMODE_ALLOW_RULING)) {
  settings.autoMode.allow = [AUTOMODE_ALLOW_RULING].concat(existingAutoAllow);
} else {
  settings.autoMode.allow = existingAutoAllow;
}

// ---------------------------------------------------------------------------------------------
// The cloud bootstrap hook. Body copied from the template beside this script; the SessionStart
// entry prepended so the bootstrap runs before any hook that needs gh, the skills or the rules
// text. Detection is by COMMAND PATH, not by a tag: claude-dotfiles' own entry predates this
// script and carries no tag, and a second entry pointing at the same script would double the
// bootstrap (the issue 166 shape).
// ---------------------------------------------------------------------------------------------
const HOOK_REL = '.claude/hooks/session-start.sh';
const SIDECAR_REL = '.claude/hooks/session-start-bootstrap.sh';
const HOOK_TEMPLATE = path.join(__dirname, 'session-start.sh');
const hookBody = fs.readFileSync(HOOK_TEMPLATE, 'utf8');

// Issue 542: a repo may already own a `session-start.sh` that is NOT this template (aac-routines
// used the name for its test-deps hook). Classify the destination by CONTENT, never by existence:
// an earlier copy of the template carries both markers and is overwritten in place; anything
// else is somebody's hook and is left byte-for-byte, with the bootstrap installed beside it under
// SIDECAR_REL and the SessionStart entry wired to that path instead.
const isTemplateCopy = (text) => text.includes('aac-bootstrap') && text.includes('CLAUDE_CODE_REMOTE');
const readOrNull = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
const primaryPath = path.join(root, HOOK_REL);
const sidecarPath = path.join(root, SIDECAR_REL);
const primaryHad = readOrNull(primaryPath);
let hookRel = HOOK_REL;
let keptForeign = null;
if (readOrNull(sidecarPath) !== null) {
  hookRel = SIDECAR_REL; // a previous run already chose the sidecar; keep using it
} else if (primaryHad !== null && primaryHad.trim() !== '' && !isTemplateCopy(primaryHad)) {
  hookRel = SIDECAR_REL;
  keptForeign = HOOK_REL;
}
// Wired as `bash "<path>"`, never as the bare path (harness v30, issue 614). The bare form made
// the file's executable bit decide whether the bootstrap ran at all: `fs.chmodSync` below is
// invisible to git on Windows (`core.fileMode=false`), the 2026-09-18 sweep committed the hook as
// 100644 in every repo it touched, and each cloud session then died with exit 126 five
// milliseconds into SessionStart — before the hook's own failure marker could say anything.
// Quoted, because one harnessed repo lives under a path with a space.
const HOOK_COMMAND = 'bash "$CLAUDE_PROJECT_DIR/' + hookRel + '"';
const HOOK_ENTRY = {
  hooks: [{
    type: 'command',
    command: HOOK_COMMAND,
    timeout: 120,
    statusMessage: 'Cloud container: installing the aac-skills payload...',
  }],
};

const hookDest = path.join(root, hookRel);
const hookHad = readOrNull(hookDest);
let hookAction = 'unchanged';
if (hookHad !== hookBody) {
  hookAction = hookHad === null ? 'installed' : 'updated';
  fs.mkdirSync(path.dirname(hookDest), { recursive: true });
  fs.writeFileSync(hookDest, hookBody);
}
if (keptForeign && hookAction === 'installed') {
  hookAction = 'installed alongside ' + keptForeign + ' (kept: not a copy of the template)';
}
// Always ensure the executable bit: a copy landed by a tool that drops it never runs.
try { fs.chmodSync(hookDest, 0o755); } catch (_e) { /* a filesystem with no mode bit to set */ }

// The bit git COMMITS is a separate fact from the bit on disk (issue 614): with core.fileMode
// false — every Windows checkout — `git add` records 100644 whatever chmod did, and the delivered
// copy runs nowhere. Stage the file as 100755 when this is a git work tree and the index does not
// already say so; outside git, or without git on PATH, there is nothing to stage.
let indexModeAction = null;
const git = (...args) => spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8' });
if (git('rev-parse', '--is-inside-work-tree').stdout?.trim() === 'true') {
  const listed = git('ls-files', '-s', '--', hookRel).stdout || '';
  if (!listed.startsWith('100755 ')) {
    if (git('add', '--', hookRel).status === 0
        && git('update-index', '--chmod=+x', '--', hookRel).status === 0) {
      indexModeAction = 'staged ' + hookRel + ' as 100755 (git update-index --chmod=+x)';
    }
  }
}

settings.hooks = Object.assign({}, settings.hooks);
const sessionStart = Array.isArray(settings.hooks.SessionStart) ? settings.hooks.SessionStart : [];
// An entry naming the hook by path is ours whatever its spelling; the pre-v30 bare-path form is
// rewritten to the `bash` form in place, keeping its position and everything else in the group.
let wired = false;
for (const group of sessionStart) {
  const inner = group && Array.isArray(group.hooks) ? group.hooks : [];
  for (const h of inner) {
    if (!(h && typeof h.command === 'string' && h.command.includes(hookRel))) continue;
    wired = true;
    if (h.command !== HOOK_COMMAND && /^"?\$CLAUDE_PROJECT_DIR\//.test(h.command)) {
      h.command = HOOK_COMMAND;
    }
  }
}
settings.hooks.SessionStart = wired ? sessionStart : [HOOK_ENTRY].concat(sessionStart);

const settingsChanged = JSON.stringify(settings) !== before;
if (settingsChanged) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2).split('\n').join(EOL) + EOL);
}

if (!settingsChanged && hookAction === 'unchanged' && !indexModeAction) {
  console.log('already delivered: bootstrap hook + plugin + posture in', file);
  process.exit(0);
}
console.log('bootstrap hook', hookAction + ':', hookDest);
if (indexModeAction) console.log(indexModeAction);
console.log(settingsChanged
  ? 'declared ' + PLUGIN + ' + posture (issue 543) + the SessionStart bootstrap hook in ' + file
  : 'settings already carried the plugin, the posture and the SessionStart hook: ' + file);
