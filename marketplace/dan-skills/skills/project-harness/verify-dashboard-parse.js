// Regression check for the dashboard's test-health line. Run after editing
// templates/build-dashboard.js:  node verify-dashboard-parse.js
//
// Why this exists: the harness's Verify step used to be "run build-dashboard.js, confirm
// DASHBOARD.md renders". That check passes while the health line is wrong, because a wrong line
// still renders. The original template took the LAST LINE of test output, which for `node --test`
// is a duration on success and a stack-trace brace on failure — so a red suite showed as
// "FAILING — }" and a green one as "duration_ms 150.1037". Rendering was never the risk.
//
// Fixtures below are real captured output, trimmed. Exit 0 = green, 1 = red, 2 = loop broken.
const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, 'templates', 'build-dashboard.js');
const src = fs.readFileSync(TEMPLATE, 'utf8');

/** Evaluate a function DECLARATION and hand back the function. A named function expression does not
 *  bind its own name in the enclosing scope, so wrapping in parens and using the comma operator
 *  throws ReferenceError — which crashes the check instead of reporting on it. */
function evalFn(decl) {
  try { return eval(decl + '; testSummary'); }
  catch (e) {
    console.error('LOOP BROKEN: could not evaluate testSummary from the template: ' + e.message);
    process.exit(2);
  }
}

const fnMatch = /function testSummary\(out\) \{[\s\S]*?\n\}/.exec(src);
if (!fnMatch) {
  console.error('LOOP BROKEN: no testSummary() in the template. Either it regressed to the');
  console.error('last-line form, or it was restructured — read it before trusting this check.');
  process.exit(2);
}
const testSummary = evalFn(fnMatch[0]);

// --- fixtures: real runner output, abbreviated -------------------------------
const NODE_PASS = [
  'ℹ tests 255', 'ℹ suites 0', 'ℹ pass 255', 'ℹ fail 0',
  'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 150.1037'
].join('\n');

const NODE_FAIL = [
  '✖ failing tests:', 'test at core.test.js:12:1', '✖ deliberate failure (0.9ms)',
  '  AssertionError [ERR_ASSERTION]: 1 !== 2', '      at TestContext.<anonymous> (core.test.js:13:10)',
  'ℹ tests 256', 'ℹ pass 255', 'ℹ fail 1', 'ℹ skipped 0', 'ℹ duration_ms 151.2',
  '    generatedMessage: false,', "    code: 'ERR_ASSERTION',", '  }'
].join('\n');

const NODE_SKIP = ['ℹ tests 247', 'ℹ pass 246', 'ℹ fail 0', 'ℹ skipped 1', 'ℹ duration_ms 140'].join('\n');
const JEST_LIKE = ['Tests:  3 failed, 41 passed, 44 total', 'Time:   2.5 s'].join('\n');
const UNKNOWN = ['some runner nobody predicted', 'ALL GOOD'].join('\n');

const cases = [
  { name: 'node --test, passing', out: NODE_PASS, want: /255 passing, 0 failing/ },
  { name: 'node --test, failing', out: NODE_FAIL, want: /255 passing, 1 failing/ },
  { name: 'node --test, skips reported', out: NODE_SKIP, want: /246 passing, 0 failing, 1 skipped/ },
  { name: 'jest/vitest-style counts', out: JEST_LIKE, want: /41 passing, 3 failing/ },
  { name: 'unknown runner falls back to last line', out: UNKNOWN, want: /^ALL GOOD$/ }
];

let red = 0;
cases.forEach(c => {
  const got = testSummary(c.out);
  const ok = c.want.test(got);
  if (!ok) red++;
  console.log((ok ? '  ok   ' : '  FAIL ') + c.name + ' -> ' + JSON.stringify(got));
});

// The two properties that actually matter, stated as assertions rather than implied by the cases.
const passSummary = testSummary(NODE_PASS);
const failSummary = testSummary(NODE_FAIL);
if (/duration_ms/.test(passSummary)) { console.log('  FAIL a healthy run reports a DURATION'); red++; }
if (/^\s*[}\])]/.test(failSummary)) { console.log('  FAIL a red run reports a stack-trace fragment'); red++; }

if (red) {
  console.error('\nRED — ' + red + ' problem(s). The dashboard would misreport suite health.');
  process.exit(1);
}
console.log('\nGREEN — health line reports pass/fail counts across every runner shape checked.');
