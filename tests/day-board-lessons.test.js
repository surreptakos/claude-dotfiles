// The huddle drafter's lesson loop (issue 848, aac-skills/todoist-triage/day-board.html): code diffs Dan's post
// against the draft he worked from, a proposal passes a closed gate, and only kept lessons reach a prompt.
// Fixtures are synthetic: no real post, name or amount.
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
const L = new Function("ymd", "clip", src.slice(from, to) +
  "; return {draftBefore, postDiff, vetLessons, keptLessons, lessonLines};")(ymd, clip);

const draftText = ["Yesterday's report", "• Sent the vendor the supplier documents", "", "Today's focus", "• Bid prep", "• Portal uploads",
  "", "Risks/Blockers", "• The partner is waiting on the manager's audit; the review can't close until audited", "• Bonus forms are late"].join("\n");
const postText = ["Dan | 9/30/2026", "Yesterday's report", "Sent the vendor the supplier documents", "Decided the bid scope",
  "Today's focus", "Bid prep", "Risks/Blockers", "The partner is waiting on my audit; the review can't close until audited"].join("\n");

test("the diff names what he cut, added and edited, and never a confidential line", () => {
  const diff = L.postDiff(draftText, postText);
  assert.deepStrictEqual(diff, [
    {section: "report", change: "added", text: "Decided the bid scope"},
    {section: "focus", change: "cut", text: "Portal uploads"},
    {section: "risks", change: "edited", from: "The partner is waiting on the manager's audit; the review can't close until audited",
      text: "The partner is waiting on my audit; the review can't close until audited"}
  ]);
  assert.deepStrictEqual(L.postDiff(draftText, draftText), [], "a post that is the draft word for word teaches nothing");
});

test("the draft he worked from is the newest passing draft of his post's day saved before he posted", () => {
  const at = h => new Date(2026, 8, 30, h, 0, 0);
  const drafts = [
    {_id: "a", day: "2026-09-30", draftedAt: at(9).toISOString(), text: "first"},
    {_id: "b", day: "2026-09-30", draftedAt: at(10).toISOString(), text: "second"},
    {_id: "c", day: "2026-09-30", draftedAt: at(10).toISOString(), blocked: true},
    {_id: "d", day: "2026-09-30", draftedAt: at(12).toISOString(), text: "after he posted"},
    {_id: "e", day: "2026-09-29", draftedAt: new Date(2026, 8, 29, 10).toISOString(), text: "another day"}
  ];
  assert.strictEqual(L.draftBefore(drafts, {at: at(11)})._id, "b");
  assert.strictEqual(L.draftBefore(drafts, {at: new Date(2026, 8, 28, 11)}), null);
});

test("a proposal passes only in the closed shape, citing a real change, plain, non-confidential and new", () => {
  const diff = L.postDiff(draftText, postText);
  const existing = [{text: "Write risks in his own voice.", status: "dropped"}];
  const res = {lessons: [
    {text: "Write in his first person: never name him in his own post.", changes: [2]},
    {text: "Keep his focus lines until they are done.", changes: [1], status: "confirmed"},
    {text: "Report every bid decision.", changes: []},
    {text: "Report every bid decision.", changes: [7]},
    {text: "Mention bonus forms when they are late.", changes: [0]},
    {text: "Write risks in his own voice.", changes: [2]},
    {text: "Write in his first person: never name him in his own post.", changes: [0]}
  ]};
  const v = L.vetLessons(res, diff, existing);
  assert.deepStrictEqual(v.ok.map(x => x.text), ["Write in his first person: never name him in his own post."]);
  assert.deepStrictEqual(v.ok[0].changes, [diff[2]], "the lesson keeps the change it came from");
  assert.deepStrictEqual(v.refused.map(x => x.why), ["wrong fields", "cites no change it came from", "cites no change it came from",
    "confidential detail", "repeats a lesson he has", "repeats a lesson he has"]);
  assert.strictEqual(v.refused[3].text, "(withheld)");
  assert.deepStrictEqual(L.vetLessons({nope: true}, diff, []).refused.map(x => x.why), ["proposer answered in the wrong shape"]);
  const many = {lessons: Array.from({length: 7}, (_, i) => ({text: "Lesson number " + "abcdefg"[i] + ".", changes: [0]}))};
  assert.strictEqual(L.vetLessons(many, diff, []).ok.length, 5, "at most five lessons from one post");
});

test("only kept lessons reach a prompt, oldest first", () => {
  const docs = [
    {text: "Second kept.", status: "confirmed", confirmedAt: "2026-10-02T10:00:00Z"},
    {text: "Still proposed.", status: "proposed"},
    {text: "Dropped.", status: "dropped"},
    {text: "First kept.", status: "confirmed", confirmedAt: "2026-10-01T10:00:00Z"}
  ];
  assert.deepStrictEqual(L.keptLessons(docs), ["First kept.", "Second kept."]);
  assert.deepStrictEqual(L.lessonLines([]), []);
  assert.match(L.lessonLines(L.keptLessons(docs)).join("\n"), /LESSONS FROM DAN'S OWN EDITS[^\n]*\n- First kept\.\n- Second kept\./);
});
