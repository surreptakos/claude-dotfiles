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
// The page runs at a fixed 11:00 local time, so "today's export" never straddles midnight.
const NOW = new Date(); NOW.setHours(11, 0, 0, 0);
class FixedDate extends Date { constructor(...a){ if (a.length) super(...a); else super(NOW.getTime()); } static now(){ return NOW.getTime(); } }
const stampTitle = (source, at) => source + "__" + at.toISOString().slice(0, 16).replace(":", "") + ".json";
// Drive's text view escapes markdown punctuation; the page must read the exports through it.
const mdEscape = s => s.replace(/[\\<>&\[\]#_]/g, c => "\\" + c);

// exportAgoMin: how long before NOW today's newest exports were stamped; null means none has landed yet.
function buildPage({tasks, lastPostHtml, onPrompt, exportAgoMin = 10, liveMail = [], triage = [], todoist = () => undefined, collections = {}}){
  const els = {};
  const $ = id => (els[id] = els[id] || element(id));
  const prompts = [], m365 = [];
  const now = NOW;
  const stamp = exportAgoMin == null ? null : new Date(now - exportAgoMin * 60000);
  const exported = {
    huddle: {value: [{id: "1", from: {user: {id: DAN, displayName: "Dan"}}, createdDateTime: new Date(now - 86400000).toISOString(), body: {contentType: "html", content: lastPostHtml}}]},
    sent: {value: [{subject: "RE: vendor setup", sentDateTime: new Date(now - 2 * 3600000).toISOString(), body: {contentType: "html", content: "<html><body><p>Sent the vendor the setup documents</p></body></html>"}}]}
  };
  const calls = [];
  const mcp = {async callTool(server, tool, input){
    calls.push({server, tool, input});
    const own = server === "Todoist" && todoist(tool, input);
    if (own) return text(own);
    if (server === "Microsoft 365" || server === "ms365") m365.push({tool, input});
    if (tool === "search_files"){
      const src = /huddle__global/.test(input.query) ? "huddle__global" : /outlook_sent__sent/.test(input.query) ? "outlook_sent__sent" : null;
      if (!src || !stamp) return text({files: []});
      const id = src === "huddle__global" ? "huddle" : "sent";
      return text({files: [{id: id + "-old", title: stampTitle(src, new Date(stamp - 3600000))}, {id, title: stampTitle(src, stamp)}]});
    }
    if (tool === "read_file_content") return text({fileContent: mdEscape(JSON.stringify(exported[input.fileId] || {value: []}))});
    if (tool === "teams_list_channel_messages") return text([{from: {userId: DAN, displayName: "Dan"}, createdDateTime: new Date(now - 86400000).toISOString(), bodyPreview: "<p>live read of an old post</p>", messageType: "message"}]);
    if (tool === "find-tasks") return text({tasks: input.projectId === CURRENT_WORK ? tasks : [], hasMore: false});
    if (tool === "find-activity") return text({events: []});
    if (tool === "outlook_email_search") return text(liveMail);
    if (tool === "query_granola_meetings") return {content: [{type: "text", text: "(no meetings)"}]};
    return text({});
  }};
  const store = {};
  const db = {
    doc(p){ return {set: async v => { store[p] = v; }, update: async v => { store[p] = Object.assign(store[p] || {}, v); }, onSnapshot(fn){ fn({exists: false, data: () => null}); }}; },
    collection(name){ const rows = name === "triage" ? triage : collections[name] || [];
      return {onSnapshot(fn){ fn({docs: rows.map(t => ({id: t._id, data: () => t}))}); }}; }
  };
  const sample = {async json(prompt){ prompts.push(prompt); return onPrompt(prompt); }};
  const ctx = {
    document: {getElementById: $, addEventListener(){}, activeElement: null, visibilityState: "visible"},
    window: {claude: {use: async name => ({mcp, db, sample})[name]}},
    DOMParser: class { parseFromString(h){ const t = String(h).replace(/<[^>]+>/g, ""); return {body: {textContent: t, querySelectorAll: () => []}}; } },
    setInterval(){}, setTimeout, clearTimeout, AbortController, console, navigator: {}, Date: FixedDate, JSON, Math, Promise, Set, Map
  };
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return {$, prompts, store, m365, stamp, calls};
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

// Issue 1039: the huddle channel and Sent Items come from the newest export; live Microsoft 365 reads cover
// only the hour after its stamp, and nothing is drafted or read live before the day's first export.
const passAll = prompt => {
  if (prompt.startsWith("For each of Dan Gatsakos's overdue work tasks")) return {items: []};
  if (prompt.startsWith("You are a strict compliance judge")) return judgeAll(prompt);
  if (prompt.includes("ITEMS TO ADD:")) return {add: []};
  if (prompt.startsWith("Draft Dan Gatsakos's daily huddle post")) return {reportHeading: "Yesterday's report", report: [{text: "Decided the bid scope with the estimator", evidence: "meeting note: bid scope"}], focus: [{text: "Bid prep", evidence: "kept verbatim"}], risks: [{text: "Bid work is pushing every other task out, so smaller jobs slip a week", evidence: "kept verbatim"}], dropped: []};
  return {fixes: []};
};
const noTasks = [];
const draftPromptOf = page => page.prompts.find(p => p.startsWith("Draft Dan Gatsakos's daily huddle post")) || "";

test("the last post and the sent mail come from the newest export; the live read covers only its tail", async () => {
  const page = buildPage({tasks: noTasks, lastPostHtml, onPrompt: passAll});
  await new Promise(r => setImmediate(r));
  page.m365.length = 0;
  await page.$("hud-go").fire("click");
  const draft = draftPromptOf(page);
  assert.match(draft.split("HIS LAST POST (")[1].split("TASKS COMPLETED")[0], /Bid prep/, "last post read from the export");
  assert.match(draft.split("MAIL HE SENT SINCE:")[1].split("MEETING NOTES")[0], /vendor setup/, "sent mail read from the export");
  const mail = page.m365.find(c => c.tool === "outlook_email_search");
  assert.strictEqual(mail.input.afterDateTime, page.stamp.toISOString());
  assert.strictEqual(mail.input.beforeDateTime, NOW.toISOString());
  assert.deepStrictEqual([...new Set(page.m365.map(c => c.tool))].sort(), ["outlook_email_search", "teams_list_channel_messages"]);
  assert.match(page.$("hud-status").textContent, /Every source answered/);
});

test("before the day's first export the panel waits and makes no Microsoft 365 call", async () => {
  const page = buildPage({tasks: noTasks, lastPostHtml, onPrompt: passAll, exportAgoMin: null});
  await new Promise(r => setImmediate(r));
  assert.match(page.$("hud-status").textContent, /^Waiting for today's first export/);
  assert.strictEqual(page.$("hud-go").disabled, true);
  page.m365.length = 0;
  await page.$("hud-go").fire("click");
  assert.match(page.$("hud-status").textContent, /^Waiting for today's first export/);
  assert.deepStrictEqual(page.m365, []);
  assert.deepStrictEqual(page.prompts, []);
});

test("a live read stops one hour after a stale export, and the span past it is named under Could not read", async () => {
  const at = min => new Date(NOW - 180 * 60000 + min * 60000).toISOString();
  const liveMail = [{subject: "RE: inside the tail", sentDateTime: at(30), summary: "x"}, {subject: "RE: past the tail", sentDateTime: at(120), summary: "y"}];
  const page = buildPage({tasks: noTasks, lastPostHtml, onPrompt: passAll, exportAgoMin: 180, liveMail});
  await new Promise(r => setImmediate(r));
  page.m365.length = 0;
  await page.$("hud-go").fire("click");
  const mail = page.m365.find(c => c.tool === "outlook_email_search");
  assert.strictEqual(new Date(mail.input.beforeDateTime) - new Date(mail.input.afterDateTime), 3600000);
  const sent = draftPromptOf(page).split("MAIL HE SENT SINCE:")[1].split("MEETING NOTES")[0];
  assert.match(sent, /inside the tail/);
  assert.doesNotMatch(sent, /past the tail/);
  assert.match(page.$("hud-status").textContent, /Could not read: .*huddle channel [^;]*past the one-hour live tail.*sent mail [^;]*past the one-hour live tail/);
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

// Issue 848: the drafter learns from Dan's edits. Pressing Draft compares his last post with the draft he worked
// from, stores Claude's lessons as proposals, and sends the draft only the lessons he kept; Keep is his click.
const local = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const postAt = new Date(NOW - 86400000), workedFrom = new Date(postAt - 3600000);
const savedDraft = {_id: "d1", day: local(workedFrom), draftedAt: workedFrom.toISOString(),
  text: "Yesterday's report\n• Sent the vendor the supplier documents for setup\n\nToday's focus\n• Bid prep\n• Portal uploads\n\nRisks/Blockers\n• Bid work is pushing every other task out, so smaller jobs slip a week"};
const lessonRows = [{_id: "k1", text: "Kept: open report lines with his verbs.", status: "confirmed", confirmedAt: "2026-09-01T00:00:00Z"},
  {_id: "p1", text: "Proposed: not yet his.", status: "proposed"}, {_id: "x1", text: "Dropped: never again.", status: "dropped"}];

test("Draft compares his last post with the draft he worked from, proposes lessons, and feeds only kept ones", async () => {
  const page = buildPage({tasks: noTasks, lastPostHtml, collections: {huddle_drafts: [savedDraft], huddle_lessons: lessonRows}, onPrompt(prompt){
    if (prompt.startsWith("Dan Gatsakos edited the huddle post")){
      return {lessons: [{text: "Keep his focus lines until they are done.", changes: [0]}, {text: "Confirm me.", changes: [0], status: "confirmed"}]};
    }
    return passAll(prompt);
  }});
  await new Promise(r => setImmediate(r));
  await page.$("hud-go").fire("click");
  const asked = page.prompts.find(p => p.startsWith("Dan Gatsakos edited the huddle post"));
  assert(asked, "the compare ran: " + page.$("hud-status").textContent);
  assert.match(asked, /"change":"cut","text":"Portal uploads"/);
  const stamp = local(postAt) + "T" + String(postAt.getHours()).padStart(2, "0") + String(postAt.getMinutes()).padStart(2, "0") + String(postAt.getSeconds()).padStart(2, "0");
  const row = page.store["huddle_lessons/" + stamp + "-1"];
  assert.strictEqual(row.text, "Keep his focus lines until they are done.");
  assert.strictEqual(row.status, "proposed", "a model's lesson is never confirmed");
  assert.strictEqual(Object.keys(page.store).filter(k => k.startsWith("huddle_lessons/")).length, 1);
  const log = page.store["huddle_feedback/" + stamp];
  assert.strictEqual(JSON.stringify([log.draftId, log.changes, log.proposed, log.refused.map(x => x.why)]), JSON.stringify(["d1", 1, 1, ["wrong fields"]]));
  const draft = draftPromptOf(page);
  assert.match(draft, /- Kept: open report lines with his verbs\./);
  assert.doesNotMatch(draft, /Proposed: not yet his|Dropped: never again|Keep his focus lines/);
  assert.match(page.$("hud-status").textContent, /1 lesson proposed from your edits/);
});

test("Keep and Drop on the lessons list write the lesson's status, and Keep is the only confirm", async () => {
  const page = buildPage({tasks: noTasks, lastPostHtml, onPrompt: passAll, collections: {huddle_lessons: lessonRows}});
  await new Promise(r => setImmediate(r));
  assert.strictEqual(page.$("hud-lessons").hidden, false);
  assert.match(page.$("hud-lessons-body").innerHTML, /data-lesson="p1" data-act="keep"/);
  const press = (lesson, act) => { const b = {dataset: {lesson, act}, disabled: false}; return {target: {closest: s => s === "button[data-lesson]" ? b : null}}; };
  await page.$("hud-lessons-body").fire("click", press("p1", "keep"));
  assert.strictEqual(page.store["huddle_lessons/p1"].status, "confirmed");
  assert.ok(page.store["huddle_lessons/p1"].confirmedAt);
  await page.$("hud-lessons-body").fire("click", press("k1", "drop"));
  assert.strictEqual(page.store["huddle_lessons/k1"].status, "dropped");
});

test("a do-date ruling on a non-recurring task still sends the due string through update-tasks", async () => {
  const {writes, card} = await rule(false, {label: "Look again Oct 7", dueString: "Oct 7"});
  assert.strictEqual(card.status, "answered", card.error);
  assert.deepStrictEqual(writes.map(c => [c.tool, c.input.tasks[0].dueString]), [["update-tasks", "Oct 7"]]);
});
