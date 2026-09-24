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

// The ADHD line follows ~/.claude/.adhd-off (issue 680): absent = on, "on"/"1"/"enforced"/"active"
// = on, anything else = off. The ask-matt gate is the one writer ("stop adhd mode" writes it,
// "start adhd mode" or /i-have-adhd deletes it). Hooks on one event run in parallel, so on the
// switching prompt itself this hook reads the phrase rather than a flag the gate may not have
// written yet -- the same patterns as _adhd_switch_from_prompt in ask_matt_gate.py.
const ADHD_NAME = '(?:the\\s+)?(?:i-have-)?adhd(?:\\s+(?:mode|shaping|rules?))?';
const ADHD_OFF = [
  new RegExp('\\b(?:stop|disable|deactivate|quit|exit|kill|end|pause)\\s+' + ADHD_NAME + '\\b'),
  new RegExp('\\bturn\\s+(?:off\\s+' + ADHD_NAME + '|' + ADHD_NAME + '\\s+off)\\b'),
  /\badhd(?:\s+mode)?\s+(?:off|stop|disabled?)\b/,
];
const ADHD_ON = [
  new RegExp('\\b(?:start|enable|activate|resume|restart)\\s+' + ADHD_NAME + '\\b'),
  new RegExp('\\bturn\\s+(?:on\\s+' + ADHD_NAME + '|' + ADHD_NAME + '\\s+(?:back\\s+)?on)\\b'),
  /\badhd(?:\s+mode)?\s+(?:on|enabled?)\b/,
  /^\/i-have-adhd(?::i-have-adhd)?\s*[.!]*$/,
];
const QUESTION = /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/;

function adhdState(prompt) {
  const text = String(prompt || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (text && !QUESTION.test(text)) {
    if (ADHD_OFF.some((re) => re.test(text))) return 'off';
    if (ADHD_ON.some((re) => re.test(text))) return 'on';
  }
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, '.adhd-off'), 'utf8').trim().toLowerCase();
  } catch (e) {
    return 'on';
  }
  return ['on', '1', 'enforced', 'active'].includes(raw) ? 'on' : 'off';
}

const ADHD_LINES = {
  on: [
    '4. I-HAVE-ADHD: shape every reply so Dan can act. Lead with the next action; number multi-step',
    '   work; restate where we are ("step 3 of 5 done: X. Next: Y"); end with ONE thing he can do in',
    '   under two minutes. Concrete time estimates, never "some work". Show what now works. Errors as',
    '   cause then fix, no "uh oh". Cap lists at five, ranked. No preamble, no recap, no closer.',
    '   Suppress tangents — finish one thing, then offer the next as its own question.',
    '   Standing rule, not a mode. ADHD shapes structure; caveman shapes wording; they do not compete.',
    '   Off switch: "stop adhd mode" (writes ~/.claude/.adhd-off); "start adhd mode" re-enables.',
  ],
  off: [
    '4. ADHD shaping: off (~/.claude/.adhd-off, written by "stop adhd mode"). "start adhd mode" or',
    '   /i-have-adhd turns it back on.',
  ],
};

const CAVEMAN_LINES = {
  ultra: [
    '1. CAVEMAN ULTRA: minimum words; each fact once; strip safe conjunctions. Drop articles/filler/',
    '   hedging/pleasantries. No tool-call narration or self-reference. Lists, tables and bold',
    '   when asked or when parallel/multifaceted content helps (findings, steps, options, files);',
    '   plain prose otherwise. Technical terms, code and error strings stay verbatim.',
    '   Write plainly ONLY for: security warnings, irreversible-action confirmations, genuine ambiguity,',
    '   and code/commits/PRs. Persists until /caveman changes it — long session is NOT an excuse to drift.',
  ],
  full: [
    '1. CAVEMAN FULL: terse. Drop articles/filler/hedging/pleasantries; fragments fine. No tool-call',
    '   narration or self-reference. Lists, tables and bold when asked or when multifaceted content',
    '   helps; plain prose otherwise. Technical terms, code and error strings',
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

function promptOf(raw) {
  try {
    return JSON.parse(raw).prompt || '';
  } catch (e) {
    return '';
  }
}

let buf = '';
process.stdin.on('data', (c) => { buf += c; });
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: LINES.concat(ADHD_LINES[adhdState(promptOf(buf))]).join('\n'),
    },
    suppressOutput: true,
  }));
});
// stdin may never close if the host gives us nothing — don't hang the turn.
setTimeout(() => process.exit(0), 3000).unref();
