// Runs the Day Board page script against a fake DOM and mocked connectors, then presses a triage
// card's "Apply my note". On 2026-09-30 the button only read the note and parked a proposal, so Dan's
// click wrote nothing to Todoist and the card came back looking unchanged.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "aac-skills", "todoist-triage", "day-board.html"), "utf8");
const script = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");

function element(id){
  const handlers = {};
  return {id, innerHTML: "", textContent: "", hidden: false, disabled: false, className: "", open: false, dataset: {}, style: {}, value: "",
    addEventListener(type, fn){ (handlers[type] = handlers[type] || []).push(fn); },
    async fire(type, ev){ for (const fn of handlers[type] || []) await fn(ev || {target: {closest: () => null}}); },
    querySelectorAll(){ return []; }, querySelector(){ return null; }, closest(){ return null; }};
}
const text = v => ({content: [{type: "text", text: JSON.stringify(v)}]});

function buildPage({card, task, ruling, agentTasks}){
  const els = {};
  const $ = id => (els[id] = els[id] || element(id));
  const calls = [];
  const mcp = {async callTool(server, tool, input){
    calls.push({server, tool, input});
    if (tool === "fetch-object") return text({type: "task", id: task.id, object: task});
    if (tool === "find-comments") return text({comments: []});
    if (tool === "find-tasks") return text({tasks: input.labels && agentTasks ? agentTasks : [], hasMore: false});
    if (tool === "update-tasks") return text({tasks: [], failures: []});
    return text({});
  }};
  const store = {["triage/" + card._id]: Object.assign({}, card)};
  const cardSubs = [];
  const snap = () => ({docs: [{id: card._id, data: () => Object.assign({}, store["triage/" + card._id])}]});
  const db = {
    doc(p){ return {
      set: async v => { store[p] = v; },
      update: async v => { store[p] = Object.assign(store[p] || {}, v); if (p.startsWith("triage/")) cardSubs.forEach(fn => fn(snap())); },
      onSnapshot(fn){ fn(p === "triage_meta/latest" ? {exists: true, data: () => ({runId: card.runId})} : {exists: false, data: () => null}); }}; },
    collection(name){ return {onSnapshot(fn){ if (name === "triage"){ cardSubs.push(fn); fn(snap()); } else fn({docs: []}); }}; }
  };
  const sample = {async json(){ return ruling; }};
  const ctx = {
    document: {getElementById: $, addEventListener(){}, activeElement: null, visibilityState: "visible"},
    window: {claude: {use: async name => ({mcp, db, sample})[name]}},
    DOMParser: class { parseFromString(h){ return {body: {textContent: String(h), querySelectorAll: () => []}}; } },
    setInterval(){}, setTimeout, clearTimeout, AbortController, console, navigator: {}, Date, JSON, Math, Promise, Set, Map
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return {$, calls, store};
}

// A fake card row and a click on one of its buttons, as the page's delegated handler sees them.
function clickOn(card, opt, note){
  const textarea = {value: note, focus(){}, disabled: false};
  const row = {dataset: {id: card._id}, querySelector: s => s === "textarea" ? textarea : null, querySelectorAll: () => []};
  const button = {dataset: {opt}, closest: s => s === "button[data-opt]" ? button : s === ".prop" ? row : null};
  return {target: {closest: s => s === "button[data-undo]" ? null : button.closest(s)}};
}

// The page's click handler does not return the answer's promise: let it settle.
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };

const card = {_id: "t1", taskId: "t1", runId: "run-1", status: "open", title: "Pull revenue from Zoho",
  question: "Agent could pull it.", source: {lastFrom: "Dan", lastAt: "2026-09-21T00:00:00Z", quote: "pull it"},
  options: [{label: "An agent does it (adds agent label)", labels: ["do", "agent"]}]};
const task = {id: "t1", content: "Pull revenue from Zoho", description: "", labels: ["do"], projectId: "6XMPVX96VgH6vwHR", priority: "p4"};

test("Apply my note writes the ruling it reads in one click (a delete note deletes the task)", async () => {
  const page = buildPage({card, task, ruling: {summary: "Delete task, already done or not needed", why: "settled", ruling: {delete: true}}});
  await new Promise(r => setImmediate(r));
  await page.$("tri-body").fire("click", clickOn(card, "read", "This should already be done or not needed."));
  await settle();
  const del = page.calls.find(c => c.tool === "delete-object");
  assert(del, "delete-object was called: " + JSON.stringify(page.calls.map(c => c.tool)));
  assert.strictEqual(JSON.stringify(del.input), JSON.stringify({type: "task", id: "t1"}));
  const doc = page.store["triage/t1"];
  assert.strictEqual(doc.status, "answered");
  assert.match(doc.choice, /^Your note: Delete task/);
  assert.strictEqual(doc.undo.kind, "delete");
});

test("Apply my note on a note with no Todoist change writes nothing and leaves the card open", async () => {
  const page = buildPage({card, task, ruling: {summary: "", why: "only a comment", ruling: null}});
  await new Promise(r => setImmediate(r));
  await page.$("tri-body").fire("click", clickOn(card, "read", "Interesting."));
  await settle();
  assert.strictEqual(page.calls.filter(c => ["delete-object", "update-tasks"].includes(c.tool)).length, 0);
  assert.strictEqual(page.store["triage/t1"].status, "open");
  assert.strictEqual(page.store["triage/t1"].proposal.ruling, null);
});

// Issue 1202: every Claude Code Remote call rejects blocked_by_policy on Dan's account, so Launch agents
// starts nothing. It counts the tasks labelled agent and says the agent-launcher routine starts them.
test("Launch agents counts the agent tasks, says the routine starts them within 30 minutes, and writes nothing", async () => {
  const agentTasks = [{id: "a1", content: "Investigate the deals report", labels: ["do", "agent"]}, {id: "a2", content: "Pull the permit list", labels: ["agent"]},
    {id: "a3", content: "Already running", labels: ["agent-running"]}];
  const page = buildPage({card, task, ruling: null, agentTasks});
  await new Promise(r => setImmediate(r));
  page.calls.length = 0;
  await page.$("agent-go").fire("click");
  await settle();
  const status = page.$("agent-status").innerHTML;
  assert.match(status, /^2 tasks carry the agent label\. The agent-launcher routine on your PC starts each one in its own cloud session within 30 minutes/, status);
  assert.match(status, /https:\/\/app\.todoist\.com\/app\/task\/a1/);
  assert.doesNotMatch(status, /Already running/);
  assert.deepStrictEqual(page.calls.map(c => c.server + " " + c.tool), ["Todoist find-tasks"]);
  assert.doesNotMatch(script, /Claude Code Remote"\s*,\s*"create_session/);
});
