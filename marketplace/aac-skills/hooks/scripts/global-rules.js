#!/usr/bin/env node
// UserPromptSubmit hook — delivers the global rules text in full, every prompt (issue 209).
//
// WHY: a cloud container has no live ~/.claude, so the four standing disciplines that a PC
// session gets from ~/.claude/CLAUDE.md never reach it. The packager copies that section into
// the payload at rules/global-rules.md (one source — the PC file — no hand duplicate) and this
// hook injects it as additionalContext on every prompt, so prompt 1 and prompt 2 both carry the
// rules with no file read. governance-reminder.js stays: it is the short per-turn reminder, this
// is the text it summarises.
//
// WHY CHUNKED: measured in this container on 2026-09-16 (Claude Code binary at
// /opt/claude-code/bin/claude, headless `claude -p` with a probe hook in a scratch
// CLAUDE_CONFIG_DIR): a hook's additionalContext reaches the model whole at 10,000 bytes and is
// replaced by `<persisted-output> Output too large (...). Full output saved to: ... Preview
// (first 2KB):` at 10,240 bytes. The cap is per hook output, not per prompt — two hooks emitting
// 8,000 bytes each both arrived whole — so the rules file (about 12 KB) ships as N hook entries,
// each one part of a greedy line-packed split under PART_BYTES. The packager emits exactly one
// manifest entry per part.
//
// NO DOUBLING ON A PC (issue 209 criterion 4): where a global CLAUDE.md already carries this text
// the session has it once already, so the hook exits silently rather than injecting a second copy.
// The test is the rules file's own first line, so it cannot drift from the text being delivered.
// GLOBAL_RULES_HOOK_FORCE=1 runs anyway (local end-to-end testing).
//
// Reads the hook JSON on stdin (ignored) and emits additionalContext. Runs on every prompt —
// keep it fast and dependency-free.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Body bytes per part. Comfortably under the measured 10,000-byte pass-through so the header and
// any UTF-8 rounding still fit.
const PART_BYTES = 6000;

function rulesFile() {
  if (process.env.GLOBAL_RULES_FILE) return process.env.GLOBAL_RULES_FILE;
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return path.join(root, 'rules', 'global-rules.md');
  // Not running as a plugin (a direct invocation, e.g. a test): the payload layout is
  // <root>/hooks/scripts/this-file, so the rules sit two levels up.
  return path.resolve(__dirname, '..', '..', 'rules', 'global-rules.md');
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

function contextFor(index) {
  let text;
  try {
    text = fs.readFileSync(rulesFile(), 'utf8');
  } catch (_) {
    return null; // no rules in the payload: nothing to say, and nothing to fail
  }
  const firstLine = text.split('\n', 1)[0].trim();
  if (process.env.GLOBAL_RULES_HOOK_FORCE !== '1' && liveCopyPresent(firstLine)) return null;
  const parts = splitParts(text, PART_BYTES);
  if (index < 1 || index > parts.length) return null;
  const header = `GLOBAL RULES (part ${index} of ${parts.length} — the standing disciplines from `
    + 'the owner\'s global CLAUDE.md, delivered from the plugin payload because a container has no '
    + 'live tree. They apply to this session in full):';
  return header + '\n' + parts[index - 1];
}

const index = Number.parseInt(process.argv[2] || '1', 10) || 1;
const additionalContext = contextFor(index);

let buf = '';
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  if (additionalContext === null) return; // silent no-op: a 0-exit hook with no stdout
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
    suppressOutput: true,
  }));
});
// stdin may never close if the host gives us nothing — don't hang the turn.
setTimeout(() => process.exit(0), 3000).unref();
