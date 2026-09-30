// Runs the whole Day Board page script against a fake DOM and mocked connectors, then presses
// "Draft today's post". The gate's unit tests (day-board-huddle-gate.test.js) never reach draftHuddle's
// own code; on 2026-09-30 a use-before-declare there broke every draft while all of them passed.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "aac-skills", "todoist-triage", "day-board.html"), "utf8");
const script = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
const DAN = (script.match(/danId:"([^"]+)"/) || [])[1];
const CURRENT_WORK = (script.match(/const CURRENT_WORK = "([^"]+)"/) || [])[1];

function element(id){
  const handlers = {};
  return {id, innerHTML: "", textContent: "", hidden: false, disabled: false, className: "", open: false, dataset: {}, style: {}, value: "",
    addEventListener(type, fn){ (handlers[type] = handlers[type] || []).push(fn); },
    async fire(type, ev){ for (const fn of handlers[type] || []) await fn(ev || {target: {closest: () => null}}); },
    querySelectorAll(){ return []; }, querySelector(){ return null; }, closest(){ return null; }};
}
const text = v => ({content: [{type: "text", text: JSON.stringify(v)}]});
const ymd = d => d.toISOString().slice(0, 10);

function buildPage({tasks, lastPostHtml, onPrompt}){
  const els = {};
  const $ = id => (els[id] = els[id] || element(id));
  const prompts = [];
  const now = new Date();
  const mcp = {async callTool(server, tool, input){
    if (tool === "teams_list_channel_messages") return text([{from: {userId: DAN, displayName: "Dan"}, createdDateTime: new Date(now - 86400000).toISOString(), bodyPreview: lastPostHtml, messageType: "message"}]);
    if (tool === "find-tasks") return text({tasks: input.projectId === CURRENT_WORK ? tasks : [], hasMore: false});
    if (tool === "find-activity") return text({events: []});
    if (tool === "outlook_email_search") return text([{subject: "RE: vendor setup", sentDateTime: now.toISOString(), summary: "Sent the vendor the setup documents"}]);
    if (tool === "query_granola_meetings") return {content: [{type: "text", text: "(no meetings)"}]};
    return text({});
  }};
  const store = {};
  const db = {
    doc(p){ return {set: async v => { store[p] = v; }, update: async v => { store[p] = Object.assign(store[p] || {}, v); }, onSnapshot(fn){ fn({exists: false, data: () => null}); }}; },
    collection(){ return {onSnapshot(fn){ fn({docs: []}); }}; }
  };
  const sample = {async json(prompt){ prompts.push(prompt); return onPrompt(prompt); }};
  const ctx = {
    document: {getElementById: $, addEventListener(){}, activeElement: null, visibilityState: "visible"},
    window: {claude: {use: async name => ({mcp, db, sample})[name]}},
    DOMParser: class { parseFromString(h){ const t = String(h).replace(/<[^>]+>/g, ""); return {body: {textContent: t, querySelectorAll: () => []}}; } },
    setInterval(){}, setTimeout, clearTimeout, AbortController, console, navigator: {}, Date, JSON, Math, Promise, Set, Map
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return {$, prompts, store};
}

const lastPostHtml = "<p>Dan | 9/29/2026</p><p>Yesterday's report</p><ul><li>Sent the vendor the supplier documents for setup</li></ul>" +
  "<p>Today's focus</p><ul><li>Bid prep</li></ul><p>Risks/Blockers</p><ul><li>Bid work is pushing every other task out, so smaller jobs slip a week</li></ul>";
const past = ymd(new Date(Date.now() - 3 * 86400000));
const tasks = [
  {id: "1", content: "Audit the manager's revised annual review for the tech", labels: ["do"], dueDate: past, projectId: CURRENT_WORK},
  {id: "2", content: "Tidy the shared drive folders", labels: ["do"], dueDate: past, projectId: CURRENT_WORK}
];
const judgeAll = prompt => {
  const lines = JSON.parse(prompt.split("(kept:true means a line of his own, carried word for word or dropped):\n")[1].split("\n")[0]);
  return {verdicts: lines.map(l => ({section: l.section, index: l.index, outcome: true, consequence: true, generic: false, confidential: false, supported: true, paraphrase: false, reason: ""}))};
};

test("pressing Draft today's post runs the whole page path to a passed draft, and only blocking items are required", async () => {
  const page = buildPage({tasks, lastPostHtml, onPrompt(prompt){
    if (prompt.startsWith("For each of Dan Gatsakos's overdue work tasks")){
      const list = JSON.parse(prompt.split("TASKS:\n")[1].split("\n")[0]);
      return {items: list.map(x => ({index: x.index, blocks: /review/.test(x.task), who: /review/.test(x.task) ? "the manager" : ""}))};
    }
    if (prompt.startsWith("You are a strict compliance judge")) return judgeAll(prompt);
    if (prompt.includes("ITEMS TO ADD:")) return {add: [{section: "risks", text: "Tech review audit is overdue, so the manager's review waits", evidence: "new: task audit"}]};
    if (prompt.startsWith("Draft Dan Gatsakos's daily huddle post")){
      return {reportHeading: "Yesterday's report",
        report: [{text: "Decided the bid scope with the estimator", evidence: "meeting note: bid scope"}],
        focus: [{text: "Bid prep", evidence: "kept verbatim"}],
        risks: [{text: "Bid work is pushing every other task out, so smaller jobs slip a week", evidence: "kept verbatim"}],
        dropped: []};
    }
    return {fixes: []};
  }});
  await new Promise(r => setImmediate(r));                              // let start() finish loading tasks
  for (let i = 0; i < 20 && !page.prompts.length && !/Passed|Blocked|failed/.test(page.$("hud-status").textContent); i++){
    await page.$("hud-go").fire("click");
  }
  const status = page.$("hud-status").textContent;
  assert.match(status, /^Passed every rule/, status + " :: " + page.$("hud-ev-body").innerHTML);
  assert.strictEqual(page.$("hud-post").hidden, false);
  assert.strictEqual(page.$("hud-copy").hidden, false);
  const draftPrompt = page.prompts.find(p => p.startsWith("Draft Dan Gatsakos's daily huddle post"));
  const must = draftPrompt.split("MUST APPEAR")[1].split("\n")[1];
  assert.match(must, /annual review/, "the blocking item is required");
  assert.doesNotMatch(must, /shared drive/, "the non-blocking item is not required");
});

test("a blockers answer in the wrong shape requires every overdue item (fails toward naming, not hiding)", async () => {
  const page = buildPage({tasks, lastPostHtml, onPrompt(prompt){
    if (prompt.startsWith("For each of Dan Gatsakos's overdue work tasks")) return {nope: true};
    if (prompt.startsWith("You are a strict compliance judge")) return judgeAll(prompt);
    if (prompt.includes("ITEMS TO ADD:")) return {add: []};
    if (prompt.startsWith("Draft Dan Gatsakos's daily huddle post")) return {reportHeading: "Yesterday's report", report: [{text: "Decided the bid scope with the estimator", evidence: "meeting note: bid scope"}], focus: [{text: "Bid prep", evidence: "kept verbatim"}], risks: [{text: "Bid work is pushing every other task out, so smaller jobs slip a week", evidence: "kept verbatim"}], dropped: []};
    return {fixes: []};
  }});
  await new Promise(r => setImmediate(r));
  await page.$("hud-go").fire("click");
  const draftPrompt = page.prompts.find(p => p.startsWith("Draft Dan Gatsakos's daily huddle post"));
  assert(draftPrompt, "the draft prompt was sent: " + page.$("hud-status").textContent);
  const must = draftPrompt.split("MUST APPEAR")[1].split("\n")[1];
  assert.match(must, /annual review/);
  assert.match(must, /shared drive/);
});
