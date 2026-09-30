// The Day Board's huddle gate and its repair loop (aac-skills/todoist-triage/day-board.html).
// The page is one HTML file, so the tests pull the gate's functions out of its <script> and run them
// with a mocked Claude. Fixtures are synthetic: no real post, name or amount.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "aac-skills", "todoist-triage", "day-board.html"), "utf8");
const src = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const from = src.indexOf("  // ---------- HUDDLE GATE"), to = src.indexOf("  function hudPrompt(ctx){");
const pad = n => String(n).padStart(2, "0");
const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const clip = (s, n) => { s = String(s || ""); return s.length > n ? s.slice(0, n) + "..." : s; };
const G = new Function("ymd", "clip", src.slice(from, to) +
  "; return {huddleGate, judgeLines, judgeViolations, autoFix, gateLoop, repairPrompt, parseLastPost, expectedHeading, isConfidential, violationView, uncovered, isCovered};")(ymd, clip);

const now = new Date(2026, 8, 30, 10, 0, 0);                       // a Wednesday
const lastPost = {at: new Date(2026, 8, 29, 9, 0, 0), text: [
  "Dan | 9/29/2026", "Yesterday's report", "Sent the vendor the supplier documents for setup",
  "Today's focus", "Bid prep", "Portal uploads and granting access",
  "Risks/Blockers", "Bid work is pushing every other task out, so smaller jobs slip a week", "Partner can't start until they have access"
].join("\n")};

// A judge that passes every line unless a test says otherwise.
const judgeAll = (flag = () => ({})) => lines => ({verdicts: lines.map(l => Object.assign(
  {section: l.section, index: l.index, outcome: true, consequence: true, generic: false, confidential: false, supported: true, paraphrase: false, reason: ""}, flag(l)))});

// Routes each prompt to the judge or the repairer, and records what each one was sent.
function mockClaude(judge, repair){
  const calls = {judge: [], repair: []};
  const ask = async prompt => {
    if (prompt.startsWith("You are a strict compliance judge")){
      const lines = JSON.parse(prompt.split("LINES TO JUDGE (kept:true means a line of his own, carried word for word or dropped):\n")[1].split("\n")[0]);
      calls.judge.push(lines); return judge(lines);
    }
    const targets = JSON.parse(prompt.split("LINES TO FIX:\n")[1].split("\n")[0]);
    calls.repair.push(targets); return repair(targets);
  };
  return {ask, calls};
}
const ctx = {maxLen: 80, evidence: "{}"};
const draft = patch => Object.assign({
  reportHeading: "Yesterday's report",
  report: [{text: "Completed the portal uploads and sent to the partner", evidence: "mail to partner 2026-09-29"},
           {text: "Decided to bid the regional contract", evidence: "meeting note 2026-09-29"}],
  focus: [{text: "Bid prep", evidence: "kept verbatim"}, {text: "Portal uploads and granting access", evidence: "kept verbatim"}],
  risks: [{text: "Bid work is pushing every other task out, so smaller jobs slip a week", evidence: "kept verbatim"},
          {text: "Partner can't start until they have access", evidence: "kept verbatim"}],
  dropped: []
}, patch);

test("a clean draft passes untouched with one judge call and no repair", async () => {
  const {ask, calls} = mockClaude(judgeAll(), () => { throw new Error("no repair expected"); });
  const r = await G.gateLoop(draft(), lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert.strictEqual(r.rounds, 0);
  assert.strictEqual(calls.judge.length, 1);
  assert.deepStrictEqual(r.d.report, draft().report);
});

test("one failing line is repaired alone; every passing line stays byte for byte", async () => {
  const d0 = draft({risks: draft().risks.concat([{text: "Crew schedule is tight", evidence: "new: calendar"}])});
  const {ask, calls} = mockClaude(judgeAll(), targets => ({fixes: targets.map(t => ({section: t.section, index: t.index,
    text: "Crew schedule is tight, so the install slips to next week", evidence: t.evidence}))}));
  const r = await G.gateLoop(d0, lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert.strictEqual(calls.repair.length, 1, "one repair call");
  assert.deepStrictEqual(calls.repair[0].map(t => t.text), ["Crew schedule is tight"], "only the failing line is sent");
  assert.deepStrictEqual(r.d.report, d0.report, "report untouched");
  assert.deepStrictEqual(r.d.focus, d0.focus, "focus untouched");
  assert.strictEqual(r.d.risks[2].text, "Crew schedule is tight, so the install slips to next week");
  assert.strictEqual(calls.judge.length, 2, "second judge call covers only the repaired line");
  assert.strictEqual(calls.judge[1].length, 1);
});

test("a confidential line is removed by code, never sent back to be reworded", async () => {
  const d0 = draft({report: draft().report.concat([{text: "Sent the manager the bonus form", evidence: "mail 2026-09-29"}])});
  const {ask, calls} = mockClaude(judgeAll(), () => { throw new Error("no repair expected"); });
  const r = await G.gateLoop(d0, lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert.strictEqual(calls.repair.length, 0);
  assert(!r.d.report.some(it => G.isConfidential(it.text)));
  assert.deepStrictEqual(r.d.report, draft().report);
});

test("a line the judge flags as confidential is removed and the rest ship", async () => {
  const {ask} = mockClaude(judgeAll(l => /regional/.test(l.text) ? {confidential: true} : {}), () => ({fixes: []}));
  const r = await G.gateLoop(draft(), lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert(!r.d.report.some(it => /regional/.test(it.text)));
  assert.strictEqual(r.d.report.length, 1);
});

test("a line that cannot be repaired is removed after the last round, not the whole post", async () => {
  const d0 = draft({report: draft().report.concat([{text: "Attended the planning meeting", evidence: "meeting note"}])});
  const {ask, calls} = mockClaude(judgeAll(), targets => ({fixes: targets.map(t => ({section: t.section, index: t.index, text: "Attended the planning session", evidence: t.evidence}))}));
  const r = await G.gateLoop(d0, lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert(r.removed >= 1);
  assert(!r.d.report.some(it => /Attended/.test(it.text)));
  assert(calls.repair.length >= 1 && calls.repair.length <= 3);
});

test("code repairs: dropped line of his is carried back, reworded line of his becomes his line, heading fixed", async () => {
  const d0 = draft({reportHeading: "Report", focus: [{text: "Prep for the bid", evidence: "new: task"}]});
  const {ask} = mockClaude(judgeAll(), () => ({fixes: []}));
  const r = await G.gateLoop(d0, lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert.strictEqual(r.d.reportHeading, "Yesterday's report");
  assert.deepStrictEqual(r.d.focus.map(f => f.text).sort(), ["Bid prep", "Portal uploads and granting access"]);
});

test("fails closed: no last post, or a judge that answers in the wrong shape, blocks the post", async () => {
  const {ask} = mockClaude(() => null, () => ({fixes: []}));
  assert.strictEqual((await G.gateLoop(draft(), lastPost, now, ask, ctx)).passed, false);
  const ok = mockClaude(judgeAll(), () => ({fixes: []}));
  assert.strictEqual((await G.gateLoop(draft(), null, now, ok.ask, ctx)).passed, false);
});

test("a repair that sneaks in a confidential detail is caught and removed", async () => {
  const d0 = draft({risks: draft().risks.concat([{text: "Crew schedule is tight", evidence: "new: calendar"}])});
  const {ask} = mockClaude(judgeAll(), targets => ({fixes: targets.map(t => ({section: t.section, index: t.index, text: "Crew lead is out sick, so the install slips", evidence: t.evidence}))}));
  const r = await G.gateLoop(d0, lastPost, now, ask, ctx);
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert(!r.d.risks.some(it => G.isConfidential(it.text)));
});

test("the blocked view never shows a line", () => {
  const out = G.violationView({rule: "paraphrase", section: "focus", index: 0, text: "Sent the manager the bonus form", detail: "rewords \"Sent the manager the bonus form\""});
  assert(!/bonus|manager/.test(out), out);
});

test("confidential means amounts, pay, health, leave, discipline, identity - not reviews or document numbers", () => {
  ["Sent the manager the $1,500 bonus form", "Crew lead is out sick", "Approved 15000 for the tech", "Decided the tech's raise", "Sent the SSN list", "Tech on leave until Monday"]
    .forEach(t => assert(G.isConfidential(t), "should block: " + t));
  ["Audit the revised annual review for the tech", "Approve or decline vendor Quote #013157 (battery backup)", "Recover the overpayment on invoice RE355989",
   "Sign the fuel-cell unit swap DocuSign", "Review audit for the tech is overdue, so the manager's review cannot go out", "Sent the 2026 bid"]
    .forEach(t => assert(!G.isConfidential(t), "should allow: " + t));
});

test("every overdue item must be named; missing ones are added by a targeted call, not a redraft", async () => {
  const mustCover = ["Approve or decline vendor Quote #013157 (battery backup, second unit)", "Decide on the customer's reduction request and call him back"];
  const d0 = draft();
  let coverCalls = 0;
  const ask = async prompt => {
    if (prompt.startsWith("You are a strict compliance judge")){
      const lines = JSON.parse(prompt.split("LINES TO JUDGE (kept:true means a line of his own, carried word for word or dropped):\n")[1].split("\n")[0]);
      return judgeAll()(lines);
    }
    if (prompt.includes("ITEMS TO ADD:")){
      coverCalls++;
      return {add: [{section: "risks", text: "Vendor quote #013157 undecided, so the second unit waits", evidence: "new: task quote"},
                    {section: "risks", text: "Customer reduction request unanswered, so the account call slips", evidence: "new: task call back"}]};
    }
    throw new Error("no repair expected");
  };
  assert.strictEqual(G.uncovered(d0, mustCover).length, 2);
  const r = await G.gateLoop(d0, lastPost, now, ask, Object.assign({}, ctx, {mustCover, maxLen: 104}));
  assert.strictEqual(r.passed, true, JSON.stringify(r.violations));
  assert.strictEqual(coverCalls, 1);
  assert.deepStrictEqual(r.missing, []);
  assert.deepStrictEqual(r.d.report, d0.report, "report untouched");
  assert.deepStrictEqual(r.d.focus, d0.focus, "focus untouched");
});

test("an item still missing after the last round is reported, not silently dropped", async () => {
  const mustCover = ["Decide on the customer's reduction request and call him back"];
  const {ask} = mockClaude(judgeAll(), () => ({fixes: []}));
  const r = await G.gateLoop(draft(), lastPost, now, async p => p.includes("ITEMS TO ADD:") ? {add: []} : ask(p), Object.assign({}, ctx, {mustCover}));
  assert.deepStrictEqual(r.missing, mustCover);
});
