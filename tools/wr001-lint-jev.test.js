// wr001-lint Jev judgment rules (issue 731). Jev is stubbed throughout; the
// fixtures are the standard's Preferred/Avoid pairs (references/CORE.md Rules 5,
// 6, 10; references/DRAFT-QUALITY.md Appendix H3 and H11 for Rules 164 and 162).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SCRIPTS = path.join(__dirname, "..", "aac-skills", "aac-house-writing-standard", "scripts");
const lint = require(path.join(SCRIPTS, "wr001-lint.js"));
const { createJev } = require(path.join(SCRIPTS, "jev.js"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wr001-jev-"));
let n = 0;
const write = (text) => {
  const f = path.join(dir, `memo${n++}.md`);
  fs.writeFileSync(f, text);
  return f;
};

// The stub answers yes (0.95) when the unit a question points at is one of the
// Avoid texts registered for that question's rule, and no (0.05) otherwise.
function judge(avoid) {
  return async (state, questions) => {
    const answers = {};
    for (const [id, q] of Object.entries(questions)) {
      const rule = Number(/^r(\d+)_/.exec(id)[1]);
      const [, kind, idx] = /`(paragraphs|sentences)\[(\d+)\]`/.exec(q.instructions);
      const text = state[kind][Number(idx)];
      answers[id] = { type: "noul", noul: (avoid[rule] || []).includes(text) ? 0.95 : 0.05 };
    }
    return answers;
  };
}

async function runLint(file, ask, extra = []) {
  const out = [];
  const code = await lint.run([file, ...extra], { ask, log: (s) => out.push(s), error: (s) => out.push(`ERR ${s}`) });
  return { code, out: out.join("\n") };
}

async function findings(text, avoid) {
  const f = write(text);
  const { code, out } = await runLint(f, judge(avoid), ["--json"]);
  return { code, findings: JSON.parse(out).results[0].findings };
}

const CASES = [
  {
    rule: 5,
    avoid: "Last month the customer asked about the equipment order, and we discussed several options with the distributor.",
    fail: "Last month the customer asked about the equipment order, and we discussed several options with the distributor.\n\nPlease approve the attached $38,500 proposal by Thursday at 3 p.m.\n",
    pass: "Please approve the attached $38,500 proposal by Thursday at 3 p.m. so we can release the equipment order Friday.\n",
  },
  {
    rule: 6,
    avoid: "The revised proposal will be sent.",
    fail: "The revised proposal will be sent.\n",
    pass: "Mark will send the revised proposal.\n",
  },
  {
    rule: 10,
    avoid: "Please be advised that the inspection is currently scheduled to take place on September 15.",
    fail: "Please be advised that the inspection is currently scheduled to take place on September 15.\n",
    pass: "The inspection is scheduled for September 15.\n",
  },
  {
    rule: 162,
    avoid: "And that changes everything.",
    fail: "Mark will send the revised proposal.\n\nAnd that changes everything.\n",
    pass: "Mark will send the revised proposal.\n\nThe inspection is scheduled for September 15.\n",
  },
  {
    rule: 164,
    avoid: "The fix. That's it. That's the whole answer.",
    fail: "The fix. That's it. That's the whole answer.\n",
    pass: "The system relearns the schedule automatically.\n",
  },
];

for (const c of CASES) {
  test(`Rule ${c.rule}: WARN on the Avoid fixture, nothing on the Preferred one`, async () => {
    const avoid = { [c.rule]: [c.avoid] };
    const bad = await findings(c.fail, avoid);
    const hits = bad.findings.filter((f) => f.rule === c.rule);
    assert.strictEqual(hits.length, 1, JSON.stringify(bad.findings));
    assert.strictEqual(hits[0].sev, "warn");
    assert.strictEqual(hits[0].text, c.avoid);
    assert.match(hits[0].msg, /Jev/);
    assert.strictEqual(bad.code, 0);

    const good = await findings(c.pass, avoid);
    assert.deepStrictEqual(good.findings.filter((f) => f.rule === c.rule), []);
  });
}

test("a Jev finding names the unit's line", async () => {
  const { findings: fs2 } = await findings("# Heading\n\nMark will call.\nThe revised proposal will be sent.\n", { 6: ["The revised proposal will be sent."] });
  assert.deepStrictEqual(fs2.map((f) => [f.rule, f.line]), [[6, 4]]);
});

test("no Jev answer produces an ERROR or moves the exit code", async () => {
  const yesToAll = async (_state, qs) =>
    Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "noul", noul: 1 }]));
  const f = write(CASES.map((c) => c.fail).join("\n"));
  const { code, out } = await runLint(f, yesToAll, ["--json"]);
  const all = JSON.parse(out).results[0].findings;
  assert.ok(all.length >= 5);
  assert.ok(all.every((x) => x.sev === "warn"), JSON.stringify(all));
  assert.strictEqual(code, 0);

  // The stopslop Stop hook, which exits 2 on ERROR, neither runs the linter nor calls Jev.
  const hookDir = path.join(__dirname, "..", "profile", "claude");
  for (const p of ["hooks/stopslop-stop.py", "tools/stopslop.py"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(hookDir, p), "utf8"), /jev|typesafe/i, p);
  }
});

test("with Jev unavailable the output is identical to the regex-only output", async () => {
  const text = "Please be advised that the meeting is at 8:00 a.m.  It was moved.\n\nAnd that changes everything — truly!\n";
  const f = write(text);
  const unavailable = [
    async () => null,
    async () => { throw new Error("boom"); },
    createJev({ apiKey: "k", fetch: async () => { throw new Error("ECONNREFUSED"); } }),
    createJev({ apiKey: undefined, fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }) }),
    createJev({ timeoutMs: 20, fetch: (_u, o) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("aborted")))) }),
    createJev({ fetch: async () => ({ ok: true, json: async () => ({ answers: {} }) }) }),
  ];
  for (const extra of [[], ["--json"], ["--quiet"]]) {
    const today = await runLint(f, null, extra);
    assert.strictEqual(today.code, 1);
    for (const ask of unavailable) assert.deepStrictEqual(await runLint(f, ask, extra), today);
  }

  // One failed batch among several drops every Jev finding, not just its own.
  const long = write(Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(" ") + "\n");
  let calls = 0;
  const flaky = async (state, qs) => (calls++ === 1 ? null : judge({ 6: state.sentences })(state, qs));
  assert.deepStrictEqual(await runLint(long, flaky), await runLint(long, null));
  assert.ok(calls > 1);
});

test("the Jev helper sends TYPESAFE_API_KEY as a bearer header only when set", async () => {
  const seen = [];
  const fetch = async (url, o) => {
    seen.push({ url, auth: o.headers.Authorization, body: JSON.parse(o.body) });
    return { ok: true, json: async () => ({ answers: { q: { type: "noul", noul: 0.5 } } }) };
  };
  const q = { q: { type: "noul", instructions: "?" } };
  assert.deepStrictEqual(await createJev({ apiKey: "sk-test", fetch })("s", q), { q: { type: "noul", noul: 0.5 } });
  await createJev({ apiKey: "", fetch })("s", q);
  assert.strictEqual(seen[0].auth, "Bearer sk-test");
  assert.strictEqual(seen[1].auth, undefined);
  assert.strictEqual(seen[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.strictEqual(seen[0].body.model, "jev-latest");
});
