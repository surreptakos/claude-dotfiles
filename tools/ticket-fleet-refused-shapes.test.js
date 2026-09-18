#!/usr/bin/env node
/**
 * node --test tools/ticket-fleet-refused-shapes.test.js
 *
 * Issue 494. The ticket-fleet SKILL.md carries a table of command shapes the worktree-isolation
 * guard refuses, so a worker does not spend a turn rediscovering one. Every shape here cost a
 * fleet run or a triage pass a turn before it was written down; this test keeps the rows, and
 * the sentence that explains why a harmless command is still refused, in the table.
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const { sliceFrom } = require('./source-slice.js');

const SKILL = path.join(__dirname, '..', 'aac-skills', 'ticket-fleet', 'SKILL.md');
const HEADING = '## Shell shapes the worktree guard refuses';

function refusedShapesSection(heading = HEADING) {
  const text = fs.readFileSync(SKILL, 'utf8');
  // The section may be the file's last, so the tail is genuinely optional here: sliceFrom pins the
  // heading (a missing one would otherwise slice the file's last character) and the next heading,
  // when there is one, ends the section.
  const rest = sliceFrom(text, heading, `SKILL.md's "${heading}" section`).slice(heading.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

function tableRows(section) {
  return section.split('\n').filter((l) => l.startsWith('| `'));
}

test('the section says the guard rules on the command text, not on what it would do', () => {
  const section = refusedShapesSection();
  assert.match(section, /rules on the command's\s+\*text\*, not on what the command would do/,
    'a reader needs to know a provably harmless shape can still be refused');
});

// Each entry: a marker that only the refused spelling carries, and one the working spelling must name.
const ROWS = [
  { shape: 'heredoc as the whole command', refused: /<<'EOF'.*whole command/, works: /the Write tool/ },
  { shape: 'gh api with a redirect and an exit-code capture', refused: /gh api '<url>' > out\.json; echo exit=\$\?/, works: /`gh api '<url>'` alone/ },
  { shape: '--jq string concatenation', refused: /--jq '\.state \+ "/, works: /one plain field per call/ },
  { shape: 'HOME= in front of a command', refused: /`HOME=\S+ node /, works: /narrower variable/ },
  { shape: 'git ls-remote behind the caveman wrapper', refused: /`git ls-remote --heads origin <branch>`/, works: /gh api repos\/\{owner\}\/\{repo\}\/git\/refs\/heads\/<branch>/ },
];

for (const row of ROWS) {
  test(`the table carries a row for: ${row.shape}`, () => {
    const rows = tableRows(refusedShapesSection());
    const hit = rows.find((r) => row.refused.test(r));
    assert.ok(hit, `no table row matches ${row.refused} - the ${row.shape} row is missing`);
    assert.match(hit, row.works, `the ${row.shape} row must name its working spelling`);
  });
}

// Issue 545. The auto-mode safety classifier is the second gate, above the worktree guard: it
// refuses on the shape of the line rather than the action, non-deterministically, and workers that
// read a refusal as a rule stalled (issue 212 attempt 1, deliveries 489 and 493 in run 6aac3d3b).
// Its table needs the same treatment - refused shape, the category quoted, the working spelling.
const CLASSIFIER_HEADING = '## Shapes the auto-mode classifier refuses';

test('the classifier section leads with the retry-once rule', () => {
  const section = refusedShapesSection(CLASSIFIER_HEADING);
  assert.match(section, /retry the identical command once before changing anything/,
    'the rule that makes a refusal cost one turn instead of a ticket must head the table');
  assert.match(section, /never defer a ticket on a\s+refusal/,
    'the table is worthless if a worker still reads a refusal as a reason to stop');
  assert.match(section, /shape of the line\*?\*?, not on the action/,
    'a reader needs to know the refusal is not a ruling on what the command would do');
});

// Each entry: a marker only the refused spelling carries, the classifier category it is refused
// with, and a marker the working spelling must name.
const CLASSIFIER_ROWS = [
  { shape: 'compound Bash beside a sanctioned write', refused: /--apply` - a compound Bash line/, category: /\[External System Writes\]/, works: /split the turn/ },
  { shape: 'scheduling text naming land or merge', refused: /`send_later`.*says "land"/, category: /\[Irreversible Operations\]/, works: /read the state of/ },
  { shape: 'gh api tracker write from Bash', refused: /`gh api --method POST\\\|PATCH/, category: /\[External System Writes\]/, works: /mcp__github__issue_write/ },
  { shape: 'heredoc edit under .claude/ or aac-skills/', refused: /<<'PY'.*`\.claude\/` or `aac-skills\/`/, category: /\[Self-Modification\]/, works: /the Write or Edit tool/ },
  { shape: 'git commit -F from the shared scratchpad', refused: /`git commit -F \/tmp\/fleet-<run>\/<file>`/, category: /\[Instruction Poisoning\]/, works: /inside your own worktree/ },
  { shape: 'a script carrying a quoted acceptance criterion', refused: /refused because criterion text was among its arguments/, category: /\[Instruction Poisoning\]/, works: /pass the ticket number/ },
  { shape: 'rm -rf of anything', refused: /`rm -rf <anything>`/, category: /\[Destructive Operations\]/, works: /git clean -fd/ },
  { shape: 'ordinary single commands, rotating reasons', refused: /rotating reasons/, category: /\[Auto-Mode Bypass\]/, works: /re-issue the byte-identical command once/ },
];

test('the classifier table carries at least the seven rows the evidence names', () => {
  const rows = tableRows(refusedShapesSection(CLASSIFIER_HEADING));
  assert.ok(rows.length >= 7, `the classifier table has ${rows.length} rows, fewer than the seven required`);
});

for (const row of CLASSIFIER_ROWS) {
  test(`the classifier table carries a row for: ${row.shape}`, () => {
    const rows = tableRows(refusedShapesSection(CLASSIFIER_HEADING));
    const hit = rows.find((r) => row.refused.test(r));
    assert.ok(hit, `no table row matches ${row.refused} - the ${row.shape} row is missing`);
    assert.match(hit, row.category, `the ${row.shape} row must quote the classifier category`);
    assert.match(hit, row.works, `the ${row.shape} row must name its working spelling`);
  });
}
