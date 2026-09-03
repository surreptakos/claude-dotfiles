#!/usr/bin/env node
// UserPromptSubmit hook — re-asserts the three standing disciplines every turn.
//
// WHY: ~/.claude/CLAUDE.md carries the full rules, but a long session drifts off text seen once at
// the top of the context. On 2026-07-31 a session with a per-turn style hook firing ~25 times still
// drifted off it, so this is a floor-raiser, not a guarantee. Kept SHORT on purpose: a wall of text
// injected every turn gets skimmed, which is the failure it is meant to prevent.
//
// The caveman line follows the mode flag the caveman plugin's tracker writes
// (<config dir>/.caveman-active): ultra, full, lite, or absent = off. Dan, 2026-09-03: this hook
// used to hard-code ULTRA, which (with the ask-matt gate rewriting the flag) made /caveman lite and
// /caveman off last one turn. Now the tracker is the single writer and this hook only reads.
//
// Reads the hook JSON on stdin (ignored) and emits additionalContext.
// Runs on every prompt in every project — keep it fast and dependency-free.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function cavemanMode() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, '.caveman-active'), 'utf8').trim().toLowerCase();
  } catch (e) {
    return 'off';
  }
  if (raw.startsWith('wenyan')) raw = raw.replace(/^wenyan-?/, '') || 'full';
  if (raw === 'lite' || raw === 'full' || raw === 'ultra') return raw;
  if (raw === 'commit' || raw === 'review' || raw === 'compress') return 'full';
  return 'off';
}

const CAVEMAN_LINES = {
  ultra: [
    '1. CAVEMAN ULTRA: minimum words; each fact once; strip safe conjunctions. Drop articles/filler/',
    '   hedging/pleasantries. No tool-call narration,',
    '   no decorative tables, no self-reference. Technical terms, code and error strings stay verbatim.',
    '   Write plainly ONLY for: security warnings, irreversible-action confirmations, genuine ambiguity,',
    '   and code/commits/PRs. Persists until /caveman changes it — long session is NOT an excuse to drift.',
  ],
  full: [
    '1. CAVEMAN FULL: terse. Drop articles/filler/hedging/pleasantries; fragments fine. No tool-call',
    '   narration, no decorative tables, no self-reference. Technical terms, code and error strings',
    '   stay verbatim. Write plainly for security warnings, irreversible actions, genuine ambiguity,',
    '   and code/commits/PRs. Persists until /caveman changes it.',
  ],
  lite: [
    '1. CAVEMAN LITE: concise plain English, complete sentences allowed. Drop filler, pleasantries,',
    '   hedging and tool-call narration. Technical terms, code and error strings stay verbatim.',
    '   Persists until /caveman changes it.',
  ],
  off: [
    '1. CAVEMAN: off (flag cleared). Normal prose; pre-send lint not required. /caveman ultra|full|lite',
    '   re-enables it.',
  ],
};

const LINES = [
  'GOVERNANCE (always on — full rules in ~/.claude/CLAUDE.md):',
  ...CAVEMAN_LINES[cavemanMode()],
  '2. YES: evidence over intuition (no "probably"/"should be" without a check). Investigate before',
  '   asking. Verify every change yourself and show the output — never "you can test it now".',
  '   Gates: backup/rollback named before editing or deploying; blast radius before changing;',
  '   conclusion integrity before a root-cause claim; ripple check before saying done.',
  '   2 failures switch approach, 3 five-step audit, 4 minimal repro, 5+ structured handoff.',
  '   Check real exit codes, not piped output.',
  '3. ASK-MATT: name which flow applies before starting work (see the map in ~/.claude/CLAUDE.md).',
];

let buf = '';
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: LINES.join('\n'),
    },
    suppressOutput: true,
  }));
});
// stdin may never close if the host gives us nothing — don't hang the turn.
setTimeout(() => process.exit(0), 3000).unref();
