#!/usr/bin/env node
/**
 * Write the three copies of the AAC design tokens from their one source,
 * `aac-skills/aac-design/assets/aac-tokens.json` (issue 1091, PRD issue 1079):
 *
 *   - the Tokens section of `DESIGN-SYSTEM.md` (between its GENERATED TOKENS markers);
 *   - the token block of `scripts/build_form.py` (between its GENERATED TOKENS markers);
 *   - `assets/aac-tokens.css`, the whole file.
 *
 *   node tools/build-design-tokens.js            # rewrite the three copies
 *   node tools/build-design-tokens.js --check    # exit 1 if any copy differs from a fresh generation
 *
 * Why: the draft kept the tokens three times by hand and told the editor to "change it in both
 * places or neither". Here a value is typed once; contrast ratios, half-points, twips and pixels
 * are computed from it. Output is a pure function of the source and the hand-written text outside
 * the markers: no clock, fixed order, so two runs are identical.
 * `tools/design-tokens.test.js` shows the check fires on a mutation of each copy.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'aac-skills', 'aac-design');
const SOURCE = path.join(SKILL_DIR, 'assets', 'aac-tokens.json');
const DESIGN_SYSTEM = path.join(SKILL_DIR, 'DESIGN-SYSTEM.md');
const BUILD_FORM = path.join(SKILL_DIR, 'scripts', 'build_form.py');
const CSS = path.join(SKILL_DIR, 'assets', 'aac-tokens.css');
const TARGETS = [DESIGN_SYSTEM, BUILD_FORM, CSS];

const MD_MARKERS = [
  '<!-- BEGIN GENERATED TOKENS: tools/build-design-tokens.js writes this section from assets/aac-tokens.json. Never hand-edit. -->',
  '<!-- END GENERATED TOKENS -->',
];
const PY_MARKERS = [
  '# ---- BEGIN GENERATED TOKENS: tools/build-design-tokens.js writes this block from assets/aac-tokens.json. Never hand-edit. ----',
  '# ---- END GENERATED TOKENS ----',
];

// ----------------------------------------------------------------------------- helpers
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
const word = (n) => WORDS[n] || String(n);
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const num = (n) => String(Number(n.toFixed(4)));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** "two em spaces", "an en space". */
const spaces = (n, kind) => `${n === 1 ? 'an' : word(n)} ${kind} space${n === 1 ? '' : 's'}`;
const listAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function luminance(hex) {
  const c = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG 2 contrast ratio of two hex colors, to two places, as the designlint --contrast prints it. */
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
}

function validate(src) {
  const hex = /^[0-9A-F]{6}$/;
  const colors = src.color || [];
  const bad = [];
  if (!hex.test(src.paper || '')) bad.push('paper is not a six-digit upper-case hex color');
  for (const c of colors) if (!hex.test(c.hex || '')) bad.push(`color ${c.token}: hex is not six upper-case hex digits`);
  for (const c of (src.web && src.web.dark) || []) if (!hex.test(c.hex || '')) bad.push(`web.dark ${c.token}: hex is not six upper-case hex digits`);
  const steps = new Set((src.spacing || []).map((s) => s.token));
  for (const [k, v] of Object.entries(src.padding || {})) for (const s of v) if (!steps.has(s)) bad.push(`padding.${k} names no spacing step ${s}`);
  if (bad.length) throw new Error(`${path.relative(ROOT, SOURCE)}: ${bad.join('; ')}`);
}

/** The hex for a contrast reference: "white" is the paper, anything else a color token. */
function colorOf(src, name) {
  if (name === 'white') return src.paper;
  const c = src.color.find((x) => x.token === name);
  if (!c) throw new Error(`contrast names no color ${name}`);
  return c.hex;
}
function contrastText(src, c) {
  if (!c.contrast.length) return 'n/a';
  return c.contrast.map((k) => {
    if (k.of) {
      const fg = src.color.find((x) => x.token === k.of);
      return `${cap(fg.name || `#${fg.hex}`)} on ${c.token} ${contrast(fg.hex, c.hex)}:1`;
    }
    return `${contrast(c.hex, colorOf(src, k.on))}:1 on ${k.on}${k.note ? ` (${k.note})` : ''}`;
  }).join(', ');
}
const usableTwips = (p) => Math.round((p.width_in - 2 * p.margin_in) * 1440);

// ----------------------------------------------------------------------------- the three copies
function renderMarkdown(src) {
  const p = src.page;
  const twips = usableTwips(p);
  const o = [];
  o.push('### Color', '', '| Token | Value | Use | Contrast (`designlint.py --contrast`) | Source |', '|---|---|---|---|---|');
  for (const c of src.color) {
    const value = (c.name || `#${c.hex}`) + (c.width_pt ? `, ${num(c.width_pt)} pt` : '');
    o.push(`| \`${c.token}\` | ${value} | ${c.use} | ${contrastText(src, c)} | ${c.source} |`);
  }
  o.push('', src.color_rule, '', '### Type', '',
    `${src.font}, named on every run and in the document defaults (never through the theme alone; designlint D18). Checkboxes are FORMCHECKBOX fields.`,
    '', '| Token | Size | Weight and color | Use |', '|---|---|---|---|');
  for (const t of src.type) o.push(`| \`${t.token}\` | ${num(t.pt)} pt | ${t.style} | ${t.use} |`);
  o.push('', `Floor: ${num(src.floor_pt.paper)} pt on paper, ${num(src.floor_pt.slides)} pt on slides (designlint D07).`,
    '', '### Spacing scale (points)', '', '| Step | pt | Used for |', '|---|---|---|');
  for (const s of src.spacing) o.push(`| \`${s.token}\` | ${num(s.pt)} | ${s.use} |`);
  const [gap, sep] = [src.choice_gap_em, src.step_sep_en];
  o.push('', `Other constants: terms line spacing ${num(src.line_terms)}; ${spaces(gap, 'em')} between checkbox options; `
    + `${spaces(sep, 'en')} between a step number and its role; `
    + `cell padding ${listAnd(src.padding.cell)} (top, sides, bottom); card padding ${listAnd(src.padding.card)}.`,
  '', '### Page and grid', '',
  `${p.name}, ${num(p.margin_in)} in margins (${p.margin_source}), ${thousands(twips)} twips usable, a ${p.grid}-column grid of ${thousands(twips / p.grid)} twips. The HR card takes ${p.hr_label_span} of the ${p.grid} columns.`);
  return o.join('\n');
}

function renderPython(src) {
  const p = src.page;
  const col = (s, w) => s.padEnd(w);
  const o = [
    '# The executable copy of DESIGN-SYSTEM.md "Tokens": change assets/aac-tokens.json, then run the generator.',
    'T = {',
    '    # color',
    `    ${src.color.map((c) => `'${c.token}': '${c.hex}'`).join(', ')},`,
  ];
  const border = src.color.find((c) => c.token === 'border');
  o.push(`    ${col(`'border_sz': ${Math.round(border.width_pt * 8)},`, 20)}# ${num(border.width_pt)} pt cell border, in eighths of a point (Word's unit)`,
    `    'font': '${src.font}',`,
    "    # type, in half-points (Word's unit): AAC-WR-001 Rule 77, including its fill-in form clause (v0.11)");
  for (const t of src.type) {
    o.push(`    ${col(`'sz_${t.token}': ${Math.round(t.pt * 2)},`, 20)}# ${num(t.pt)} pt, ${t.style}: ${t.use}`);
  }
  o.push('    # grid', `    'page_w': ${usableTwips(p)}, 'grid': ${p.grid}, 'hr_label_span': ${p.hr_label_span},`, '}',
    '# spacing scale, in points; every vertical or inner space the builder uses comes from here', 'S = {');
  for (const s of src.spacing) o.push(`    ${col(`'${s.token}': ${num(s.pt)},`, 24)}# ${s.use}`);
  const esc = (cp, n) => `'${`\\u${cp}`.repeat(n)}'`;
  o.push('}',
    `LINE_TERMS = ${Math.round(src.line_terms * 240)}  # ${num(src.line_terms)} line spacing for multi-line terms (240 = single)`,
    `CHOICE_GAP = ${esc('2003', src.choice_gap_em)}  # ${spaces(src.choice_gap_em, 'em')} between checkbox options`,
    `STEP_SEP = ${esc('2002', src.step_sep_en)}  # ${spaces(src.step_sep_en, 'en')} between a step number and its role`,
    `CELL_PAD = (${src.padding.cell.map((s) => `'${s}'`).join(', ')})  # top, sides, bottom`,
    `CARD_PAD = (${src.padding.card.map((s) => `'${s}'`).join(', ')})  # top, sides, bottom`);
  return o.join('\n');
}

function renderCss(src) {
  const px = (pt) => `${num(Number((pt * 4 / 3).toFixed(2)))}px`;
  const decl = (name, value, note) => {
    const d = `  --aac-${name}: ${value};`;
    return note ? `${d.padEnd(32)}/* ${note} */` : d;
  };
  const quote = (f) => (/^(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/.test(f) ? f : `"${f}"`);
  const body = src.type.find((t) => t.token === 'body');
  const o = [
    '/* AAC design tokens for HTML artifacts and pages. GENERATED by tools/build-design-tokens.js from',
    '   assets/aac-tokens.json (issue 1091); never hand-edit. Import or inline this block, then build only',
    '   from these variables. */',
    ':root {',
    '  /* color */',
  ];
  for (const c of src.color) {
    const white = c.contrast.filter((k) => k.on === 'white').map((k) => `${contrast(c.hex, src.paper)}:1 on white`);
    o.push(decl(c.token, `#${c.hex}`, [c.web_note, ...white].filter(Boolean).join('; ')));
  }
  o.push(decl('bg', `#${src.paper}`),
    `  /* type: ${src.font}, with metric-close fallbacks. Same roles as print, at screen sizes (${num(body.web_rem * 16)} px body floor). */`,
    decl('font', [src.font, ...src.web.font_fallbacks].map(quote).join(', ')));
  for (const t of src.type) o.push(decl(`size-${t.token}`, `${num(t.web_rem)}rem`, t.web_note));
  o.push('  /* spacing scale, in points converted at 1 pt = 1.333 px */');
  for (const s of src.spacing.filter((x) => x.web)) o.push(decl(`space-${s.token.replace(/_/g, '-')}`, px(s.pt)));
  const border = src.color.find((c) => c.token === 'border');
  o.push(decl('border-width', px(border.width_pt), `${num(border.width_pt)} pt`), '}');
  const dark = (indent) => src.web.dark.map((d) => indent + decl(d.token, `#${d.hex}`, d.note));
  o.push('@media (prefers-color-scheme: dark) {', '  :root:not([data-theme="light"]) {', ...dark('  '), '  }', '}',
    ':root[data-theme="dark"] {', ...dark(''), '}');
  return `${o.join('\n')}\n`;
}

/** Replace the text strictly between two marker lines. Throws when either marker is missing. */
function splice(text, [begin, end], region, file) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(nl);
  const b = lines.indexOf(begin);
  const e = lines.indexOf(end);
  if (b < 0 || e < b) throw new Error(`${path.relative(ROOT, file)} has no ${begin.slice(0, 40)}... / ${end} marker pair`);
  return [...lines.slice(0, b + 1), ...region.split('\n'), ...lines.slice(e)].join(nl);
}

/** The three copies as the generator writes them: { path: text }. `current` maps path to text. */
function outputs(src, current) {
  validate(src);
  return {
    [DESIGN_SYSTEM]: splice(current[DESIGN_SYSTEM], MD_MARKERS, renderMarkdown(src), DESIGN_SYSTEM),
    [BUILD_FORM]: splice(current[BUILD_FORM], PY_MARKERS, renderPython(src), BUILD_FORM),
    [CSS]: renderCss(src),
  };
}

/** Which copies differ from a fresh generation. */
function stale(fresh, current) {
  return Object.keys(fresh).filter((p) => current[p] !== fresh[p]);
}

function readSource() { return JSON.parse(fs.readFileSync(SOURCE, 'utf8')); }
function readCurrent() {
  const out = {};
  for (const p of TARGETS) out[p] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  return out;
}

// ----------------------------------------------------------------------------- CLI
function main(argv) {
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  const current = readCurrent();
  let fresh;
  try { fresh = outputs(readSource(), current); } catch (e) {
    process.stderr.write(`build-design-tokens: ${e.message}\n`);
    return 1;
  }
  if (argv.includes('--check')) {
    const bad = stale(fresh, current);
    if (bad.length) {
      process.stderr.write(`${bad.map(rel).join(', ')} ${bad.length > 1 ? 'differ' : 'differs'} from a fresh generation. Run: node tools/build-design-tokens.js\n`);
      return 1;
    }
    process.stdout.write(`${TARGETS.map(rel).join(', ')} are current\n`);
    return 0;
  }
  for (const [p, text] of Object.entries(fresh)) {
    if (current[p] === text) continue;
    fs.writeFileSync(p, text);
    process.stdout.write(`wrote ${rel(p)}\n`);
  }
  return 0;
}

module.exports = { SOURCE, TARGETS, DESIGN_SYSTEM, BUILD_FORM, CSS, MD_MARKERS, PY_MARKERS, contrast, readSource, readCurrent, outputs, stale };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
