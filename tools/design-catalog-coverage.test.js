// CATALOG.json must agree with the vendored design skills it is built from, the same contract
// wr001-coverage.md has with wr001-lint.js: every vendored rule has exactly one row, every row
// cites skill, file and line and names a check, ids are unique, and the count line matches the
// rows (issue 1083). Each failure is shown by a mutation of the real inputs, so the checker is
// known to fire, not only known to pass.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { spawnSync } = require("child_process");
const cat = require("./build-design-catalog.js");

const committed = () => JSON.parse(fs.readFileSync(cat.TARGET, "utf8"));
const flags = (problems, re) => problems.some((p) => re.test(p));

test("the committed catalog passes coverage and is what the generator writes", () => {
  const inputs = cat.readInputs();
  assert.deepStrictEqual(cat.check(committed(), inputs), []);
  assert.strictEqual(fs.readFileSync(cat.TARGET, "utf8"), cat.render(cat.build(inputs)));
  const r = spawnSync(process.execPath, [require.resolve("./build-design-catalog.js"), "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("running the generator twice produces identical output", () => {
  assert.strictEqual(cat.render(cat.build(cat.readInputs())), cat.render(cat.build(cat.readInputs())));
});

test("every row cites skill, file and line, and that line holds the rule's words", () => {
  const inputs = cat.readInputs();
  for (const r of committed().rows) {
    const rel = r.file.replace(`vendor/${r.skill}/`, "");
    const line = inputs.vendored[r.skill][rel].toString("utf8").replace(/\r\n/g, "\n").split("\n")[r.line - 1];
    assert.ok(line.includes(r.words), `${r.id}: ${r.file}:${r.line}`);
  }
});

test("the precedence order is a catalog field: house, design skills, brief", () => {
  const p = committed().precedence;
  assert.deepStrictEqual(p.map((t) => [t.rank, t.tier]), [[1, "house"], [2, "design-skills"], [3, "brief"]]);
  assert.deepStrictEqual(p[0].sources, ["AAC tokens (assets/aac-tokens.css, DESIGN-SYSTEM.md)", "AAC-WR-001"]);
});

test("mutation: a vendored rule with no row fails", () => {
  const inputs = cat.readInputs();
  const src = inputs.vendored["accessibility-review"];
  src["SKILL.md"] = Buffer.from(src["SKILL.md"].toString("utf8") + "\n- **1.4.10** Content reflows at 320 CSS pixels\n");
  assert.ok(flags(cat.check(committed(), inputs), /has no row: "\*\*1\.4\.10\*\*/));
  assert.throws(() => cat.build(inputs), /has no entry in catalog\/accessibility-review\.checks\.json/);
});

test("mutation: a row with no check fails", () => {
  const c = committed();
  c.rows[3].checks = [];
  assert.ok(flags(cat.check(c, cat.readInputs()), new RegExp(`^${c.rows[3].id} has no check$`)));
});

test("mutation: a duplicate id fails", () => {
  const c = committed();
  c.rows[5].id = c.rows[4].id;
  assert.ok(flags(cat.check(c, cat.readInputs()), new RegExp(`^duplicate id ${c.rows[4].id}$`)));
});

test("mutation: a stale count line fails", () => {
  const c = committed();
  const row = c.rows.find((r) => r.checks.some((k) => k.detector));
  row.checks = row.checks.filter((k) => !k.detector);
  const problems = cat.check(c, cat.readInputs());
  assert.deepStrictEqual(problems.length, 1, problems.join("\n"));
  assert.ok(flags(problems, /^count line is stale/));
});
