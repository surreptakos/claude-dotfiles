// wr001-lint Rule 169 and Appendix G12 (standard v0.11): the legalistic
// register in correspondence is a WARN in informal writing and is not reported
// at all in a formal document (contracts keep their register, Rules 137 and
// 153). More than one contract-section citation in informal writing warns once.
// There is no length check. Drawn from the ForeFront closeout, September 28,
// 2026. Jev is off (ask: null) so the test is regex-only.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPTS = path.join(__dirname, "..", "aac-skills", "aac-house-writing-standard", "scripts");
const lint = require(path.join(SCRIPTS, "wr001-lint.js"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wr001-r169-"));
let n = 0;
async function run(text, extra = []) {
  const f = path.join(dir, `ForeFront - Closeout - Email - 2026-09-28 - v${n++}.md`);
  fs.writeFileSync(f, text);
  const out = [];
  const code = await lint.run([f, "--json", ...extra], { ask: null, log: (s) => out.push(s), error: (s) => out.push(s) });
  const all = JSON.parse(out.join("\n")).results[0].findings;
  return { code, all, r169: all.filter((x) => x.rule === 169) };
}

const LEGALISTIC = [
  "Hi Tom,",
  "",
  "Under Section 12.3, please treat this email as our written notice that retainage is held.",
  "Pursuant to Section 9.1 of the agreement, AAC reserves the right to adjust the schedule.",
  "For the avoidance of doubt, nothing herein is waived, and it is our position that the work is complete.",
  "We send this without prejudice and without waiving any claim, hereby and in accordance with Section 4.",
  "",
].join("\n");

const PLAIN = [
  "Hi Tom,",
  "",
  "We are holding the retainage until the five closeout items arrive.",
  "Your $55,700 balance less the retainage of $13,895 is due on receipt.",
  "Section 12.3 is the clause you asked about.",
  "",
  "Thanks,",
  "Dan",
  "",
].join("\n");

test("Rule 169: every G12 phrase the linter owns is a WARN in informal writing", async () => {
  const { r169 } = await run(LEGALISTIC, ["--prose"]);
  const phrases = r169.filter((x) => /Appendix G12/.test(x.msg)).map((x) => x.text.toLowerCase());
  for (const p of ["please treat this email as", "pursuant to", "reserves the right", "for the avoidance of doubt",
    "herein", "it is our position", "without prejudice", "without waiving", "hereby", "in accordance with section"]) {
    assert.ok(phrases.includes(p), `missing ${p}; got ${JSON.stringify(phrases)}`);
  }
  assert.ok(r169.every((x) => x.sev === "warn"));
});

test("Rule 169: the G12 warnings never move the exit code", async () => {
  const text = "Hi Tom,\n\nPursuant to our call, the panel is in.\n";
  const { code, r169 } = await run(text, ["--prose"]);
  assert.strictEqual(r169.length, 1);
  assert.strictEqual(code, 0);
});

test("Rule 169: a second section citation warns once, naming the count", async () => {
  const { r169 } = await run(LEGALISTIC, ["--prose"]);
  const cites = r169.filter((x) => /contract-section citations/.test(x.msg));
  assert.strictEqual(cites.length, 1);
  assert.match(cites[0].msg, /^3 contract-section citations/);
  assert.strictEqual(cites[0].line, 4);
  assert.strictEqual(cites[0].text, "Section 9.1");
});

test("Rule 169: one section citation in plain correspondence is not flagged", async () => {
  const { r169 } = await run(PLAIN, ["--prose"]);
  assert.deepStrictEqual(r169, []);
});

test("Rule 169: a formal document (a contract) is exempt from every Rule 169 finding", async () => {
  const { r169 } = await run(LEGALISTIC, ["--formal"]);
  assert.deepStrictEqual(r169, []);
});

test("Rule 169: a quoted phrase is Rule 2 material and is not flagged", async () => {
  const text = "Hi Tom,\n\nThe old email said \"pursuant to Section 12.3 and Section 14\" and we dropped it.\n";
  const { r169 } = await run(text, ["--prose"]);
  assert.deepStrictEqual(r169, []);
});

test("Rules 10 and 14 keep 'please be advised' and 'shall'; Rule 169 does not report them twice", async () => {
  const text = "Hi Tom,\n\nPlease be advised that the crew shall arrive Monday.\n";
  const { all } = await run(text, ["--prose"]);
  assert.deepStrictEqual(all.filter((x) => x.rule === 169), []);
  assert.ok(all.some((x) => x.rule === 10));
  assert.ok(all.some((x) => x.rule === 14));
});

test("Rule 170: no length check; a long plain email draws no Rule 169 or 170 finding", async () => {
  const long = "Hi Tom,\n\n" + "The crew finished the panel and tested every zone with your site lead.\n".repeat(80);
  const { all } = await run(long, ["--prose"]);
  assert.deepStrictEqual(all.filter((x) => x.rule === 169 || x.rule === 170), []);
});
