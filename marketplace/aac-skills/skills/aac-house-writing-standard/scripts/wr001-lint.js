#!/usr/bin/env node
/**
 * wr001-lint - deterministic checks for AAC-WR-001.
 *
 * Covers every rule a pattern can decide (see wr001-coverage.md beside this
 * file for all 167 rules: pattern, Jev, reader, or layout). Five judgment
 * rules that are yes/no on a single unit get a TypeSafe Jev Noul each (issue
 * 731): Rule 5 on the opening paragraph, Rules 6 and 10 per sentence, Rule 162
 * on the last paragraph, Rule 164 per paragraph. Those findings are WARN only
 * and never change the exit code. With Jev unavailable (no credential, a
 * timeout, the service down) the output is exactly the regex-only output.
 * A rule that needs the evidence, the audience or the whole document (8, 154,
 * 161, 166 among them) stays with a reader; the coverage table says which.
 *
 * Maintenance rule (Dan, 2026-09-29): a revision of the standard that adds or
 * changes a rule lands in the same PR as its check here, or as its row in
 * wr001-coverage.md saying why no pattern can decide it. Rule 37 sat in
 * Appendix F as an owner ruling for six days with no check and let two run-in
 * headings through; tools/wr001-lint-coverage.test.js fails when the table and
 * this file disagree.
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
 * Pinned to the STANDARD_VERSION below. Ship this file under the same tag
 * as the standard; a lint rule and the text it enforces must not drift apart.
 */

const fs = require("fs");
const path = require("path");
const { createJev } = require("./jev");

const STANDARD_VERSION = "0.10";

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


const NUM_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten";
const TEENS_UP = "eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const COUNT_NOUNS = "doors?|cameras?|technicians?|sites?|customers?|panels?|readers?|days?|weeks?|months?|years?|questions?|lists?|items?|people|employees?|clinics?|states?|systems?|tabs?|rows?|columns?|emails?|bills?|vendors?|companies|work orders?|locations?|devices?|contracts?|proposals?|invoices?|inspections?|visits?|calls?|tickets?|subcontractors?|groups?|parts?|steps?|pages?";
const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY";
// Rule 22: words ending in -ly that are not adverbs and may take a hyphen.
const LY_NOT_ADVERB = "family|supply|early|only|daily|weekly|monthly|yearly|quarterly|hourly|assembly|ally|rally|fly|apply|reply|july|italy|jelly|belly|bully|holy|ugly|likely|friendly|lovely|timely|costly|deadly|elderly|lonely|orderly|silly|chilly|hilly|oily|wily|jolly|folly|tally|bodily|kindly|worldly";

// Phrase and word checks added 2026-09-29 (Dan: "shouldn't all rules be in the
// linter?"). Each row: the rule it decides, the severity, the pattern, the
// message. formalSev, when present, replaces sev in a formal document.
const PHRASE_CHECKS = [
  // --- Part II, house style -----------------------------------------------
  { rule: 9, sev: "warn", re: /\b(utili[sz]e[sd]?|utili[sz]ing|utili[sz]ation|prior to|subsequent to|commence[sd]?|commencing|due to the fact that|in the event that|at the present time|in close proximity to)\b/gi,
    msg: "plain language: prefer use, before, after, start, because, if, now, near" },
  { rule: 10, sev: "error", re: /\b(I am writing to (inform|let|tell|advise)|Please be advised that|It should be noted that|As you (are|may be) aware|At this time,?|In order to|With regard to|Please note that|Kindly note that)\b/gi,
    msg: "filler that adds no information; delete it" },
  { rule: 14, sev: "warn", re: /\bshall\b/gi,
    msg: "'shall' outside a contract; use will, must, or may (Rule 139 keeps it in legal text)" },
  // --- Part III, punctuation ------------------------------------------------
  { rule: 16, sev: "warn", re: /\b[\w'-]+, [\w'-]+(?: [\w'-]+)?, (?!(?:and|or|is|are|was|were|has|have|will|which|who|but|so|then)\b)(?:[\w'-]+ )?[\w'-]+ (?:and|or) [\w'-]+/g,
    msg: "series of three or more with no serial comma before the last item" },
  { rule: 21, sev: "error", re: /\b(are|is|were|was|include|includes|included|of|to|for|with|by|such as|at)\s*:(?!\d)/g,
    msg: "colon directly after a verb or preposition; finish the sentence first" },
  { rule: 22, sev: "warn", re: new RegExp(`\\b(?!(?:${LY_NOT_ADVERB})-)[a-z]+ly-[a-z]+\\b`, "gi"),
    msg: "hyphen after an -ly adverb; write 'highly confidential', not 'highly-confidential'" },
  // --- Part IV, capitalization ---------------------------------------------
  { rule: 35, sev: "warn", re: /(?<![.!?]\s|^)\b(Fire Alarm|Access Control|Intrusion Alarm|Video Surveillance|Burglar Alarm) (System|Systems|Monitoring)\b(?![\w ]*(?:Admin Fee|tab|column|Fee))/g,
    msg: "generic system type capitalized mid-sentence; lowercase unless it is an official product or a quotation" },
  // --- Part V, numbers, dates, time, money ---------------------------------
  { rule: 38, sev: "warn", re: new RegExp(`(?<![$\\d.,:/-])\\b([1-9]|10)\\s+(${COUNT_NOUNS})\\b(?!\\s*(?:%|percent|a\\.m\\.|p\\.m\\.))`, "g"),
    msg: "figure for a number one through ten in prose; spell it out (Rule 39 excepts a related series)" },
  { rule: 38, sev: "warn", re: new RegExp(`\\b(${TEENS_UP})(?:-(?:${NUM_WORDS}))?\\s+(${COUNT_NOUNS})\\b`, "gi"),
    msg: "spelled-out number over ten; use figures (11 cameras, 24 customers)" },
  { rule: 40, sev: "warn", re: /[.!?]\s+\d[\d,.]*\s+[a-z]/g,
    msg: "sentence begins with a figure; spell it out or recast" },
  { rule: 42, sev: "error", re: new RegExp(`\\b(${MONTHS}),\\s+\\d{4}\\b`, "g"),
    msg: "comma between month and year; write 'September 2026'" },
  { rule: 43, sev: "warn", re: /(?<![\w/])\d{1,2}\/\d{1,2}\/\d{2,4}(?![\w/])/g,
    msg: "numeric date in narrative text; write the month out, or YYYY-MM-DD where a sortable date helps" },
  { rule: 44, sev: "warn", re: /\b12(:00)?\s*(a\.m\.|p\.m\.)/gi,
    msg: "12 a.m. or 12 p.m.; use midnight or noon" },
  { rule: 46, sev: "error", re: /\$\s*\d[\d,]*(\.\d+)?\s+dollars\b/gi,
    msg: "dollar sign and the word dollars together; use one" },
  { rule: 47, sev: "warn", re: /\b\d+(\.\d+)?%(?!\s*(?:markup|Mark-Up|cap))/g, prose: true, noTables: true,
    msg: "percent symbol in narrative prose; write '39 percent' (tables and dashboards keep the symbol)" },
  { rule: 48, sev: "warn", re: new RegExp(`\\b(${NUM_WORDS})\\s+(feet|foot|inches|inch|hours?|minutes?|pounds?|volts?|amps?|miles?|gallons?|seconds?)\\b(?!\\s+(?:notice|ago|later|drive|walk))`, "gi"),
    msg: "spelled-out technical measurement; use figures (5 feet, 2 hours)" },
  { rule: 50, sev: "error", re: /(?<![\w.$])\.\d+\b(?![\w.-])/g,
    msg: "decimal under one with no leading zero; write 0.5" },
  { rule: 52, sev: "warn", re: /\b(1st|2nd|3rd|[4-9]th|10th)\b/g,
    msg: "ordinal first through tenth; spell it out (figures only for identifiers and 11th on)" },
  { rule: 54, sev: "warn", re: /\b(approx\.|w\/|b\/c|thru\b|pls\b|dept\.|mgmt\.)/gi,
    msg: "ordinary word abbreviated in prose; spell it out" },
  { rule: 60, sev: "warn", re: new RegExp(`\\b[A-Z][a-z]+(?: [A-Z][a-z]+)?, (${US_STATES})\\b(?!-\\d)(?![\\s,]*\\d{5})`, "g"),
    msg: "state abbreviation in prose; spell the state out (USPS form only in a postal address)" },
  { rule: 63, sev: "error", re: /\b(to|please|will|can|should|must|and|then|not)\s+(setup|login|backup|signoff|handoff|breakdown)\b/gi,
    msg: "one-word noun form used as a verb; the verb is two words (set up, log in, back up)" },
  { rule: 63, sev: "error", re: /\b(a|an|the|this|that|our|your|initial|quick|full)\s+(set up|log in|back up|follow up|sign off|hand off|break down)\b(?!\s+(?:the|a|an|our|your|with|on|to|by|for|from|it|them|him|her)\b)/gi,
    msg: "two-word verb form used as a noun; the noun is one word or hyphenated (setup, login, follow-up)" },
  { rule: 84, sev: "warn", re: /\b[A-Z]{4,}(?:\s+[A-Z]{2,}){3,}\b/g,
    msg: "running text in all capitals; use sentence case (quoted headings aside)" },
  { rule: 88, sev: "error", re: /\bclick here\b/gi,
    msg: "'Click here'; use descriptive link text" },
  // --- Part XII, email ------------------------------------------------------
  { rule: 100, sev: "warn", re: /^Subject:\s*(Question|Update|FYI|Important|Hello|Hi|Follow[- ]?up|Quick question|Checking in)\s*$/im,
    msg: "subject line with no topic, project, or required action" },
  { rule: 101, sev: "error", re: /\b(I )?hope (this|you)('re| are| find| finds)?[\w ]{0,20}(well|doing well|great)\b/gi,
    msg: "'I hope this email finds you well'; start with the purpose" },
  { rule: 104, sev: "warn", re: /\bASAP\b/g,
    msg: "'ASAP'; give the date and time, or the sequence that sets the deadline" },
  // --- Part XXV, draft quality and AI tells ------------------------------
  { rule: 155, sev: "warn", re: /\b(really|just|literally|genuinely|honestly|simply|actually|deeply|truly|fundamentally|inherently|inevitably|interestingly|importantly|crucially)\b/gi,
    msg: "empty adverb; cut it unless it carries emphasis or uncertainty" },
  { rule: 155, sev: "error", re: /\b(At its core|In today's [\w-]+|It's worth noting|It is worth noting|At the end of the day|When it comes to|In a world where|The reality is)\b/gi,
    msg: "filler phrase (Appendix G8); delete it" },
  { rule: 156, sev: "error", re: /\b(What nobody tells you|What they don't tell you|The part everyone misses|Here's what most people miss|The missing piece is|Nobody talks about)\b/gi,
    msg: "faux-insight setup; state the point" },
  { rule: 157, sev: "error", re: /\b(The best part|The kicker|The result|The truth|The catch|The upshot|The bottom line|The key|The takeaway|Bottom line):/g,
    msg: "colon-reveal drama; write one sentence" },
  { rule: 158, sev: "error", re: /\b(marks a pivotal moment|stands as a testament|underscores the importance|a shining example of|speaks volumes|a powerful reminder|represents a significant (milestone|step)|The reasons are structural|The implications are significant|This is the deepest problem|The stakes are high|The consequences are real)\b/gi,
    msg: "importance puffery or vague declarative; give the fact and let the reader judge" },
  { rule: 159, sev: "error", re: /,\s+(highlighting|underscoring|demonstrating|reflecting|showcasing|emphasizing|signaling|reinforcing|illustrating|paving the way)\b/gi,
    msg: "trailing participial clause that restates the sentence as commentary; end on the act" },
  { rule: 160, sev: "error", re: /\b(experts agree|studies show|research suggests|scientists say|observers note|industry leaders believe|it is widely understood|data indicates)\b/gi,
    msg: "weasel attribution; name the source or cut the claim" },
  { rule: 162, sev: "error", re: /\b(And that changes everything|That's the whole game|Nothing else matters|Let that sink in)\b/gi,
    msg: "fake-profound kicker; end on the last real point" },
  { rule: 163, sev: "error", re: /\b(the key point is|this distinction matters|what this means is|it is worth noting|the takeaway is|it's important to understand|this is a crucial distinction|Here's the thing|Here's what|Here's this|Here's that|Here's why|The uncomfortable truth is|It turns out|The real [\w-]+ is|Let me be clear|The truth is,|I'll say it again|I'm going to be honest|Can we talk about|Here's the problem though|This matters because|Make no mistake|Here's why that matters|Full stop\.|Hint:|Plot twist:|Spoiler:|You already know this, but|But that's another post|is a feature, not a bug|Dressed up as|Let me walk you through|In this section, we'll|As we'll see|I want to explore|They exist, I promise|I promise)\b/gi,
    msg: "interpretive metadiscourse or throat-clearing (Appendix G1, G2, G7, G9, G10); delete the wrapper, keep the sentence" },
  { rule: 164, sev: "error", re: /\b(Not because [^.]{1,60}\. Because|isn't the problem\. [\w ]+ is\.|The answer isn't [^.]{1,40}\. It's|The question isn't [^.]{1,40}\. It's|It's not (about )?[^.]{1,40}\. It's|not just [^.]{1,40} but also|It feels like [^.]{1,40}\. It's actually|stops being [^.]{1,30} and starts being|That's it\. That's the|Here's what I mean:|Think about it:|And that's okay\.|Nobody designed this\.|People tend to)\b/gi,
    msg: "formulaic structure (Appendix H1 to H6); state the point directly" },
  { rule: 164, sev: "warn", re: /(?:^|[.!?]\s+)(So|Look),\s/g,
    msg: "sentence opens with 'So,' or 'Look,'; start with content" },
  { rule: 165, sev: "warn", re: /\w\s\*\*[^*\n]{1,40}\*\*\s\w/g,
    msg: "decorative bold inside a sentence; put the emphasis in the words" },
  { rule: 167, sev: "error", re: /\b(delve[sd]?|delving|foster(s|ed|ing)?|leverag(e|es|ed|ing)|facilitat(e|es|ed|ing)|empower(s|ed|ing|ment)?|streamlin(e|es|ed|ing)|elevat(e|es|ed|ing)|embark(s|ed|ing)?|supercharg(e|es|ed|ing)|garner(s|ed|ing)?|enhanc(e|es|ed|ing|ement|ements)|bolster(s|ed|ing)?|underscor(e|es|ed|ing)|showcas(e|es|ed|ing)|emphasi[sz](e|es|ed|ing)|highlight(s|ed|ing)|tapestry|realm|interplay|testament|multifaceted|meticulous(ly)?|intricate|paramount|transformative|pivotal|crucial(ly)?|enduring|vibrant|valuable|ever-evolving|cutting-edge|deep dive|align(s|ed|ing)? with|paradigm shift|game[- ]changer|navigat(e|es|ed|ing) (the )?(challenges|complexit|landscape)|unpack(s|ed|ing)?|lean(s|ed|ing)? into|double down|take a step back|moving forward|circle back|on the same page)\b/gi,
    msg: "machine vocabulary (Rule 167, Appendix G3); cut or replace with the plain word" },
  { rule: 167, sev: "error", re: /\blandscape\b(?!\s*(?:orientation|mode|page|section|layout|view|printing|tab))/gi,
    msg: "'landscape' as an abstract noun; say situation or field (page orientation is exempt)" },
];

const CHECKS = [
  // --- Punctuation -------------------------------------------------------
  // Sentence spacing only. A markdown list marker ("1.  Item") and table cell
  // padding are layout, not sentence spacing; both are filtered in lintFile.
  { rule: 15, sev: "error", re: /[.!?:;]  +(?=[A-Z"'(])/g,
    msg: "two or more spaces between sentences; use one" },
  { rule: 26, sev: "warn", re: /[\w)\]][”"][.,](?!\d)/g,
    msg: "period or comma outside the closing quotation mark; U.S. style puts it inside (a technical identifier may keep it outside)" },
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
  const hasTables = lines.some((l) => /^\s*\|/.test(l));

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

    // Rule 2 protects quotations: an inline quoted span is not AAC prose.
    const unquoted = line.replace(/["“][^"”\n]{3,}["”]/g, (q) => " ".repeat(q.length));
    for (const c of PHRASE_CHECKS) {
      if (c.prose && (formal || !opts.prose)) continue;
      if (c.noTables && hasTables) continue;
      c.re.lastIndex = 0;
      let m;
      while ((m = c.re.exec(unquoted)) !== null) {
        push(i, m.index + 1, c.rule, c.formalSev && formal ? c.formalSev : c.sev, c.msg, m[0]);
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

    // Rule 37. A run-in heading ("Can install. As a starting point...") is
    // permitted only in a legal document, and then ends with a colon. After
    // stripUncheckable blanks the list marker, a list item is the only line
    // that starts with spaces, so the check reaches list items alone: a label
    // of one to three words, capitalized, ending in a period, then a capital.
    // A digit in the label does not exempt it: "Question 2, counts." slipped
    // through on 2026-09-29. (Dan, 2026-09-29, on the OSH delegation emails.)
    const runIn = /^\s+([A-Z][\w'-]*(?:,?\s+[\w'-]+){0,2}\.)\s+(?=[A-Z])/.exec(line);
    if (runIn && !/^(?:Yes|No)\.$/.test(runIn[1])) {
      push(i, runIn.index + 1, 37, formal ? "error" : "warn",
        "run-in heading ending in a period; recast the label as a sentence (Rule 37 allows run-in headings only in legal documents, ending with a colon)",
        runIn[1]);
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

  // Rule 93. No more than three list levels.
  lines.forEach((l, i) => {
    const m = /^(\s*)(\d+\.|[-*+])\s+/.exec(l);
    if (m && m[1].length >= 9) {
      findings.push({ line: i + 1, col: 1, rule: 93, sev: "warn", msg: "list nested deeper than three levels", text: l.trim().slice(0, 40) });
    }
  });

  // Rule 95. A table carries a short descriptive title above it.
  lines.forEach((l, i) => {
    if (!/^\s*\|/.test(l) || (i > 0 && /^\s*\|/.test(lines[i - 1]))) return;
    let j = i - 1;
    while (j >= 0 && !lines[j].trim()) j--;
    if (j < 0 || !/^\s*(?:\*\*)?Table\b/i.test(lines[j])) {
      findings.push({ line: i + 1, col: 1, rule: 95, sev: "warn", msg: "table without a title line above it ('Table 1. ...')", text: l.trim().slice(0, 40) });
    }
  });

  // Rule 124. A document with a table states its data-as-of date or period.
  if (hasTables && !/\b(as of|data as of|reporting period|through (?:\w+ \d{1,2}, )?\d{4}|trailing (?:twelve|\d+) months|period covered)\b/i.test(raw)) {
    findings.push({ line: 0, col: 0, rule: 124, sev: "warn", msg: "tables present but no data-as-of date or reporting period found", text: "" });
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
    msg: "main point not early (Jev); open with the decision or action needed",
    q: (i) => noul(
      `Rule 5 of a business writing standard: in decision-oriented or action-oriented writing, state the principal point (the decision or action needed, who owns it, the deadline) early, before supporting detail, so the reader does not search through history to learn why the message was sent. A short courtesy opening, such as a thank-you or an introduction to a new contact, may come first. \`paragraphs\` is the whole document in order. Does the opening paragraph \`paragraphs[${i}]\` give background, history or preamble (other than a short courtesy opening) while the document's request, decision or conclusion appears only in a later paragraph?`,
      "The opening paragraph is background, history or preamble, and the request, decision or conclusion comes later in the document.",
      "The opening paragraph states the main point, is a short courtesy opening followed by the main point, or the writing is not decision- or action-oriented."),
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
  // exitCode, not process.exit(): on Windows Node 24 a forced exit while a
  // Jev socket is still closing trips libuv's `!(handle->flags &
  // UV_HANDLE_CLOSING)` assertion in src/win/async.c and the process
  // returns 127 after printing a clean report (seen 2026-09-29).
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
