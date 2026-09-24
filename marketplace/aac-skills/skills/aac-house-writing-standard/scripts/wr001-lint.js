#!/usr/bin/env node
/**
 * wr001-lint - deterministic checks for AAC-WR-001.
 *
 * Covers the rules a regex can decide with high precision. Five judgment
 * rules that are yes/no on a single unit get a TypeSafe Jev Noul each (issue
 * 731): Rule 5 on the opening paragraph, Rules 6 and 10 per sentence, Rule 162
 * on the last paragraph, Rule 164 per paragraph. Those findings are WARN only
 * and never change the exit code. With Jev unavailable (no credential, a
 * timeout, the service down) the output is exactly the regex-only output.
 * Rules 8, 9, 154, 161, 166 and the rest of Part XXV need the evidence or the
 * whole document and stay with a reader.
 *
 * Usage:
 *   node wr001-lint.js <file...> [--formal] [--prose] [--json] [--quiet]
 *
 *   --formal   treat input as a formal document (Rule 13 list): em dashes and
 *              exclamation points become hard failures. Auto-detected from the
 *              filename and the first 40 lines unless --prose is passed.
 *   --prose    force narrative treatment, overriding auto-detection.
 *   --json     machine-readable output.
 *   --quiet    findings only, no summary.
 *
 * Exit: 0 clean, 1 findings at error severity, 2 could not read a file.
 *
 * Pinned to AAC-WR-001 v0.6. Ship this file under the same tag as the
 * standard; a lint rule and the text it enforces must not drift apart.
 */

const fs = require("fs");
const path = require("path");
const { createJev } = require("./jev");

const STANDARD_VERSION = "0.7";

const FORMAL_HINTS =
  /\b(contract|agreement|master service|policy|demand letter|certification|legal notice|scope of work|proposal|terms and conditions)\b/i;

// Rule 62 and Rule 61. Left side is wrong, right side is the house form.
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

// Rule 56. Capital abbreviations take no periods. U.S., a.m., p.m. are correct
// and deliberately absent.
const DOTTED_ABBR = /\b(C\.E\.O|C\.F\.O|P\.D\.F|P\.O|R\.M\.R|G\.P|C\.R\.M|A\.H\.J|N\.F\.P\.A|H\.R|I\.T)\.?\b/g;

// Rule 27. Apostrophe never forms a plural.
const APOS_PLURAL =
  /\b(\d{4}'s|POs?'s|PDF's|CEO's\s+(?:are|were|include)|RMR's\s+(?:are|were)|[A-Z]{2,}'s\s+(?:are|were|include))/g;

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";

const CHECKS = [
  // --- Punctuation -------------------------------------------------------
  // Sentence spacing only. A markdown list marker ("1.  Item") and table cell
  // padding are layout, not sentence spacing; both are filtered in lintFile.
  { rule: 15, sev: "error", re: /[.!?:;]  +(?=[A-Z"'(])/g,
    msg: "two or more spaces between sentences; use one" },
  { rule: 25, sev: "error", re: /\band\/or\b/gi,
    msg: "and/or; name the actual relationship" },
  { rule: 27, sev: "error", re: APOS_PLURAL,
    msg: "apostrophe used to form a plural" },
  { rule: 29, sev: "warn", re: /\.\.\.|…/g,
    msg: "ellipsis; use only for omitted words inside a quotation" },
  { rule: 45, sev: "error", re: new RegExp("\\bfrom\\s+\\d{1,2}(:\\d{2})?\\s*(a\\.m\\.|p\\.m\\.)?\\s*[\\u2013\\u2014-]\\s*\\d", "gi"),
    msg: "en dash after 'from'; write 'from 8 a.m. to 10 a.m.'" },

  // --- Numbers, dates, time, money ---------------------------------------
  { rule: 42, sev: "error", re: new RegExp(`\\b(${MONTHS})\\s+\\d{1,2}(st|nd|rd|th)\\b`, "gi"),
    msg: "ordinal ending on a month-first date" },
  { rule: 44, sev: "error", re: /\b\d{1,2}:00\s*(a\.m\.|p\.m\.)/gi,
    msg: "':00' on the hour; write '8 a.m.'" },
  { rule: 57, sev: "error", re: /\b\d{1,2}(:\d{2})?\s*(AM|PM|am|pm|A\.M\.|P\.M\.)\b/g,
    msg: "time meridiem; use lowercase 'a.m.' / 'p.m.' with periods and a space" },
  { rule: 46, sev: "warn", re: /\$\d{1,3}(,\d{3})*\.00\b/g,
    msg: "'.00' on a whole-dollar amount; drop it unless a column mixes cents" },
  { rule: 53, sev: "error", re: /\(\d{3}\)\s*\d{3}-\d{4}/g,
    msg: "telephone in parentheses; house form is 847-555-1234" },

  // --- Abbreviations and spelling ----------------------------------------
  { rule: 56, sev: "error", re: DOTTED_ABBR,
    msg: "periods in a capital abbreviation" },
  { rule: 64, sev: "warn", re: /\s&\s/g,
    msg: "ampersand in prose; use 'and' outside official names and table heads" },
  { rule: 65, sev: "error", re: /\band\s+etc\./gi,
    msg: "'and etc.'" },
  { rule: 66, sev: "warn", re: /(?<![(\[])\b(e\.g\.|i\.e\.)/g,
    msg: "e.g. / i.e. in running prose; prefer 'for example' / 'that is'" },

  // --- Formatting ---------------------------------------------------------
  { rule: 165, sev: "error", re: /^#{1,6}\s.*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu,
    msg: "emoji in a heading" },
];

function stripUncheckable(lines) {
  // Rule 2 protects quotations and contract language; fenced code and block
  // quotes are not AAC prose. Blank them so line numbers stay true.
  let fenced = false;
  return lines.map((l) => {
    if (/^\s*```/.test(l)) { fenced = !fenced; return ""; }
    if (fenced) return "";
    if (/^\s*>/.test(l)) return "";
    // Table rows are layout; cell padding is not sentence spacing.
    if (/^\s*\|/.test(l)) return "";
    // A list marker is markdown syntax, not a sentence boundary.
    return l.replace(/^(\s*)(\d+\.|[-*+])\s+/, (m) => " ".repeat(m.length));
  });
}

function detectFormal(file, lines) {
  if (FORMAL_HINTS.test(path.basename(file))) return true;
  return FORMAL_HINTS.test(lines.slice(0, 40).join("\n"));
}

function lintFile(file, opts) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { file, unreadable: e.message, findings: [] };
  }

  const lines = raw.split(/\r?\n/);
  const body = stripUncheckable(lines);
  const formal =
    opts.prose ? false : opts.formal || detectFormal(file, lines);
  const findings = [];

  const push = (i, col, rule, sev, msg, text) =>
    findings.push({ line: i + 1, col, rule, sev, msg, text: text.trim() });

  body.forEach((line, i) => {
    for (const c of CHECKS) {
      c.re.lastIndex = 0;
      let m;
      while ((m = c.re.exec(line)) !== null) {
        push(i, m.index + 1, c.rule, c.sev, c.msg, m[0]);
        if (m[0].length === 0) c.re.lastIndex++;
      }
    }

    for (const [re, right, rule] of WORD_FORMS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        push(i, m.index + 1, rule, "error", `use '${right}'`, m[0]);
      }
    }

    // Rule 23. Amended at v0.5: cut by default, one rare exception permitted
    // in a longer narrative draft, none in a formal document.
    let em;
    const emRe = /\u2014/g;
    while ((em = emRe.exec(line)) !== null) {
      push(i, em.index + 1, 23,
        formal ? "error" : "warn",
        formal
          ? "em dash in a formal document; not permitted"
          : "em dash; cut unless a comma, period, or parenthesis reads worse",
        "\u2014");
    }

    // Rule 28. Exclamation points have no place in formal writing.
    let ex;
    const exRe = /!/g;
    while ((ex = exRe.exec(line)) !== null) {
      if (/^\s*#/.test(line) || /!\[/.test(line)) continue;
      push(i, ex.index + 1, 28, formal ? "error" : "warn",
        "exclamation point", "!");
    }
  });

  // Rule 47. Document-level: one percent form per document.
  const wordPct = (raw.match(/\b\d+(\.\d+)?\s+percent\b/g) || []).length;
  const signPct = (raw.match(/\b\d+(\.\d+)?%/g) || []).length;
  if (wordPct > 0 && signPct > 0) {
    findings.push({
      line: 0, col: 0, rule: 47, sev: "warn",
      msg: `document mixes 'percent' (${wordPct}) and '%' (${signPct}); pick one`,
      text: "",
    });
  }

  // Rules 146 and 147. The filename is part of the deliverable.
  if (/\b(final|finalfinal|new|updated|copy|draft\d*|v\d+\s*copy)\b/i.test(path.basename(file, path.extname(file)))) {
    findings.push({
      line: 0, col: 0, rule: 146, sev: "error",
      msg: "filename uses final / new / updated / copy; use Customer - Project - Document - YYYY-MM-DD - vN",
      text: path.basename(file),
    });
  }

  // Rule 23 allowance: one em dash is tolerable in a narrative draft, more is
  // a pattern. Collapse the warnings when only one fired.
  if (!formal) {
    const ems = findings.filter((f) => f.rule === 23);
    if (ems.length === 1) ems[0].msg += " (one permitted; this is the one)";
  }

  return { file, formal, findings, lines: lines.length };
}

// --- Jev judgment rules (issue 731) -------------------------------------
// A unit is flagged when Jev's probability of "yes, this breaks the rule" is at
// least JEV_FLOOR. Every finding here is WARN: the stopslop Stop hook forces a
// rewrite on ERROR, and a model's judgment never earns that.
const JEV_FLOOR = 0.8;
const JEV_BATCH = 40;
const JEV_MAX_SENTENCES = 150;

const noul = (instructions, yes, no) =>
  ({ type: "noul", instructions, criteria: { true: yes, false: no } });

const JEV_RULES = {
  5: {
    msg: "main point not first (Jev); open with the decision or action needed",
    q: (i) => noul(
      `Rule 5 of a business writing standard: in decision-oriented or action-oriented writing, state the principal point (the decision or action needed, who owns it, the deadline) before supporting detail, so the reader does not search through history to learn why the message was sent. \`paragraphs\` is the whole document in order. Does the opening paragraph \`paragraphs[${i}]\` give background, history or preamble while the document's request, decision or conclusion appears only in a later paragraph?`,
      "The opening paragraph is background, history or preamble, and the request, decision or conclusion comes later in the document.",
      "The opening paragraph states the main point first, or the writing is not decision- or action-oriented."),
  },
  6: {
    msg: "passive voice hides who is responsible (Jev); name the actor",
    q: (i) => noul(
      `Rule 6 of a business writing standard: name the person, role, company or party responsible for an action; do not use passive voice to hide responsibility. Does sentence \`sentences[${i}]\` use passive voice that leaves out who is responsible for an action?`,
      "Passive voice where responsibility matters and the actor is left unnamed, such as 'The revised proposal will be sent.' or 'Power to be provided by others.'",
      "The actor is named, the sentence is not passive, or the actor is unknown, irrelevant or intentionally omitted, such as 'Mark will send the revised proposal.'"),
  },
  10: {
    msg: "filler that adds no information (Jev); delete it",
    q: (i) => noul(
      `Rule 10 of a business writing standard: delete phrases that add no information, such as 'I am writing to inform you that', 'Please be advised that', 'It should be noted that', 'As you are aware', 'At this time', 'In order to', 'With regard to'. Does sentence \`sentences[${i}]\` contain such a filler phrase, so that it says the same thing with the phrase deleted?`,
      "The sentence carries a phrase that adds no information, such as 'Please be advised that the inspection is currently scheduled to take place on September 15.'",
      "Every phrase in the sentence carries information, such as 'The inspection is scheduled for September 15.'"),
  },
  162: {
    msg: "closing kicker or recap (Jev); end on the last real point",
    q: (i) => noul(
      `Rule 162 of a business writing standard: do not end on a manufactured resonance, and do not close by restating what the reader has already read. Is the last paragraph \`paragraphs[${i}]\` a kicker or a recap?`,
      "The last paragraph is a pull-quote or oracle line such as 'And that changes everything.' or 'Nothing else matters.', or it restates points the earlier paragraphs already made.",
      "The last paragraph carries new content: a real point, a request, a fact, or a next step."),
  },
  164: {
    msg: "dramatic fragmentation (Jev); use complete sentences",
    q: (i) => noul(
      `Rule 164 of a business writing standard forbids dramatic fragmentation: sentence fragments used for emphasis. Does paragraph \`paragraphs[${i}]\` use dramatic fragmentation?`,
      "Fragments for emphasis, such as '[Noun]. That's it. That's the [thing].', staccato 'X. And Y. And Z.', or 'This unlocks something. [Word].'",
      "Complete sentences, including short complete sentences that carry information."),
  },
};

// Prose units from the raw lines. Paragraphs are runs of prose lines; headings,
// list items, fenced code, block quotes and tables are not paragraphs.
function proseUnits(lines) {
  const body = stripUncheckable(lines);
  const paragraphs = [];
  let cur = null;
  lines.forEach((raw, i) => {
    const l = body[i];
    if (!l.trim() || /^\s*#/.test(raw) || /^\s*(\d+\.|[-*+])\s+/.test(raw)) { cur = null; return; }
    if (!cur) { cur = { line: i + 1, parts: [] }; paragraphs.push(cur); }
    cur.parts.push({ line: i + 1, text: l.trim() });
  });

  const sentences = [];
  for (const p of paragraphs) {
    let text = "";
    const marks = [];
    for (const part of p.parts) {
      if (text) text += " ";
      marks.push([text.length, part.line]);
      text += part.text;
    }
    p.text = text;
    const lineAt = (off) => marks.filter(([o]) => o <= off).pop()[1];
    const re = /[.!?]["')\]]*\s+(?=[A-Z"'(])/g;
    let start = 0, m;
    while ((m = re.exec(text)) !== null) {
      sentences.push({ line: lineAt(start), text: text.slice(start, m.index + m[0].trimEnd().length) });
      start = m.index + m[0].length;
    }
    if (start < text.length) sentences.push({ line: lineAt(start), text: text.slice(start) });
  }
  return { paragraphs, sentences: sentences.slice(0, JEV_MAX_SENTENCES) };
}

// Resolves to WARN findings, or to [] when Jev is unavailable or any batch
// fails: all or nothing, so an outage leaves the output exactly as it was.
async function jevFindings(lines, ask) {
  const { paragraphs, sentences } = proseUnits(lines);
  if (paragraphs.length === 0) return [];

  const questions = {};
  const units = {};
  const add = (rule, idx, unit) => {
    const id = `r${rule}_${Object.keys(questions).length}`;
    questions[id] = JEV_RULES[rule].q(idx);
    units[id] = { rule, unit };
  };
  add(5, 0, paragraphs[0]);
  if (paragraphs.length > 1) add(162, paragraphs.length - 1, paragraphs[paragraphs.length - 1]);
  paragraphs.forEach((p, i) => add(164, i, p));
  sentences.forEach((s, i) => { add(6, i, s); add(10, i, s); });

  const state = { paragraphs: paragraphs.map((p) => p.text), sentences: sentences.map((s) => s.text) };
  const ids = Object.keys(questions);
  const batches = [];
  for (let i = 0; i < ids.length; i += JEV_BATCH) {
    batches.push(Object.fromEntries(ids.slice(i, i + JEV_BATCH).map((id) => [id, questions[id]])));
  }

  let answers;
  try {
    answers = await Promise.all(batches.map((qs) => ask(state, qs)));
  } catch {
    return [];
  }
  if (answers.some((a) => !a || typeof a !== "object")) return [];
  const merged = Object.assign({}, ...answers);

  const out = [];
  for (const id of ids) {
    const a = merged[id];
    if (!a || typeof a.noul !== "number" || !(a.noul >= JEV_FLOOR)) continue;
    const { rule, unit } = units[id];
    out.push({ line: unit.line, col: 1, rule, sev: "warn", msg: JEV_RULES[rule].msg, text: unit.text.trim() });
  }
  return out;
}

// io.ask is the Jev call (null skips Jev); io.log and io.error are the output
// sinks. Resolves to the exit code.
async function run(argv, io = {}) {
  const log = io.log || console.log;
  const error = io.error || console.error;
  const ask = "ask" in io ? io.ask : createJev();
  const opts = {
    formal: argv.includes("--formal"),
    prose: argv.includes("--prose"),
    json: argv.includes("--json"),
    quiet: argv.includes("--quiet"),
  };
  const files = argv.filter((a) => !a.startsWith("--"));

  if (files.length === 0) {
    error("usage: node wr001-lint.js <file...> [--formal] [--prose] [--json] [--quiet]");
    return 2;
  }

  const results = files.map((f) => lintFile(f, opts));

  if (ask) {
    await Promise.all(results.filter((r) => !r.unreadable).map(async (r) => {
      const lines = fs.readFileSync(r.file, "utf8").split(/\r?\n/);
      r.findings.push(...(await jevFindings(lines, ask)));
    }));
  }

  if (opts.json) {
    log(JSON.stringify({ standard: STANDARD_VERSION, results }, null, 2));
  } else {
    for (const r of results) {
      if (r.unreadable) {
        error(`${r.file}: ${r.unreadable}`);
        continue;
      }
      for (const f of r.findings.sort((a, b) => a.line - b.line || a.col - b.col)) {
        const loc = f.line === 0 ? `${r.file}` : `${r.file}:${f.line}:${f.col}`;
        const snip = f.text ? `  "${f.text.slice(0, 40)}"` : "";
        log(`${loc}  ${f.sev.toUpperCase()}  Rule ${f.rule}  ${f.msg}${snip}`);
      }
      if (!opts.quiet) {
        const e = r.findings.filter((f) => f.sev === "error").length;
        const w = r.findings.length - e;
        log(
          `${r.file}: ${e} error, ${w} warn  [${r.formal ? "formal" : "narrative"}, WR-001 v${STANDARD_VERSION}]`
        );
      }
    }
  }

  if (results.some((r) => r.unreadable)) return 2;
  return results.some((r) => r.findings.some((f) => f.sev === "error")) ? 1 : 0;
}

module.exports = { lintFile, proseUnits, jevFindings, run, JEV_FLOOR };

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
