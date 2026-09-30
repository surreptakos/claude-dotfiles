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

function buildPage({tasks, lastPostHtml, onPrompt, triage = [], todoist = () => undefined}){
  const els = {};
  const $ = id => (els[id] = els[id] || element(id));
  const prompts = [];
  const now = new Date();
  const calls = [];
  const mcp = {async callTool(server, tool, input){
    calls.push({server, tool, input});
    const own = server === "Todoist" && todoist(tool, input);
    if (own) return text(own);
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
    collection(name){ return {onSnapshot(fn){ fn({docs: name === "triage" ? triage.map(t => ({id: t._id, data: () => t})) : []}); }}; }
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
  return {$, prompts, store, calls};
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

test("no prompt the page sends calls a review confidential (Dan, 2026-09-30: the Mireya review audit belongs in the post)", () => {
  const offending = script.split(/\r?\n/).filter(l => /(confidential|reveal|CONF_DETAIL|NEVER IN THE POST|no pay)/i.test(l) && /\breviews?\b/i.test(l) && !/is fine|is not confidential|not confidential/i.test(l));
  assert.deepStrictEqual(offending, []);
});

// Issue 1074: update-tasks replaces the whole due string, so a do date sent that way wipes a recurring
// task's repeat. The card reads the task first and moves a recurring one with reschedule-tasks, date only.
async function rule(recurring, option){
  const card = {_id: "q1", taskId: "t1", title: "Weekly vendor check", status: "open", options: [option]};
  const page = buildPage({tasks: [], lastPostHtml, onPrompt: () => ({}), triage: [card], todoist(tool){
    if (tool === "fetch-object") return {id: "t1", content: "Weekly vendor check", labels: ["do"], projectId: CURRENT_WORK, dueDate: "2026-10-05", recurring, priority: "p4"};
    if (tool === "update-tasks" || tool === "reschedule-tasks") return {tasks: [{id: "t1"}], failures: []};
  }});
  await new Promise(r => setImmediate(r));
  const row = {dataset: {id: "q1"}, querySelector: () => ({value: ""}), querySelectorAll: () => []};
  await page.$("tri-body").fire("click", {target: {closest: sel => sel === "button[data-opt]" ? {dataset: {opt: "0"}, closest: () => row} : null}});
  for (let i = 0; i < 20 && !page.store["triage/q1"]; i++) await new Promise(r => setImmediate(r));
  return {writes: page.calls.filter(c => ["update-tasks", "reschedule-tasks"].includes(c.tool)), card: page.store["triage/q1"] || {}};
}

test("a do-date ruling on a recurring task goes through reschedule-tasks with a date, never a due string", async () => {
  const {writes, card} = await rule("every monday", {label: "Look again Oct 7, hand to Lynne", dueString: "Oct 7", labels: ["to-lynne"]});
  assert.strictEqual(card.status, "answered", card.error);
  assert.deepStrictEqual(writes.map(c => c.tool), ["update-tasks", "reschedule-tasks"]);
  assert.strictEqual(writes[0].input.tasks[0].dueString, undefined, "update-tasks would wipe the repeat");
  assert.match(writes[1].input.tasks[0].date, /^\d{4}-10-07$/);
});

test("a do date the board cannot read as a date changes nothing on a recurring task", async () => {
  const {writes, card} = await rule("every monday", {label: "No date", dueString: "no date"});
  assert.deepStrictEqual(writes, []);
  assert.match(card.error, /repeats/);
});

test("a do-date ruling on a non-recurring task still sends the due string through update-tasks", async () => {
  const {writes, card} = await rule(false, {label: "Look again Oct 7", dueString: "Oct 7"});
  assert.strictEqual(card.status, "answered", card.error);
  assert.deepStrictEqual(writes.map(c => [c.tool, c.input.tasks[0].dueString]), [["update-tasks", "Oct 7"]]);
});
