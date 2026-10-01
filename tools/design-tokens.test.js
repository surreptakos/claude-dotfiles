// The three copies of the AAC design tokens (DESIGN-SYSTEM.md's Tokens section, build_form.py's
// token block, aac-tokens.css) are generated from assets/aac-tokens.json (issue 1091). Each check
// is shown to fire by a mutation, so it is known to fail, not only known to pass.
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const gen = require("./build-design-tokens.js");

const GEN = require.resolve("./build-design-tokens.js");

test("the committed copies are what the generator writes", () => {
  const current = gen.readCurrent();
  assert.deepStrictEqual(gen.stale(gen.outputs(gen.readSource(), current), current), []);
  const r = spawnSync(process.execPath, [GEN, "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("running the generator twice gives identical output", () => {
  const once = gen.outputs(gen.readSource(), gen.readCurrent());
  const twice = gen.outputs(gen.readSource(), once);
  assert.deepStrictEqual(twice, once);
});

test("a hand edit to any copy fails the check", () => {
  const src = gen.readSource();
  const edits = {
    [gen.DESIGN_SYSTEM]: ["| `accent` | #1161A0 |", "| `accent` | #1161A1 |"],
    [gen.BUILD_FORM]: ["'sz_caption': 18,", "'sz_caption': 16,"],
    [gen.CSS]: ["--aac-space-hair: 1.33px;", "--aac-space-hair: 1px;"],
  };
  for (const [file, [from, to]] of Object.entries(edits)) {
    const current = gen.readCurrent();
    assert.ok(current[file].includes(from), `${file} holds ${from}`);
    current[file] = current[file].replace(from, to);
    assert.deepStrictEqual(gen.stale(gen.outputs(src, current), current), [file]);
  }
});

test("a token value changed in the source reaches all three copies", () => {
  const src = gen.readSource();
  src.color.find((c) => c.token === "accent").hex = "0B4F86";
  const current = gen.readCurrent();
  const fresh = gen.outputs(src, current);
  assert.deepStrictEqual(gen.stale(fresh, current).sort(), [...gen.TARGETS].sort());
  assert.match(fresh[gen.DESIGN_SYSTEM], /\| `accent` \| #0B4F86 \|/);
  assert.match(fresh[gen.BUILD_FORM], /'accent': '0B4F86'/);
  assert.match(fresh[gen.CSS], /--aac-accent: #0B4F86;/);
  // Computed values follow the source: the contrast column is recomputed, never carried over.
  assert.ok(fresh[gen.DESIGN_SYSTEM].includes(`${gen.contrast("0B4F86", "FFFFFF")}:1 on white`));
});
