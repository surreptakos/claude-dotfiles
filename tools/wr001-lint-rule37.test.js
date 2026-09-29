// wr001-lint Rule 37: a run-in heading inside a list item ("Can install. As a
// starting point...") is an error in a formal document and a warning otherwise.
// Dan caught two in the OSH delegation emails on 2026-09-29; the regex pass
// had let them through. Jev is off (ask: null) so the test is regex-only.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPTS = path.join(__dirname, "..", "aac-skills", "aac-house-writing-standard", "scripts");
const lint = require(path.join(SCRIPTS, "wr001-lint.js"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wr001-r37-"));
let n = 0;
async function findings(text, extra = []) {
  const f = path.join(dir, `Customer - Project - Email - 2026-09-29 - v${n++}.md`);
  fs.writeFileSync(f, text);
  const out = [];
  const code = await lint.run([f, "--json", ...extra], { ask: null, log: (s) => out.push(s), error: (s) => out.push(s) });
  return { code, findings: JSON.parse(out.join("\n")).results[0].findings.filter((x) => x.rule === 37) };
}

const RUN_IN = [
  "Hi Rob,",
  "",
  "1. Which hardware systems can we install, and which can we not?",
  "   1. Can install. As a starting point, the systems on the account today are VISTA-128BPT and PW7K1IC Pro-Watch.",
  "   2. Cannot install. Any platform or hardware we will not touch, with a sentence on why.",
  "   3. Question 2, counts. The column on the tab is headed by state.",
  "",
].join("\n");

const SENTENCES = [
  "Hi Rob,",
  "",
  "1. Which hardware systems can we install, and which can we not?",
  "   1. The first list is the systems we can install. Start from the systems on the account today.",
  "   2. The second list is the systems we cannot install: any platform or hardware we will not touch.",
  "   3. Tab 1 has sixteen sites marked closed. Several had work orders this summer.",
  "   4. Yes. The panel is on the account.",
  "",
  "Can install. A paragraph, not a list item, is not a run-in heading for this check.",
  "",
].join("\n");

test("Rule 37: a one-to-three-word label ending in a period inside a list item is an ERROR when formal", async () => {
  const { code, findings: f } = await findings(RUN_IN, ["--formal"]);
  assert.strictEqual(code, 1);
  assert.deepStrictEqual(f.map((x) => [x.line, x.sev, x.text]), [[4, "error", "Can install."], [5, "error", "Cannot install."], [6, "error", "Question 2, counts."]]);
});

test("Rule 37: the same label is a WARN in ordinary prose and does not move the exit code", async () => {
  const { code, findings: f } = await findings(RUN_IN, ["--prose"]);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(f.map((x) => x.sev), ["warn", "warn", "warn"]);
});

test("Rule 37: full sentences, a Yes., and a paragraph opener are not flagged", async () => {
  const { code, findings: f } = await findings(SENTENCES, ["--formal"]);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(f, []);
});
