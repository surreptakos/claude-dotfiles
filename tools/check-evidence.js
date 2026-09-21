#!/usr/bin/env node
/**
 * check-evidence — the Grounding Invariant for a research or memory note.
 *
 *   node tools/check-evidence.js <note.md> [<note.md> ...]
 *                                [--all-numbers] [--fetch] [--json]
 *
 * Issue 621, borrowed from `karpathy-llm-wiki` (MIT) and its `scripts/check_evidence.py`: every
 * number, date and quote in a note must appear verbatim in a source the note itself cites. This
 * is grep. No model is in the loop, and that is the whole value — it cannot rationalise a number
 * that is not there.
 *
 * THE CONTRACT
 *
 * Sources. A note cites a source two ways, and only these two count:
 *   - a Markdown link — `[the bootstrap gate](tests/bootstrap-test.sh)`, `[CLI 2.1.273](https://…)`
 *   - a `Source:` line — `Source: docs/agents/memory/x.md, https://example.invalid/spec`
 *     (`Sources:` too, with or without a list marker or `**bold**`; entries split on commas)
 * A path in backticks is a mention, not a citation: a note that names `lib/manifest.ps1` in prose
 * has not said its numbers came from there. Cite it to have it checked.
 *
 * Facts. Every line outside the YAML front matter and outside the citation lines themselves
 * yields:
 *   - numbers — `1833`, `1,833`, `2.1.273`, `0.5` (single digits are noise: `Phase 2`, list
 *     markers, `v3`. They are skipped unless --all-numbers)
 *   - dates — `2026-09-16`, `2026-09-19T06:30:00.000Z`, `16 September 2026`, `Sep 16, 2026`
 *   - quotes — text inside "double quotes" or “smart quotes”, four or more characters
 * Markdown link targets and bare URLs are stripped before extraction, so an issue number inside
 * a link href is not mistaken for a claim.
 *
 * Matching. A fact passes when it appears in ANY cited local source. Numbers match on digit
 * boundaries (`29` is not found by `129`) and a thousands separator may differ between note and
 * source (`1,833` matches `1833`). Quotes match with runs of whitespace collapsed, because
 * Markdown wraps a quotation across lines. Everything else is a verbatim substring.
 *
 * Output — one line per finding, then one summary line per note:
 *   <note>:<line> fact not found in <source>: <fact>
 *   <note>:<line> unchecked <source> (<why>)
 *
 * Exit 0 clean, 1 on any miss, 2 on a usage or read error, 3 when nothing missed but something
 * could not be checked — an unfetchable URL, a cited path that is not on disk, or a note that
 * cites nothing at all. An unchecked source is never reported as a pass, so it never exits 0.
 *
 * URLs are unchecked by default; --fetch tries them over the network and reports the ones that
 * fail as unchecked, never as a pass.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December'
  + '|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';

const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/g,            // 2026-09-19T06:30:00.000Z
  /\b\d{4}-\d{2}-\d{2}\b/g,                                          // 2026-09-16
  new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}\\b`, 'g'),   // 16 September 2026
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'g'), // Sep 16, 2026
];

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
// Quotes are matched across line breaks — Markdown wraps a quotation — but a candidate spanning a
// blank line or more than QUOTE_MAX_LINES lines is an unbalanced quote character, not a quotation.
const QUOTE_RE = /"([^"]+)"|“([^”]+)”/g;
const QUOTE_MAX_LINES = 4;
const LINK_RE = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const BARE_URL_RE = /\b(?:https?|ftp):\/\/\S+/g;
const SOURCE_LINE_RE = /^\s*(?:[-*+>]\s*)*(?:\*\*)?sources?(?:\*\*)?\s*:\s*(.+)$/i;

/** The note's lines with its YAML front matter blanked out, line numbering preserved. */
function stripFrontMatter(lines) {
  if (lines.length === 0 || lines[0].trim() !== '---') return lines.slice();
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return lines.slice();
  return lines.map((l, i) => (i <= end ? '' : l));
}

const isUrl = (s) => /^(?:https?|ftp):\/\//i.test(s);

function cleanTarget(raw) {
  let t = String(raw).trim().replace(/^[`<(]+/, '').replace(/[`>),.;]+$/, '');
  if (!t || t.startsWith('#') || /^(?:mailto|tel):/i.test(t)) return null;
  if (!isUrl(t)) t = t.split('#')[0];
  return t || null;
}

/** Every source the note cites, plus the line numbers that are citations (and so not facts). */
function citedSources(lines) {
  const sources = [];
  const citationLines = new Set();
  const seen = new Set();
  const add = (target, line) => {
    const t = cleanTarget(target);
    if (!t || seen.has(t)) return;
    seen.add(t);
    sources.push({ ref: t, url: isUrl(t), line });
  };
  lines.forEach((text, i) => {
    const lineNo = i + 1;
    const sourceLine = text.match(SOURCE_LINE_RE);
    if (sourceLine) {
      citationLines.add(lineNo);
      for (const part of sourceLine[1].split(/[,;]|\s+and\s+/)) {
        LINK_RE.lastIndex = 0;
        const link = LINK_RE.exec(part);
        add(link ? link[2] : part, lineNo);
      }
    }
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text)) !== null) add(m[2], lineNo);
  });
  return { sources, citationLines };
}

/** Prose with link targets and bare URLs removed, and list / heading markers dropped. */
function prose(text) {
  return text
    .replace(LINK_RE, (_m, label) => label)
    .replace(BARE_URL_RE, ' ')
    .replace(/^\s{0,8}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)+/, '');
}

/**
 * A token whose digits belong to a name, not to a claim: a session or worker id, a hash, a
 * branch. Letters glued to digits are the tell. A version (`v27`, `2.1.273`) and a number with a
 * unit (`2KB`, `40ms`) are claims and stay.
 */
function isIdentifierToken(token) {
  if (/^v?\d+(?:\.\d+)*$/i.test(token)) return false;
  if (/^\d+(?:\.\d+)?(?:%|x|k|m|b|kb|mb|gb|tb|ms|s|h|d|px)$/i.test(token)) return false;
  return /[A-Za-z_]\d|\d[A-Za-z_]/.test(token);
}

/** Every hard fact in the note body, in line order. */
function extractFacts(lines, opts = {}) {
  const allNumbers = Boolean(opts.allNumbers);
  const skip = opts.citationLines || new Set();
  const facts = [];
  const seenAll = new Set();
  const push = (lineNo, kind, value) => {
    const key = `${lineNo}\u0000${kind}\u0000${value}`;
    if (seenAll.has(key)) return;
    seenAll.add(key);
    facts.push({ line: lineNo, kind, text: value });
  };

  // Quotes: one pass over the whole body, so a quotation wrapped across lines is still one fact.
  const cleaned = lines.map((raw, i) => ((!raw.trim() || skip.has(i + 1)) ? '' : prose(raw)));
  const doc = cleaned.join('\n');
  const lineOf = (offset) => doc.slice(0, offset).split('\n').length;
  let q;
  QUOTE_RE.lastIndex = 0;
  while ((q = QUOTE_RE.exec(doc)) !== null) {
    const quoted = (q[1] || q[2] || '').trim();
    if (quoted.includes('\n\n')) continue;
    if (quoted.split('\n').length > QUOTE_MAX_LINES) continue;
    if (quoted.replace(/\s+/g, ' ').length < 4) continue;
    push(lineOf(q.index), 'quote', quoted);
  }

  cleaned.forEach((clean, i) => {
    const lineNo = i + 1;
    if (!clean.trim()) return;
    let text = clean;
    let m;
    for (const re of DATE_PATTERNS) {
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        push(lineNo, 'date', m[0]);
        // Blank the date out so its digits are not re-read as bare numbers.
        text = text.slice(0, m.index) + ' '.repeat(m[0].length) + text.slice(m.index + m[0].length);
      }
    }
    for (const token of text.split(/\s+/)) {
      const bare = token.replace(/^[`'"([{<*_~]+/, '').replace(/[`'")\]}>*_~,.;:!?]+$/, '');
      if (!bare || !/\d/.test(bare)) continue;
      if (isIdentifierToken(bare)) continue;   // wf_911fa64d-102-10, a1b2c3 — an id, not a claim
      NUMBER_RE.lastIndex = 0;
      while ((m = NUMBER_RE.exec(bare)) !== null) {
        const n = m[0].replace(/[.,]$/, '');
        if (!allNumbers && /^\d$/.test(n)) continue;
        push(lineNo, 'number', n);
      }
    }
  });
  return facts;
}

/** indexOf for a number: an occurrence with a digit glued to either end is a different number. */
function digitBoundedIndexOf(haystack, needle) {
  const isDigit = (c) => c >= '0' && c <= '9';
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) {
    const before = haystack[i - 1];
    const before2 = haystack[i - 2];
    const after = haystack[i + needle.length];
    const after2 = haystack[i + needle.length + 1];
    const bad =
      (before !== undefined && (isDigit(before)
        || ((before === '.' || before === ',') && before2 !== undefined && isDigit(before2))))
      || (after !== undefined && (isDigit(after)
        || ((after === '.' || after === ',') && after2 !== undefined && isDigit(after2))));
    if (!bad) return i;
  }
  return -1;
}

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** A fact on one output line: whitespace collapsed, a long quotation cut short. */
function show(text, max = 90) {
  const one = collapse(text);
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Does this one fact appear in this one source text? */
function factInSource(fact, sourceText, collapsedSource) {
  if (fact.kind === 'quote') return (collapsedSource || collapse(sourceText)).includes(collapse(fact.text));
  if (fact.kind === 'date') return sourceText.includes(fact.text);
  const variants = new Set([fact.text]);
  if (fact.text.includes(',')) variants.add(fact.text.replace(/,/g, ''));
  if (/^\d{4,}$/.test(fact.text)) variants.add(fact.text.replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  for (const v of variants) if (digitBoundedIndexOf(sourceText, v) >= 0) return true;
  return false;
}

function resolveLocal(ref, noteDir, root) {
  for (const base of [noteDir, root, process.cwd()]) {
    const p = path.resolve(base, ref);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/**
 * Check one note.
 * @returns {{note:string, findings:object[], facts:object[], sources:object[], checked:object[],
 *            unchecked:object[], misses:number, status:'clean'|'miss'|'unchecked', summary:string}}
 */
function checkNote(notePath, opts = {}) {
  const src = fs.readFileSync(notePath, 'utf8');
  const noteDir = path.dirname(path.resolve(notePath));
  const root = opts.root || process.cwd();
  const fromCwd = path.relative(process.cwd(), notePath);
  const rel = (fromCwd && fromCwd.length < notePath.length) ? fromCwd : notePath;
  const body = stripFrontMatter(src.split(/\r?\n/));
  const { sources, citationLines } = citedSources(body);
  const facts = extractFacts(body, { allNumbers: opts.allNumbers, citationLines });

  const findings = [];
  const checked = [];
  const unchecked = [];
  for (const s of sources) {
    if (s.url) {
      const fetched = opts.fetched && opts.fetched.get(s.ref);
      if (fetched && fetched.ok) checked.push({ ref: s.ref, text: fetched.text, collapsed: collapse(fetched.text) });
      else unchecked.push({ ...s, why: fetched ? fetched.why : 'URL, not fetched (pass --fetch)' });
      continue;
    }
    const resolved = resolveLocal(s.ref, noteDir, root);
    if (!resolved) { unchecked.push({ ...s, why: 'no such file' }); continue; }
    const text = fs.readFileSync(resolved, 'utf8');
    checked.push({ ref: s.ref, text, collapsed: collapse(text) });
  }
  for (const u of unchecked) findings.push({ line: u.line, kind: 'unchecked', text: `unchecked ${u.ref} (${u.why})` });

  let misses = 0;
  if (checked.length > 0) {
    const named = checked.map((c) => c.ref).join(', ');
    for (const fact of facts) {
      if (checked.some((c) => factInSource(fact, c.text, c.collapsed))) continue;
      misses += 1;
      findings.push({ line: fact.line, kind: 'miss', text: `fact not found in ${named}: ${show(fact.text)}` });
    }
  }
  findings.sort((a, b) => a.line - b.line);

  const noSources = sources.length === 0;
  const status = misses > 0 ? 'miss'
    : (noSources || unchecked.length > 0) ? 'unchecked'
      : 'clean';
  const summary = noSources
    ? `${rel}: no cited sources (Markdown link or Source: line) — ${facts.length} fact(s) unchecked`
    : `${rel}: ${facts.length} fact(s), ${checked.length} source(s) checked, ${misses} not found`
      + (unchecked.length ? `, ${unchecked.length} source(s) unchecked` : '');
  return { note: rel, findings, facts, sources, checked, unchecked, misses, status, summary };
}

/** Fetch every URL the notes cite, once. Without --fetch nothing is fetched and all URLs are unchecked. */
async function fetchSources(notes, opts) {
  const fetched = new Map();
  if (!opts.fetch) return fetched;
  const refs = new Set();
  for (const n of notes) {
    const lines = stripFrontMatter(fs.readFileSync(n, 'utf8').split(/\r?\n/));
    for (const s of citedSources(lines).sources) if (s.url) refs.add(s.ref);
  }
  for (const ref of refs) {
    try {
      const res = await fetch(ref, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { fetched.set(ref, { ok: false, why: `HTTP ${res.status}` }); continue; }
      fetched.set(ref, { ok: true, text: await res.text() });
    } catch (e) {
      fetched.set(ref, { ok: false, why: `fetch failed: ${e.message}` });
    }
  }
  return fetched;
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const notes = argv.filter((a) => !a.startsWith('--'));
  if (notes.length === 0) {
    console.error('usage: node tools/check-evidence.js <note.md> [...] [--all-numbers] [--fetch] [--json]');
    return 2;
  }
  for (const n of notes) {
    if (!fs.existsSync(n)) { console.error(`check-evidence: cannot read ${n}`); return 2; }
  }
  const opts = { allNumbers: flags.has('--all-numbers'), fetch: flags.has('--fetch') };
  opts.fetched = await fetchSources(notes, opts);

  const results = [];
  for (const n of notes) {
    try {
      results.push(checkNote(n, opts));
    } catch (e) {
      console.error(`check-evidence: cannot check ${n}: ${e.message}`);
      return 2;
    }
  }
  if (flags.has('--json')) {
    process.stdout.write(JSON.stringify(results.map((r) => ({
      note: r.note, status: r.status, misses: r.misses, facts: r.facts.length,
      sources: r.sources.map((s) => s.ref),
      unchecked: r.unchecked.map((u) => ({ ref: u.ref, why: u.why })),
      findings: r.findings,
    })), null, 2) + '\n');
  } else {
    for (const r of results) {
      for (const f of r.findings) process.stdout.write(`${r.note}:${f.line} ${f.text}\n`);
      process.stdout.write(`${r.summary}\n`);
    }
  }
  if (results.some((r) => r.status === 'miss')) return 1;
  if (results.some((r) => r.status === 'unchecked')) return 3;
  return 0;
}

module.exports = {
  checkNote, extractFacts, citedSources, stripFrontMatter, factInSource, prose, main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => { console.error('check-evidence: ' + e.message); process.exit(2); },
  );
}
