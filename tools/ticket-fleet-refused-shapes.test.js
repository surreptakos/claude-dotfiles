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

const SKILL = path.join(__dirname, '..', 'aac-skills', 'ticket-fleet', 'SKILL.md');
const HEADING = '## Shell shapes the worktree guard refuses';

function refusedShapesSection() {
  const text = fs.readFileSync(SKILL, 'utf8');
  const start = text.indexOf(HEADING);
  assert.notEqual(start, -1, `SKILL.md must carry the "${HEADING}" section`);
  const rest = text.slice(start + HEADING.length);
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
