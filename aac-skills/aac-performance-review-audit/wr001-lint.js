#!/usr/bin/env node
// Copy of the aac-house-writing-standard skill's scripts/wr001-lint.js (WR-001 v0.6),
// recreated from the Read of the installed file because the sandbox cannot read the plugin path.
const fs = require("fs");
const path = require("path");
const STANDARD_VERSION = "0.6";
const FORMAL_HINTS =
  /\b(contract|agreement|master service|policy|demand letter|certification|legal notice|scope of work|proposal|terms and conditions)\b/i;
const WORD_FORMS = [
  [/\be-?mails?\b(?<!email)(?<!emails)/gi, "email", 62],
  [/\bweb\s+sites?\b/gi, "website", 62],
  [/\bon-line\b/gi, "online", 62],
  [/\bInternet\b/g, "internet", 62],
  [/\borganis(e|ed|ing|ation)\b/gi, "organiz-", 61],
  [/\bcolour\b/gi, "color", 61],
  [/\bcentre\b/gi, "centre -> center", 61],
  [/\blicence\b/gi, "license", 61],
  [/\bcatalogue\b/gi, "catalog", 61],
  [/\btravelling\b/gi, "traveling", 61],
  [/\bjudgement\b/gi, "judgment", 61],
];
const DOTTED_ABBR = /\b(C\.E\.O|C\.F\.O|P\.D\.F|P\.O|R\.M\.R|G\.P|C\.R\.M|A\.H\.J|N\.F\.P\.A|H\.R|I\.T)\.?\b/g;
const APOS_PLURAL =
  /\b(\d{4}'s|POs?'s|PDF's|CEO's\s+(?:are|were|include)|RMR's\s+(?:are|were)|[A-Z]{2,}'s\s+(?:are|were|include))/g;
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const CHECKS = [
  { rule: 15, sev: "error", re: /[.!?:;]  +(?=[A-Z"'(])/g, msg: "two or more spaces between sentences; use one" },
  { rule: 25, sev: "error", re: /\band\/or\b/gi, msg: "and/or; name the actual relationship" },
  { rule: 27, sev: "error", re: APOS_PLURAL, msg: "apostrophe used to form a plural" },
  { rule: 29, sev: "warn", re: /\.\.\.|…/g, msg: "ellipsis; use only for omitted words inside a quotation" },
  { rule: 45, sev: "error", re: new RegExp("\\bfrom\\s+\\d{1,2}(:\\d{2})?\\s*(a\\.m\\.|p\\.m\\.)?\\s*[\\u2013\\u2014-]\\s*\\d", "gi"), msg: "en dash after 'from'; write 'from 8 a.m. to 10 a.m.'" },
  { rule: 42, sev: "error", re: new RegExp(`\\b(${MONTHS})\\s+\\d{1,2}(st|nd|rd|th)\\b`, "gi"), msg: "ordinal ending on a month-first date" },
  { rule: 44, sev: "error", re: /\b\d{1,2}:00\s*(a\.m\.|p\.m\.)/gi, msg: "':00' on the hour; write '8 a.m.'" },
  { rule: 57, sev: "error", re: /\b\d{1,2}(:\d{2})?\s*(AM|PM|am|pm|A\.M\.|P\.M\.)\b/g, msg: "time meridiem; use lowercase 'a.m.' / 'p.m.' with periods and a space" },
  { rule: 46, sev: "warn", re: /\$\d{1,3}(,\d{3})*\.00\b/g, msg: "'.00' on a whole-dollar amount; drop it unless a column mixes cents" },
  { rule: 53, sev: "error", re: /\(\d{3}\)\s*\d{3}-\d{4}/g, msg: "telephone in parentheses; house form is 847-555-1234" },
  { rule: 56, sev: "error", re: DOTTED_ABBR, msg: "periods in a capital abbreviation" },
  { rule: 64, sev: "warn", re: /\s&\s/g, msg: "ampersand in prose; use 'and' outside official names and table heads" },
  { rule: 65, sev: "error", re: /\band\s+etc\./gi, msg: "'and etc.'" },
  { rule: 66, sev: "warn", re: /(?<![(\[])\b(e\.g\.|i\.e\.)/g, msg: "e.g. / i.e. in running prose; prefer 'for example' / 'that is'" },
  { rule: 165, sev: "error", re: /^#{1,6}\s.*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, msg: "emoji in a heading" },
];
function stripUncheckable(lines) {
  let fenced = false;
  return lines.map((l) => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return ""; }
    if (fenced) return "";
    if (/^\s*>/.test(l)) return "";
    if (/^\s*\|/.test(l)) return "";
    return l.replace(/^(\s*)(\d+\.|[-*+])\s+/, (m) => " ".repeat(m.length));
  });
}
function detectFormal(file, lines) {
  if (FORMAL_HINTS.test(path.basename(file))) return true;
  return FORMAL_HINTS.test(lines.slice(0, 40).join("\n"));
}
function lintFile(file, opts) {
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/);
  const body = stripUncheckable(lines);
  const formal = opts.prose ? false : opts.formal || detectFormal(file, lines);
  const findings = [];
  const push = (i, col, rule, sev, msg, text) => findings.push({ line: i + 1, col, rule, sev, msg, text: text.trim() });
  body.forEach((line, i) => {
    for (const c of CHECKS) { c.re.lastIndex = 0; let m;
      while ((m = c.re.exec(line)) !== null) { push(i, m.index + 1, c.rule, c.sev, c.msg, m[0]); if (m[0].length === 0) c.re.lastIndex++; } }
    for (const [re, right, rule] of WORD_FORMS) { re.lastIndex = 0; let m;
      while ((m = re.exec(line)) !== null) push(i, m.index + 1, rule, "error", `use '${right}'`, m[0]); }
    let em; const emRe = /—/g;
    while ((em = emRe.exec(line)) !== null) push(i, em.index + 1, 23, formal ? "error" : "warn", formal ? "em dash in a formal document; not permitted" : "em dash; cut unless a comma, period, or parenthesis reads worse", "—");
    let ex; const exRe = /!/g;
    while ((ex = exRe.exec(line)) !== null) { if (/^\s*#/.test(line) || /!\[/.test(line)) continue; push(i, ex.index + 1, 28, formal ? "error" : "warn", "exclamation point", "!"); }
  });
  const wordPct = (raw.match(/\b\d+(\.\d+)?\s+percent\b/g) || []).length;
  const signPct = (raw.match(/\b\d+(\.\d+)?%/g) || []).length;
  if (wordPct > 0 && signPct > 0) findings.push({ line: 0, col: 0, rule: 47, sev: "warn", msg: `document mixes 'percent' (${wordPct}) and '%' (${signPct}); pick one`, text: "" });
  if (/\b(final|finalfinal|new|updated|copy|draft\d*|v\d+\s*copy)\b/i.test(path.basename(file, path.extname(file))))
    findings.push({ line: 0, col: 0, rule: 146, sev: "error", msg: "filename uses final / new / updated / copy; use Customer - Project - Document - YYYY-MM-DD - vN", text: path.basename(file) });
  if (!formal) { const ems = findings.filter((f) => f.rule === 23); if (ems.length === 1) ems[0].msg += " (one permitted; this is the one)"; }
  return { file, formal, findings };
}
const argv = process.argv.slice(2);
const opts = { formal: argv.includes("--formal"), prose: argv.includes("--prose") };
const files = argv.filter((a) => !a.startsWith("--"));
const results = files.map((f) => lintFile(f, opts));
for (const r of results) {
  for (const f of r.findings.sort((a, b) => a.line - b.line || a.col - b.col)) {
    const loc = f.line === 0 ? `${r.file}` : `${r.file}:${f.line}:${f.col}`;
    console.log(`${loc}  ${f.sev.toUpperCase()}  Rule ${f.rule}  ${f.msg}${f.text ? `  "${f.text.slice(0, 40)}"` : ""}`);
  }
  const e = r.findings.filter((f) => f.sev === "error").length;
  console.log(`${r.file}: ${e} error, ${r.findings.length - e} warn  [${r.formal ? "formal" : "narrative"}, WR-001 v${STANDARD_VERSION}]`);
}
process.exit(results.some((r) => r.findings.some((f) => f.sev === "error")) ? 1 : 0);
