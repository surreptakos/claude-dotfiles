#!/usr/bin/env node
// Global rules delivery hook — full text once at SessionStart, a short digest per prompt.
//
// WHY: a cloud container has no live ~/.claude, so the four standing disciplines that a PC
// session gets from ~/.claude/CLAUDE.md never reach it. The packager copies that section into
// the payload at rules/global-rules.md (one source — the PC file — no hand duplicate) and this
// hook injects it.
//
// TWO MODES (issue 533):
//
//   global-rules.js start <k>   SessionStart. Part k of the full rules text. Fires on every
//                               SessionStart source — startup, resume, clear and compact — so a
//                               compacted session gets the rulebook back whole, not a summary of
//                               it. The manifest wires one entry per part and no matcher.
//   global-rules.js digest      UserPromptSubmit. ONE part, the packager-generated digest at
//                               rules/global-rules-digest.md (<1,500 bytes).
//
// WHY THE SPLIT: issue 209 shipped the whole ~12 KB text on EVERY prompt. It arrived, but it cost
// ~12 KB of input per turn for text the session already had in context from the turn before. The
// full text belongs where context begins (and begins again — compaction drops it); what a long
// session needs per turn is the short reminder that the rules are there and what they say, which
// is the digest. governance-reminder.js stays: it reads the caveman flag, which the digest cannot.
//
// WHY CHUNKED: measured in this container on 2026-09-16 (Claude Code binary at
// /opt/claude-code/bin/claude, headless `claude -p` with a probe hook in a scratch
// CLAUDE_CONFIG_DIR): a hook's additionalContext reaches the model whole at 10,000 bytes and is
// replaced by `<persisted-output> Output too large (...). Full output saved to: ... Preview
// (first 2KB):` at 10,240 bytes. The cap is per hook output, not per prompt — two hooks emitting
// 8,000 bytes each both arrived whole — so the rules file (about 12 KB) ships as N hook entries,
// each one part of a greedy line-packed split under PART_BYTES. The packager emits exactly one
// manifest entry per part. The same cap applies to SessionStart (probe #175: 15.1KB -> 2KB
// preview), so the chunking carries over unchanged.
//
// NO DOUBLING ON A PC (issue 209 criterion 4): where a global CLAUDE.md already carries this text
// the session has it once already, so the hook exits silently rather than injecting a second copy
// — in either mode. The test is the rules file's own first line, so it cannot drift from the text
// being delivered. GLOBAL_RULES_HOOK_FORCE=1 runs anyway (local end-to-end testing).
//
// Reads the hook JSON on stdin (ignored — the mode is an argument, and every SessionStart source
// gets the text) and emits additionalContext. Keep it fast and dependency-free.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Body bytes per part. Comfortably under the measured 10,000-byte pass-through so the header and
// any UTF-8 rounding still fit.
const PART_BYTES = 6000;

function payloadFile(name) {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return path.join(root, 'rules', name);
  // Not running as a plugin (a direct invocation, e.g. a test): the payload layout is
  // <root>/hooks/scripts/this-file, so the rules sit two levels up.
  return path.resolve(__dirname, '..', '..', 'rules', name);
}

function rulesFile() {
  return process.env.GLOBAL_RULES_FILE || payloadFile('global-rules.md');
}

function digestFile() {
  return process.env.GLOBAL_RULES_DIGEST_FILE || payloadFile('global-rules-digest.md');
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return null; // not in the payload: nothing to say, and nothing to fail
  }
}

// Greedy line packing. The packager counts parts with the same rule, so part k here is part k
// there; a line longer than PART_BYTES becomes a part of its own rather than being cut.
function splitParts(text, limit) {
  const parts = [];
  let cur = '';
  for (const line of text.split(/(?<=\n)/)) {
    if (!line) continue;
    if (cur && Buffer.byteLength(cur + line, 'utf8') > limit) {
      parts.push(cur);
      cur = line;
    } else {
      cur += line;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

function liveCopyPresent(firstLine) {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  try {
    return fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8').includes(firstLine);
  } catch (_) {
    return false;
  }
}

// The session already has the rules from its own global memory file: say nothing, in either mode.
function alreadyCarried(rules) {
  if (process.env.GLOBAL_RULES_HOOK_FORCE === '1') return false;
  return liveCopyPresent(rules.split('\n', 1)[0].trim());
}

function startContext(index) {
  const text = read(rulesFile());
  if (text === null || alreadyCarried(text)) return null;
  const parts = splitParts(text, PART_BYTES);
  if (index < 1 || index > parts.length) return null;
  const header = `GLOBAL RULES (part ${index} of ${parts.length} — the owner's global CLAUDE.md `
    + 'in full, delivered from the plugin payload because a container has no live tree. Every '
    + 'standing directive in it applies to this session, and a short digest repeats the four '
    + 'disciplines on every prompt):';
  return header + '\n' + parts[index - 1];
}

function digestContext() {
  const digest = read(digestFile());
  if (digest === null) return null;
  const rules = read(rulesFile());
  if (rules !== null && alreadyCarried(rules)) return null;
  // The packager cannot know where the plugin is installed, so the digest's one pointer carries a
  // token; resolve it here to a path the model can open. governance-reminder.js drops its own
  // pointer where this file exists, so a prompt carries exactly one (issue 533).
  return digest.trimEnd().split('__RULES_FILE__').join(rulesFile());
}

function resolve(argv) {
  const mode = argv[0];
  if (mode === 'digest') {
    return { event: 'UserPromptSubmit', context: digestContext() };
  }
  if (mode === 'start') {
    const index = Number.parseInt(argv[1] || '1', 10) || 1;
    return { event: 'SessionStart', context: startContext(index) };
  }
  return { event: 'SessionStart', context: null };
}

const { event, context: additionalContext } = resolve(process.argv.slice(2));

let buf = '';
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  if (additionalContext === null) return; // silent no-op: a 0-exit hook with no stdout
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext,
    },
    suppressOutput: true,
  }));
});
// stdin may never close if the host gives us nothing — don't hang the turn.
setTimeout(() => process.exit(0), 3000).unref();
