// wr001-coverage.md must agree with wr001-lint.js: every rule 1..170 once, every
// rule the linter decides marked Pattern or Jev, and nothing marked Pattern or
// Jev that the linter does not decide. Dan, 2026-09-29: Rule 37 sat in the
// standard as an owner ruling for six days with no check; this test makes a
// silent gap impossible.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SCRIPTS = path.join(__dirname, "..", "aac-skills", "aac-house-writing-standard", "scripts");
const js = fs.readFileSync(path.join(SCRIPTS, "wr001-lint.js"), "utf8");
const md = fs.readFileSync(path.join(SCRIPTS, "wr001-coverage.md"), "utf8");

function linterRules() {
  const nums = new Set();
  for (const m of js.matchAll(/\{ rule: (\d+), sev/g)) nums.add(Number(m[1]));
  for (const m of js.matchAll(/rule: (\d+), sev: "(?:warn|error)"/g)) nums.add(Number(m[1]));
  for (const m of js.matchAll(/push\(i, [^,]+, (\d+),/g)) nums.add(Number(m[1]));
  for (const m of js.matchAll(/\[\/[^\]]*?\/gi?, "[^"]*", (\d+)\]/g)) nums.add(Number(m[1]));
  const jev = new Set();
  for (const m of js.matchAll(/^  (\d+): \{/gm)) jev.add(Number(m[1]));
  return { pattern: nums, jev };
}

function tableRows() {
  const rows = [];
  for (const line of md.split("\n")) {
    const m = /^\| (\d+) \| (.+?) \| (Pattern and Jev|Pattern|Jev|Reader|Layout) \| /.exec(line);
    if (m) rows.push({ rule: Number(m[1]), kind: m[3] });
  }
  return rows;
}

test("every rule 1 through 170 has exactly one row", () => {
  const rows = tableRows();
  const nums = rows.map((r) => r.rule).sort((a, b) => a - b);
  assert.deepStrictEqual(nums, Array.from({ length: 170 }, (_, i) => i + 1));
});

test("the table's Pattern and Jev rows are exactly the rules the linter decides", () => {
  const { pattern, jev } = linterRules();
  const rows = tableRows();
  const tablePattern = new Set(rows.filter((r) => r.kind === "Pattern" || r.kind === "Pattern and Jev").map((r) => r.rule));
  const tableJev = new Set(rows.filter((r) => r.kind === "Jev" || r.kind === "Pattern and Jev").map((r) => r.rule));
  assert.deepStrictEqual([...tablePattern].sort((a, b) => a - b), [...pattern].sort((a, b) => a - b));
  assert.deepStrictEqual([...tableJev].sort((a, b) => a - b), [...jev].sort((a, b) => a - b));
});

test("the counts line matches the rows", () => {
  const rows = tableRows();
  const count = (k) => rows.filter((r) => r.kind === k).length;
  const line = /^Counts: (.+)\.$/m.exec(md)[1];
  assert.strictEqual(line, `Pattern ${count("Pattern")}, Pattern and Jev ${count("Pattern and Jev")}, Jev ${count("Jev")}, Reader ${count("Reader")}, Layout ${count("Layout")}`);
});

test("the index paragraph names the same pattern count as the linter", () => {
  const idx = fs.readFileSync(path.join(SCRIPTS, "..", "references", "00-INDEX.md"), "utf8");
  const m = /decides (\d+) of the 170 rules by pattern/.exec(idx);
  assert.ok(m, "index paragraph");
  assert.strictEqual(Number(m[1]), linterRules().pattern.size);
});
