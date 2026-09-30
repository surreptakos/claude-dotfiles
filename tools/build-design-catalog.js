#!/usr/bin/env node
/**
 * Generate `aac-skills/aac-design/catalog/CATALOG.json`, the numbered design rule catalog, and its
 * view `aac-skills/aac-design/TELLS.md`, from the vendored source skills under
 * `aac-skills/aac-design/vendor/` and the AAC house sources (issues 1083 and 1085, PRD issue 1079).
 *
 *   node tools/build-design-catalog.js            # write CATALOG.json and TELLS.md
 *   node tools/build-design-catalog.js --check    # exit 1 if either is stale or coverage fails
 *
 * Why: TELLS.md was a hand-written condensation of three skills with no source lines, and a
 * summarising subagent missed impeccable's side-stripe rule on 2026-09-30 because it read a
 * summary, not the source. Here every row carries the rule's own words and the file and line they
 * sit on, so a verdict traces to the source and a new upstream rule cannot be skipped silently.
 * TELLS.md is now generated from the rows, so it cannot drift from them either.
 *
 * Inputs:
 *   - per source in vendor/PROVENANCE.json, the vendored folder, byte for byte at the pinned
 *     commit (never edited here), and catalog/<skill>.checks.json, hand-edited: a stable id per
 *     rule, the rule's words (matched exactly against the vendored list item), the surfaces it
 *     applies to and how it is checked;
 *   - catalog/aac.checks.json, hand-edited: the house rows, AAC-WR-001 Rules 75 to 102 by number
 *     and the tokens in DESIGN-SYSTEM.md's Tokens tables by name. A house row cites its rule and
 *     never restates it; the file and line are found here;
 *   - catalog/conflicts.json, hand-edited: pairs of rows that cannot both hold. The winner and the
 *     reason come from the precedence field, never from the entry.
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
const TELLS = path.join(SKILL_DIR, 'TELLS.md');
const HOUSE_CHECKS = path.join(CATALOG_DIR, 'aac.checks.json');
const CONFLICTS = path.join(CATALOG_DIR, 'conflicts.json');
const DESIGNLINT = path.join(SKILL_DIR, 'scripts', 'designlint.py');
const DESIGN_SYSTEM = path.join(SKILL_DIR, 'DESIGN-SYSTEM.md');
const WR001_DIR = path.join(ROOT, 'aac-skills', 'aac-house-writing-standard', 'references');

const SURFACES = ['web', 'document', 'deck', 'form', 'dashboard'];
const SURFACE_TITLES = { web: 'Web pages and HTML artifacts', document: 'Documents', deck: 'Decks', form: 'Forms', dashboard: 'Dashboards' };

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

/** The house sources. Rows cite them by rule number or token name (issue 1085). */
const WR001 = 'AAC-WR-001';
const TOKENS = 'AAC tokens';
const WR001_RULES = [75, 102];
const HOUSE = [
  { skill: TOKENS, tier_source: 'AAC tokens (assets/aac-tokens.css, DESIGN-SYSTEM.md)', file: 'DESIGN-SYSTEM.md', covers: 'every token in the Tokens tables' },
  { skill: WR001, tier_source: 'AAC-WR-001', file: '../aac-house-writing-standard/references/', covers: `Rules ${WR001_RULES[0]} to ${WR001_RULES[1]}` },
];
/** Reviewers for the house rows: the design critique (CRITIQUE.md Assessment A) and the standard. */
const HOUSE_REVIEWERS = ['aac-design', 'aac-house-writing-standard'];

/** Dan, 2026-09-30: AAC tokens and AAC-WR-001 first, then the design skills, then the brief.
 *  The design-skills tier lists the vendored sources, so a new source joins it by provenance. */
const PRECEDENCE_RULED = 'Dan, 2026-09-30 (issue 1079)';
function precedence(skills) {
  return [
    { rank: 1, tier: 'house', sources: HOUSE.map((h) => h.tier_source) },
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

/** AAC-WR-001's numbered rules: [{ rule, title, file, line }] from the `## N. Title` headings. */
function wr001Rules(files) {
  const out = [];
  for (const [name, text] of Object.entries(files)) {
    String(text).replace(/\r\n/g, '\n').split('\n').forEach((l, n) => {
      const m = /^## (\d+)\. (.*\S)\s*$/.exec(l);
      if (m) out.push({ rule: Number(m[1]), title: m[2], file: `../aac-house-writing-standard/references/${name}`, line: n + 1 });
    });
  }
  return out;
}

/** The tokens in DESIGN-SYSTEM.md's Tokens section: [{ table, token, line }]. */
function designTokens(text) {
  const out = [];
  let inTokens = false;
  let table = null;
  String(text).replace(/\r\n/g, '\n').split('\n').forEach((l, n) => {
    if (/^## /.test(l)) { inTokens = /^## Tokens\s*$/.test(l); table = null; return; }
    if (!inTokens) return;
    const h = /^### (.*\S)\s*$/.exec(l);
    if (h) { table = h[1]; return; }
    const m = /^\| `([^`]+)` \|/.exec(l);
    if (m && table) out.push({ table, token: m[1], line: n + 1 });
  });
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
  const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const provenance = json(PROVENANCE);
  const vendored = {};
  const maps = {};
  for (const src of provenance.sources) {
    const dir = path.join(VENDOR, src.vendored);
    vendored[src.skill] = {};
    for (const rel of listFiles(dir)) vendored[src.skill][rel] = fs.readFileSync(path.join(dir, rel));
    maps[src.skill] = json(path.join(CATALOG_DIR, `${src.skill}.checks.json`));
  }
  const lint = fs.readFileSync(DESIGNLINT, 'utf8');
  const linter = [...lint.matchAll(/^\s+'([A-Z]\d{2})': \('(\w+)', '([^']*)'/gm)].map((m) => ({ id: m[1], severity: m[2], what: m[3] }));
  const wr001 = {};
  for (const name of fs.readdirSync(WR001_DIR).filter((f) => f.endsWith('.md')).sort()) {
    wr001[name] = fs.readFileSync(path.join(WR001_DIR, name), 'utf8');
  }
  return {
    provenance, vendored, maps,
    detectors: linter.map((l) => l.id), linter,
    house: json(HOUSE_CHECKS), wr001, designSystem: fs.readFileSync(DESIGN_SYSTEM, 'utf8'),
    conflicts: json(CONFLICTS),
  };
}

function vendoredRules(inputs, src) {
  const out = [];
  for (const [rel, buf] of Object.entries(inputs.vendored[src.skill])) {
    if (!rel.endsWith('.md')) continue;
    for (const r of extractRules(buf.toString('utf8'))) out.push({ file: `vendor/${src.vendored}/${rel}`, ...r });
  }
  return out;
}

const inRange = (n) => n >= WR001_RULES[0] && n <= WR001_RULES[1];

// ----------------------------------------------------------------------------- build
function countLine(rows) {
  const bySkill = {};
  for (const r of rows) bySkill[r.skill] = (bySkill[r.skill] || 0) + 1;
  const kind = (k) => rows.filter((r) => (r.checks || []).some((c) => k in c)).length;
  const skills = Object.entries(bySkill).map(([s, n]) => `${s} ${n}`).join(', ');
  return `Rules ${rows.length} (${skills}). Checked by detector ${kind('detector')}, adapter ${kind('adapter')}, reviewer ${kind('reviewer')}.`;
}

/** The house rows, cited by rule number or token name. Pushes a sentence to errors per mismatch. */
function houseRows(inputs, errors) {
  const rows = [];
  const rules = wr001Rules(inputs.wr001);
  const tokens = designTokens(inputs.designSystem);
  const wr = inputs.house.wr001 || [];
  const tk = inputs.house.tokens || [];
  for (const e of wr) {
    const r = rules.find((x) => x.rule === e.rule);
    if (!r || !inRange(e.rule)) { errors.push(`${e.id}: AAC-WR-001 has no Rule ${e.rule} in ${WR001_RULES.join(' to ')}`); continue; }
    rows.push({ id: e.id, skill: WR001, file: r.file, line: r.line, section: r.title,
      cites: `Rule ${e.rule}`, surfaces: e.surfaces, checks: e.checks });
  }
  for (const r of rules.filter((x) => inRange(x.rule))) {
    if (!wr.some((e) => e.rule === r.rule)) errors.push(`AAC-WR-001 Rule ${r.rule} has no entry in catalog/aac.checks.json`);
  }
  for (const e of tk) {
    const t = tokens.find((x) => x.table === e.table && x.token === e.token);
    if (!t) { errors.push(`${e.id}: DESIGN-SYSTEM.md has no token \`${e.token}\` in its ${e.table} table`); continue; }
    rows.push({ id: e.id, skill: TOKENS, file: 'DESIGN-SYSTEM.md', line: t.line, section: `Tokens > ${t.table}`,
      cites: `token \`${e.token}\``, surfaces: e.surfaces, checks: e.checks });
  }
  for (const t of tokens) {
    if (!tk.some((e) => e.table === t.table && e.token === t.token)) errors.push(`DESIGN-SYSTEM.md token \`${t.token}\` (${t.table}) has no entry in catalog/aac.checks.json`);
  }
  return rows;
}

/** Rank of the tier a row's source sits in: 1 house, 2 design skills. */
function rankOf(skill) {
  return HOUSE.some((h) => h.skill === skill) ? 1 : 2;
}

/** The conflicts with their winner and reason, derived from precedence. */
function resolveConflicts(entries, rows, errors) {
  const out = [];
  const tierName = { 1: 'house', 2: 'design-skills' };
  for (const c of entries) {
    const pair = (c.rows || []).map((id) => rows.find((r) => r.id === id));
    if (pair.length !== 2 || pair.some((r) => !r)) { errors.push(`${c.id}: names rows that are not in the catalog: ${(c.rows || []).join(', ')}`); continue; }
    const [a, b] = pair;
    if (a.skill === b.skill) { errors.push(`${c.id}: both rows come from ${a.skill}; a conflict is between two sources`); continue; }
    let win;
    let lose;
    let reason;
    if (rankOf(a.skill) !== rankOf(b.skill)) {
      [win, lose] = rankOf(a.skill) < rankOf(b.skill) ? [a, b] : [b, a];
      reason = `${win.skill} is rank ${rankOf(win.skill)} (${tierName[rankOf(win.skill)]}) and ${lose.skill} is rank ${rankOf(lose.skill)} (${tierName[rankOf(lose.skill)]}) in the precedence field, ruled by ${PRECEDENCE_RULED}.`;
    } else if (c.ruling && c.ruling.winner && c.ruling.by && c.ruling.reason && c.rows.includes(c.ruling.winner)) {
      [win, lose] = c.ruling.winner === a.id ? [a, b] : [b, a];
      reason = `Both are rank ${rankOf(a.skill)}, so precedence does not decide; ruled by ${c.ruling.by}: ${c.ruling.reason}`;
    } else {
      errors.push(`${c.id}: ${a.skill} and ${b.skill} share a precedence tier; the entry needs a ruling { winner, by, reason }`);
      continue;
    }
    out.push({ id: c.id, topic: c.topic, rows: c.rows, winner: win.id, winner_source: win.skill, loser: lose.id, loser_source: lose.skill, reason });
  }
  return out;
}

/** Pure: inputs in, catalog object out. Throws when a source and its checks file disagree. */
function build(inputs) {
  const errors = [];
  const rows = houseRows(inputs, errors);
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
  const skills = inputs.provenance.sources.map((s) => s.skill);
  const order = [WR001, TOKENS, ...skills];
  rows.sort((a, b) => order.indexOf(a.skill) - order.indexOf(b.skill) || a.file.localeCompare(b.file) || a.line - b.line);
  const conflicts = resolveConflicts(inputs.conflicts.conflicts || [], rows, errors);
  if (errors.length) throw new Error(errors.join('\n'));
  return {
    generated: 'GENERATED by tools/build-design-catalog.js from vendor/, DESIGN-SYSTEM.md, AAC-WR-001 and catalog/*.json. Never hand-edit.',
    precedence: precedence(skills),
    precedence_ruled: PRECEDENCE_RULED,
    rule_definition: RULE_DEFINITION,
    surfaces: SURFACES,
    measures: MEASURES,
    house: HOUSE.map((h) => ({ skill: h.skill, file: h.file, covers: h.covers })),
    sources: inputs.provenance.sources.map((s) => ({ skill: s.skill, repo: s.repo, path: s.path, commit: s.commit, vendored: `vendor/${s.vendored}` })),
    count_line: countLine(rows),
    conflicts,
    rows,
  };
}

/** Pretty JSON, except one line per row: 2,000 rows pretty-printed would double the payload. */
function render(catalog) {
  const { rows, ...head } = catalog;
  const top = JSON.stringify({ ...head, rows: [] }, null, 2);
  const body = rows.map((r) => `    ${JSON.stringify(r)}`).join(',\n');
  return `${top.slice(0, top.lastIndexOf('[]'))}[\n${body}\n  ]\n}\n`;
}

// ----------------------------------------------------------------------------- TELLS.md
/** TELLS.md: every row grouped by surface, carrying the linter rule ids. A view, never edited. */
function renderTells(catalog, linter) {
  const detectorsOf = (r) => r.checks.filter((c) => c.detector).map((c) => c.detector);
  const tag = (r) => (detectorsOf(r).length ? ` [${detectorsOf(r).join(', ')}]` : '');
  const say = (r) => {
    if (r.words !== undefined) return r.words;
    if (r.skill === TOKENS) return `DESIGN-SYSTEM.md ${r.cites} in the ${r.section.replace('Tokens > ', '')} table`;
    return `${r.skill} ${r.cites}, ${r.section}`;
  };
  const out = [];
  out.push('# Tells: the design rule catalog by surface', '');
  out.push('GENERATED by `tools/build-design-catalog.js` from `catalog/CATALOG.json` (issue 1085). Never hand-edit: change a `catalog/*.checks.json` file or re-vendor a source, then run `node tools/build-design-catalog.js`.', '');
  out.push('Every catalog rule sits under each surface it applies to, so a branch reads its own section in full. A bracketed id is the `designlint.py` rule that catches it; the adapter measures and reviewers that decide the rest are on the row in CATALOG.json, with the source file and line. House rows cite AAC-WR-001 by rule number and DESIGN-SYSTEM.md by token and never restate them: read the cited rule.', '');
  out.push(catalog.count_line, '');
  out.push('## Precedence', '');
  for (const t of catalog.precedence) out.push(`${t.rank}. **${t.tier}:** ${t.sources.join('; ')}.`);
  out.push('', `Ruled by ${catalog.precedence_ruled}. When two rules conflict, the lower rank number wins.`, '');
  out.push('## Conflicts', '');
  for (const c of catalog.conflicts) {
    out.push(`- **${c.id}** ${c.topic} \`${c.winner}\` (${c.winner_source}) wins over \`${c.loser}\` (${c.loser_source}): ${c.reason}`);
  }
  out.push('', '## Linter rules', '', '| Rule | Severity | Catches |', '|---|---|---|');
  for (const l of [...linter].sort((a, b) => a.id.localeCompare(b.id))) out.push(`| ${l.id} | ${l.severity} | ${l.what} |`);
  const groups = [WR001, TOKENS, ...catalog.sources.map((s) => s.skill)];
  for (const s of SURFACES) {
    const rows = catalog.rows.filter((r) => r.surfaces.includes(s));
    out.push('', `## ${SURFACE_TITLES[s]} (${s}, ${rows.length} rules)`);
    for (const g of groups) {
      const mine = rows.filter((r) => r.skill === g);
      if (!mine.length) continue;
      out.push('', `### ${g}`, '');
      for (const r of mine) out.push(`- \`${r.id}\` ${say(r)}${tag(r)}`);
    }
  }
  return out.join('\n') + '\n';
}

// ----------------------------------------------------------------------------- coverage
/** Every way the catalog can disagree with its sources, as sentences. [] means it holds. */
function check(catalog, inputs) {
  const problems = [];
  const skills = inputs.provenance.sources.map((s) => s.skill);
  const houseSkills = HOUSE.map((h) => h.skill);

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
  // Engines and large data are fetched and hash-checked, never vendored.
  for (const f of inputs.provenance.fetched || []) {
    if (!skills.includes(f.skill)) problems.push(`fetched ${f.name} names no vendored source`);
    if (!f.url || !(f.blob || (f.sha256 && Object.keys(f.sha256).length))) problems.push(`fetched ${f.name} has no url and pinned hash`);
    if (f.path && inputs.vendored[f.skill] && f.path in inputs.vendored[f.skill]) problems.push(`fetched ${f.name} is vendored at ${f.path}; engines and data are fetched, never vendored`);
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
  const rules = wr001Rules(inputs.wr001);
  const tokens = designTokens(inputs.designSystem);
  for (const r of rows) {
    if (seen.has(r.id)) problems.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (houseSkills.includes(r.skill)) {
      const at = r.skill === WR001
        ? rules.find((x) => x.file === r.file && x.line === r.line && `Rule ${x.rule}` === r.cites)
        : tokens.find((x) => r.file === 'DESIGN-SYSTEM.md' && x.line === r.line && `token \`${x.token}\`` === r.cites);
      if (!at) problems.push(`${r.id} cites ${r.file}:${r.line}, which does not hold ${r.skill} ${r.cites}`);
      if ('words' in r) problems.push(`${r.id} restates ${r.skill}; a house row cites it and never carries its words`);
    } else if (!skills.includes(r.skill) || !r.file || !Number.isInteger(r.line)) {
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
      else if (c.reviewer && !skills.includes(c.reviewer) && !HOUSE_REVIEWERS.includes(c.reviewer)) problems.push(`${r.id} names reviewer ${c.reviewer}, which is not a vendored source or a house reviewer`);
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
  // Every AAC-WR-001 rule in range and every token has exactly one row.
  for (const x of rules.filter((y) => inRange(y.rule))) {
    const n = rows.filter((r) => r.skill === WR001 && r.cites === `Rule ${x.rule}`).length;
    if (n !== 1) problems.push(`AAC-WR-001 Rule ${x.rule} has ${n} rows, not 1`);
  }
  for (const t of tokens) {
    const n = rows.filter((r) => r.skill === TOKENS && r.line === t.line).length;
    if (n !== 1) problems.push(`token \`${t.token}\` (${t.table}) has ${n} rows, not 1`);
  }

  // A conflict names the winning source, and the winner and reason follow the precedence field.
  for (const c of catalog.conflicts || []) {
    const pair = (c.rows || []).map((id) => rows.find((r) => r.id === id));
    if (pair.length !== 2 || pair.some((r) => !r)) { problems.push(`${c.id} names rows that are not in the catalog`); continue; }
    const win = pair.find((r) => r.id === c.winner);
    if (!win || win.skill !== c.winner_source) { problems.push(`${c.id} does not name its winning row and source`); continue; }
    const other = pair.find((r) => r !== win);
    if (rankOf(win.skill) > rankOf(other.skill)) problems.push(`${c.id} names ${win.skill} the winner, but ${other.skill} ranks above it in the precedence field`);
    if (!c.reason || (!c.reason.includes('precedence'))) problems.push(`${c.id} gives no precedence reason`);
  }

  if (catalog.count_line !== countLine(rows)) problems.push(`count line is stale: "${catalog.count_line}", rows say "${countLine(rows)}"`);
  return problems;
}

/** The generated files as the generator would write them: { path: text }. */
function outputs(inputs) {
  const catalog = build(inputs);
  return { [TARGET]: render(catalog), [TELLS]: renderTells(catalog, inputs.linter) };
}

/** Which generated files differ from what the generator writes. `current` maps path to text. */
function stale(fresh, current) {
  return Object.keys(fresh).filter((p) => current[p] !== fresh[p]);
}

// ----------------------------------------------------------------------------- CLI
function main(argv) {
  const inputs = readInputs();
  let fresh;
  try { fresh = outputs(inputs); } catch (e) {
    process.stderr.write(`build-design-catalog: ${e.message}\n`);
    return 1;
  }
  const problems = check(JSON.parse(fresh[TARGET]), inputs);
  if (problems.length) {
    process.stderr.write(`build-design-catalog: ${problems.join('\n')}\n`);
    return 1;
  }
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  if (argv.includes('--check')) {
    const current = {};
    for (const p of Object.keys(fresh)) current[p] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const bad = stale(fresh, current);
    if (bad.length) {
      process.stderr.write(`${bad.map(rel).join(' and ')} ${bad.length > 1 ? 'are' : 'is'} stale. Run: node tools/build-design-catalog.js\n`);
      return 1;
    }
    process.stdout.write(`${Object.keys(fresh).map(rel).join(' and ')} are current\n`);
    return 0;
  }
  for (const [p, text] of Object.entries(fresh)) {
    fs.writeFileSync(p, text);
    process.stdout.write(`wrote ${rel(p)}\n`);
  }
  return 0;
}

module.exports = {
  SOURCE: PROVENANCE, TARGET, TELLS, SURFACES, MEASURES, WR001_RULES,
  extractRules, wr001Rules, designTokens, blobSha, readInputs, build, render, renderTells, check, countLine, outputs, stale,
};

if (require.main === module) process.exitCode = main(process.argv.slice(2));
