#!/usr/bin/env node
/**
 * Generate `aac-skills/aac-design/catalog/CATALOG.json`, the numbered design rule catalog, from the
 * vendored source skills under `aac-skills/aac-design/vendor/` (issue 1083, PRD issue 1079).
 *
 *   node tools/build-design-catalog.js            # write the catalog
 *   node tools/build-design-catalog.js --check    # exit 1 if it is stale or fails coverage
 *
 * Why: TELLS.md is a hand-written condensation of three skills with no source lines, and a
 * summarising subagent missed impeccable's side-stripe rule on 2026-09-30 because it read a
 * summary, not the source. Here every row carries the rule's own words and the file and line they
 * sit on, so a verdict traces to the source and a new upstream rule cannot be skipped silently.
 *
 * Inputs, per source in vendor/PROVENANCE.json:
 *   - the vendored folder, byte for byte at the pinned commit (never edited here);
 *   - catalog/<skill>.checks.json, hand-edited: a stable id per rule, the rule's words (matched
 *     exactly against the vendored list item), the surfaces it applies to and how it is checked.
 * A rule is a list item (bullet or numbered) outside YAML frontmatter and fenced blocks. Fenced
 * blocks in these skills are usage lines and report templates, not rules.
 *
 * Output is a pure function of the inputs: no clock, fixed key order, so two runs are identical.
 * `tools/design-catalog-coverage.test.js` holds the catalog to the same contract that
 * `tools/wr001-lint-coverage.test.js` holds wr001-coverage.md to.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILL_DIR = path.join(ROOT, 'aac-skills', 'aac-design');
const VENDOR = path.join(SKILL_DIR, 'vendor');
const PROVENANCE = path.join(VENDOR, 'PROVENANCE.json');
const CATALOG_DIR = path.join(SKILL_DIR, 'catalog');
const TARGET = path.join(CATALOG_DIR, 'CATALOG.json');
const DESIGNLINT = path.join(SKILL_DIR, 'scripts', 'designlint.py');

const SURFACES = ['web', 'document', 'deck', 'form', 'dashboard'];

/** Adapter measures a row may name. The adapters that produce them come later in PRD 1079; the
 *  names are fixed here so a row cannot cite a measure nobody will produce. */
const MEASURES = {
  'web.axe': 'axe-core results on the rendered page',
  'web.a11y-tree': "the browser's accessibility tree: names, roles, landmarks",
  'web.contrast': 'contrast of text and UI parts measured on computed styles',
  'web.keyboard-walk': 'a scripted Tab walk: order, visible focus, traps, unreachable controls, changes on focus',
  'web.target-size': 'rendered size of every interactive element',
  'web.zoom-200': 'the page rendered at 200% zoom: reflow, clipping, overlap',
};

/** Dan, 2026-09-30: AAC tokens and AAC-WR-001 first, then the design skills, then the brief.
 *  The design-skills tier lists the vendored sources, so a new source joins it by provenance. */
const PRECEDENCE_RULED = 'Dan, 2026-09-30 (issue 1079)';
function precedence(skills) {
  return [
    { rank: 1, tier: 'house', sources: ['AAC tokens (assets/aac-tokens.css, DESIGN-SYSTEM.md)', 'AAC-WR-001'] },
    { rank: 2, tier: 'design-skills', sources: skills },
    { rank: 3, tier: 'brief', sources: ['the brief'] },
  ];
}

const RULE_DEFINITION = 'A rule is a list item (bullet or numbered) in a vendored file, outside YAML frontmatter and fenced blocks.';
const CHECK_KINDS = ['detector', 'adapter', 'reviewer'];

// ----------------------------------------------------------------------------- extraction
/** Every rule in one vendored file: [{ line, words, section }], line 1-based. */
function extractRules(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let fence = null;
  let i = 0;
  if (lines[0] === '---') {
    i = lines.indexOf('---', 1) + 1;
    if (i === 0) throw new Error('unterminated frontmatter');
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) { fence = f[1]; continue; }
    const h = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (h) {
      headings.length = h[1].length - 1;
      headings[h[1].length - 1] = h[2];
      continue;
    }
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/.exec(line);
    if (m) out.push({ line: i + 1, words: m[1], section: headings.slice(1).filter(Boolean).join(' > ') });
  }
  return out;
}

/** git's blob sha for these bytes, so a vendored file can be compared with its upstream pin. */
function blobSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Everything the catalog is built from, read once. Tests mutate this object, never the tree. */
function readInputs() {
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE, 'utf8'));
  const vendored = {};
  const maps = {};
  for (const src of provenance.sources) {
    const dir = path.join(VENDOR, src.vendored);
    vendored[src.skill] = {};
    for (const rel of listFiles(dir)) vendored[src.skill][rel] = fs.readFileSync(path.join(dir, rel));
    maps[src.skill] = JSON.parse(fs.readFileSync(path.join(CATALOG_DIR, `${src.skill}.checks.json`), 'utf8'));
  }
  const detectors = [...fs.readFileSync(DESIGNLINT, 'utf8').matchAll(/^\s+'([A-Z]\d{2})': \(/gm)].map((m) => m[1]);
  return { provenance, vendored, maps, detectors };
}

function vendoredRules(inputs, src) {
  const out = [];
  for (const [rel, buf] of Object.entries(inputs.vendored[src.skill])) {
    if (!rel.endsWith('.md')) continue;
    for (const r of extractRules(buf.toString('utf8'))) out.push({ file: `vendor/${src.vendored}/${rel}`, ...r });
  }
  return out;
}

// ----------------------------------------------------------------------------- build
function countLine(rows) {
  const bySkill = {};
  for (const r of rows) bySkill[r.skill] = (bySkill[r.skill] || 0) + 1;
  const kind = (k) => rows.filter((r) => (r.checks || []).some((c) => k in c)).length;
  const skills = Object.entries(bySkill).map(([s, n]) => `${s} ${n}`).join(', ');
  return `Rules ${rows.length} (${skills}). Checked by detector ${kind('detector')}, adapter ${kind('adapter')}, reviewer ${kind('reviewer')}.`;
}

/** Pure: inputs in, catalog object out. Throws when the vendored text and the checks file disagree. */
function build(inputs) {
  const rows = [];
  const errors = [];
  for (const src of inputs.provenance.sources) {
    const found = vendoredRules(inputs, src);
    const claimed = new Set();
    for (const entry of inputs.maps[src.skill].rules) {
      const idx = found.findIndex((r, n) => !claimed.has(n) && r.words === entry.words);
      if (idx === -1) { errors.push(`${entry.id}: no vendored ${src.skill} rule reads "${entry.words}"`); continue; }
      claimed.add(idx);
      const r = found[idx];
      rows.push({ id: entry.id, skill: src.skill, file: r.file, line: r.line, section: r.section,
        words: r.words, surfaces: entry.surfaces, checks: entry.checks });
    }
    found.forEach((r, n) => {
      if (!claimed.has(n)) errors.push(`${src.skill} ${r.file}:${r.line} has no entry in catalog/${src.skill}.checks.json: "${r.words}"`);
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const skills = inputs.provenance.sources.map((s) => s.skill);
  rows.sort((a, b) => skills.indexOf(a.skill) - skills.indexOf(b.skill) || a.file.localeCompare(b.file) || a.line - b.line);
  return {
    generated: 'GENERATED by tools/build-design-catalog.js from vendor/ and catalog/*.checks.json. Never hand-edit.',
    precedence: precedence(skills),
    precedence_ruled: PRECEDENCE_RULED,
    rule_definition: RULE_DEFINITION,
    surfaces: SURFACES,
    measures: MEASURES,
    sources: inputs.provenance.sources.map((s) => ({ skill: s.skill, repo: s.repo, path: s.path, commit: s.commit, vendored: `vendor/${s.vendored}` })),
    count_line: countLine(rows),
    rows,
  };
}

function render(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n';
}

// ----------------------------------------------------------------------------- coverage
/** Every way the catalog can disagree with its sources, as sentences. [] means it holds. */
function check(catalog, inputs) {
  const problems = [];
  const skills = inputs.provenance.sources.map((s) => s.skill);

  // Provenance: the vendored folder is byte for byte the pinned upstream folder.
  for (const src of inputs.provenance.sources) {
    const have = inputs.vendored[src.skill] || {};
    for (const [rel, sha] of Object.entries(src.files)) {
      if (!have[rel]) problems.push(`${src.skill}: vendored ${rel} is missing`);
      else if (blobSha(have[rel]) !== sha) problems.push(`${src.skill}: vendored ${rel} is not blob ${sha} at ${src.repo}@${src.commit}`);
    }
    for (const rel of Object.keys(have)) {
      if (!(rel in src.files)) problems.push(`${src.skill}: vendored ${rel} is not in PROVENANCE.json`);
    }
  }

  // Precedence is a field: house, then the design skills, then the brief.
  const p = catalog.precedence;
  if (!Array.isArray(p) || p.map((t) => t.tier).join(',') !== 'house,design-skills,brief'
      || p.some((t, n) => t.rank !== n + 1)) {
    problems.push('precedence is not the field [house, design-skills, brief] ranked 1 to 3');
  } else if (JSON.stringify(p[1].sources) !== JSON.stringify(skills)) {
    problems.push('the design-skills tier does not list exactly the vendored sources');
  }

  const rows = Array.isArray(catalog.rows) ? catalog.rows : [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!skills.includes(r.skill) || !r.file || !Number.isInteger(r.line)) {
      problems.push(`${r.id} does not cite a vendored skill, file and line`);
    } else {
      const src = inputs.provenance.sources.find((s) => s.skill === r.skill);
      const rel = r.file.replace(`vendor/${src.vendored}/`, '');
      const buf = inputs.vendored[r.skill][rel];
      const at = buf && extractRules(buf.toString('utf8')).find((x) => x.line === r.line);
      if (!at || at.words !== r.words) problems.push(`${r.id} cites ${r.file}:${r.line}, which does not read "${r.words}"`);
    }
    if (!Array.isArray(r.surfaces) || !r.surfaces.length || r.surfaces.some((s) => !SURFACES.includes(s))) {
      problems.push(`${r.id} names no surface, or one outside ${SURFACES.join(', ')}`);
    }
    if (!Array.isArray(r.checks) || !r.checks.length) { problems.push(`${r.id} has no check`); continue; }
    for (const c of r.checks) {
      const keys = Object.keys(c);
      if (keys.length !== 1 || !CHECK_KINDS.includes(keys[0])) problems.push(`${r.id} has a check that is not one of ${CHECK_KINDS.join(', ')}`);
      else if (c.detector && !inputs.detectors.includes(c.detector)) problems.push(`${r.id} names detector ${c.detector}, which designlint.py does not define`);
      else if (c.adapter && !(c.adapter in MEASURES)) problems.push(`${r.id} names adapter measure ${c.adapter}, which is not declared`);
      else if (c.reviewer && !skills.includes(c.reviewer)) problems.push(`${r.id} names reviewer ${c.reviewer}, which is not a vendored source`);
    }
  }

  // Every vendored rule has a row.
  for (const src of inputs.provenance.sources) {
    for (const v of vendoredRules(inputs, src)) {
      if (!rows.some((r) => r.skill === src.skill && r.file === v.file && r.line === v.line && r.words === v.words)) {
        problems.push(`vendored rule ${src.skill} ${v.file}:${v.line} has no row: "${v.words}"`);
      }
    }
  }

  if (catalog.count_line !== countLine(rows)) problems.push(`count line is stale: "${catalog.count_line}", rows say "${countLine(rows)}"`);
  return problems;
}

// ----------------------------------------------------------------------------- CLI
function main(argv) {
  const inputs = readInputs();
  let text;
  try { text = render(build(inputs)); } catch (e) {
    process.stderr.write(`build-design-catalog: ${e.message}\n`);
    return 1;
  }
  const problems = check(JSON.parse(text), inputs);
  if (problems.length) {
    process.stderr.write(`build-design-catalog: ${problems.join('\n')}\n`);
    return 1;
  }
  const rel = path.relative(ROOT, TARGET).split(path.sep).join('/');
  if (argv.includes('--check')) {
    const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
    if (current !== text) {
      process.stderr.write(`${rel} is stale. Run: node tools/build-design-catalog.js\n`);
      return 1;
    }
    process.stdout.write(`${rel} is current\n`);
    return 0;
  }
  fs.writeFileSync(TARGET, text);
  process.stdout.write(`wrote ${rel}\n`);
  return 0;
}

module.exports = { SOURCE: PROVENANCE, TARGET, SURFACES, MEASURES, extractRules, blobSha, readInputs, build, render, check, countLine };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
