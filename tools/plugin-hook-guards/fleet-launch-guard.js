#!/usr/bin/env node
// Fleet launch guard — PreToolUse on Workflow. Refuses a ticket-fleet launch from the wrong folder.
//
// WHY (Dan, 2026-09-28: "I've seen it happen too many times"). The fleet's build agents run in
// worktrees the runtime cuts from the SESSION's current checkout, and its Setup measures that same
// checkout as the one to work in. A launch from the wrong folder wastes the whole wave:
//   - 2026-09-25, run wf_5d44df1b-d11: aac-sales-cockpit's fleet script launched while the session
//     sat in claude-dotfiles/aac-skills/grill-ready-for-human. Both verifiers looked for cockpit
//     branches in claude-dotfiles, and the report writer opened claude-dotfiles PR 859, which
//     deleted 262 lines of that repo's FOLLOW-UPS.md.
//   - 2026-09-28, run wf_408398a5-db6: launched while the session sat in /home/user, not a repo.
//     All three implementer attempts died with "Cannot create agent worktree: not in a git
//     repository". The same failure hit runs wf_c979322f-62f and wf_58a8fd09-12e (issue 892).
// The fleet script cannot catch the wrong-repo case itself: it never learns its own path. This hook
// sees both the `scriptPath` being launched and the session's `cwd`, before a single agent is spent.
//
// RULES — a Workflow call whose scriptPath or name names ticket-fleet is DENIED when:
//   1. the session's cwd is not inside a git repository;
//   2. the cwd is inside one but is not its top level (a subfolder is how the wrong-repo run began);
//   3. the scriptPath lives inside a git repository other than the session's.
// A scriptPath outside any repo (the installed plugin's cache copy) skips rule 3. Anything else,
// and any failure of this script itself, allows the call: the guard blocks only a launch it has
// positive evidence is misplaced, and the deny message names the exact `cd` that fixes it.
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** The real absolute top level of the git repository holding `dir`, or null. */
function repoRoot(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).trim();
    return out ? fs.realpathSync(out) : null;
  } catch (e) {
    return null;
  }
}

function realOrResolved(p) {
  try { return fs.realpathSync(p); } catch (e) { return path.resolve(p); }
}

/** The refusal text for a misplaced fleet launch, or null to allow it. `rootOf` is repoRoot in use. */
function launchProblem(input, rootOf) {
  const toolInput = (input && input.tool_input) || {};
  const scriptPath = String(toolInput.scriptPath || '');
  const name = String(toolInput.name || '');
  if (!/ticket-fleet/.test(scriptPath) && !/ticket-fleet/.test(name)) return null;
  const cwd = realOrResolved(String((input && input.cwd) || process.cwd()));
  const root = rootOf(cwd);
  if (!root) {
    return `the session is in ${cwd}, which is not inside a git repository, so every build worktree would fail `
      + '("Cannot create agent worktree: not in a git repository").';
  }
  if (root !== cwd) {
    return `the session is in ${cwd}, a subfolder of ${root}. The fleet works in whatever checkout the session `
      + 'sits in, so launch it from a repository\'s top level.';
  }
  if (scriptPath) {
    const scriptRoot = rootOf(path.dirname(path.resolve(cwd, scriptPath)));
    if (scriptRoot && scriptRoot !== root) {
      return `the fleet script belongs to ${scriptRoot}, but the session is in ${root}. The run would work on `
        + `${root}'s branches and tracker instead of ${scriptRoot}'s.`;
    }
  }
  return null;
}

/** Where the fleet should have been launched from: the script's own repo, else a placeholder. */
function targetRepo(input, rootOf) {
  const toolInput = (input && input.tool_input) || {};
  if (toolInput.scriptPath) {
    const cwd = realOrResolved(String(input.cwd || process.cwd()));
    const r = rootOf(path.dirname(path.resolve(cwd, String(toolInput.scriptPath))));
    if (r) return r;
  }
  return '<the repository the fleet should run on>';
}

function main(raw) {
  let input;
  try { input = JSON.parse(raw || '{}'); } catch (e) { return; }
  let problem = null;
  try { problem = launchProblem(input, repoRoot); } catch (e) { return; }
  if (!problem) return;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: 'ticket-fleet launch refused (fleet-launch-guard): ' + problem
      + ` Fix: run \`cd ${targetRepo(input, repoRoot)}\` in Bash as its own command, then launch the fleet again with the same args.`,
  } }) + '\n');
}

if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => { main(raw); process.exit(0); });
}

module.exports = { launchProblem, repoRoot, targetRepo };
