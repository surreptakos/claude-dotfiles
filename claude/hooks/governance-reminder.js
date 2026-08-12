#!/usr/bin/env node
// UserPromptSubmit hook — re-asserts the three standing disciplines every turn.
//
// WHY: ~/.claude/CLAUDE.md carries the full rules, but a long session drifts off text seen once at
// the top of the context. On 2026-07-31 a session with a per-turn style hook firing ~25 times still
// drifted off it, so this is a floor-raiser, not a guarantee. Kept SHORT on purpose: a wall of text
// injected every turn gets skimmed, which is the failure it is meant to prevent.
//
// Reads the hook JSON on stdin (ignored) and emits additionalContext.
// Runs on every prompt in every project — keep it fast and dependency-free.
'use strict';

const LINES = [
  'GOVERNANCE (always on — full rules in ~/.claude/CLAUDE.md):',
  '1. CAVEMAN ULTRA: minimum words; each fact once; strip safe conjunctions. Drop articles/filler/',
  '   hedging/pleasantries. No tool-call narration,',
  '   no decorative tables, no self-reference. Technical terms, code and error strings stay verbatim.',
  '   Write plainly ONLY for: security warnings, irreversible-action confirmations, genuine ambiguity,',
  '   and code/commits/PRs. Persists all turns — long session is NOT an excuse to drift.',
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
