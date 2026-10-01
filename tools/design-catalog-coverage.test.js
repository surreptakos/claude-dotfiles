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
  for (const r of committed().rows.filter((x) => "words" in x)) {
    const rel = r.file.replace(`vendor/${r.skill}/`, "");
    const line = inputs.vendored[r.skill][rel].toString("utf8").replace(/\r\n/g, "\n").split("\n")[r.line - 1];
    assert.ok(line.includes(r.words), `${r.id}: ${r.file}:${r.line}`);
  }
});

test("all six sources are vendored at their pins, each with provenance", () => {
  const pins = { "accessibility-review": "da38ec1", "frontend-design": "8a1541c", impeccable: "0d6b47e",
    "taste-skill": "ce26fc2", "ui-ux-pro-max": "09170ee", "emil-design-eng": "d16ebe6" };
  const { sources } = cat.readInputs().provenance;
  assert.deepStrictEqual(sources.map((s) => s.skill).sort(), Object.keys(pins).sort());
  for (const s of sources) {
    assert.ok(s.commit.startsWith(pins[s.skill]), `${s.skill} is at ${s.commit}`);
    assert.ok(s.repo && s.path && Object.keys(s.files).length, `${s.skill} has no provenance`);
  }
});

test("AAC-WR-001 Rules 75 to 102 and every token are rows that cite, never restate", () => {
  const rows = committed().rows;
  for (let n = 75; n <= 102; n++) {
    const r = rows.filter((x) => x.skill === "AAC-WR-001" && x.cites === `Rule ${n}`);
    assert.strictEqual(r.length, 1, `Rule ${n}`);
    assert.ok(!("words" in r[0]));
  }
  const tokens = cat.designTokens(fs.readFileSync(require("path").join(cat.TARGET, "..", "..", "DESIGN-SYSTEM.md"), "utf8"));
  assert.ok(tokens.length > 0);
  assert.strictEqual(rows.filter((x) => x.skill === "AAC tokens").length, tokens.length);
});

test("impeccable's side-stripe rule has its own row, caught by D08", () => {
  const r = committed().rows.filter((x) => x.skill === "impeccable" && /border-left/.test(x.words || "")
    && x.file === "vendor/impeccable/reference/craft-floor.md");
  assert.strictEqual(r.length, 1);
  assert.ok(r[0].checks.some((c) => c.detector === "D08"), JSON.stringify(r[0]));
});

test("TELLS.md is what the generator writes, and a hand edit is reported stale", () => {
  const fresh = cat.outputs(cat.readInputs());
  const current = { [cat.TARGET]: fs.readFileSync(cat.TARGET, "utf8"), [cat.TELLS]: fs.readFileSync(cat.TELLS, "utf8") };
  assert.deepStrictEqual(cat.stale(fresh, current), []);
  current[cat.TELLS] = current[cat.TELLS].replace("- `A11Y-001`", "- `A11Y-001` (edited)");
  assert.deepStrictEqual(cat.stale(fresh, current), [cat.TELLS]);
});

test("a catalogued conflict names the winning source and the precedence reason", () => {
  const c = committed();
  assert.ok(c.conflicts.length > 0);
  for (const k of c.conflicts) {
    const win = c.rows.find((r) => r.id === k.winner);
    assert.strictEqual(win.skill, k.winner_source);
    assert.match(k.reason, new RegExp(`^${k.winner_source} is rank 1 .* precedence field`));
  }
});

test("mutation: a conflict won by the lower-ranked source fails", () => {
  const c = committed();
  const k = c.conflicts[0];
  [k.winner, k.loser] = [k.loser, k.winner];
  k.winner_source = c.rows.find((r) => r.id === k.winner).skill;
  assert.ok(flags(cat.check(c, cat.readInputs()), new RegExp(`^${k.id} names ${k.winner_source} the winner`)));
});

test("mutation: a same-tier conflict with no ruling fails the build", () => {
  const inputs = cat.readInputs();
  inputs.conflicts.conflicts.push({ id: "CONFLICT-900", rows: ["A11Y-008", "UUX-059"], topic: "target size" });
  assert.throws(() => cat.build(inputs), /CONFLICT-900: .* share a precedence tier; the entry needs a ruling/);
});

test("mutation: an AAC-WR-001 rule with no row fails", () => {
  const inputs = cat.readInputs();
  inputs.house.wr001 = inputs.house.wr001.filter((e) => e.rule !== 80);
  assert.throws(() => cat.build(inputs), /AAC-WR-001 Rule 80 has no entry in catalog\/aac\.checks\.json/);
  const c = committed();
  c.rows = c.rows.filter((r) => r.id !== "AAC-WR-080");
  assert.ok(flags(cat.check(c, cat.readInputs()), /^AAC-WR-001 Rule 80 has 0 rows, not 1$/));
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
