#!/usr/bin/env node
/**
 * node --test tools/claude-md-lint.test.js
 *
 * One case per paradigm row: each "exclude" item in the CLAUDE.md guidance has a rule, each
 * rule has a positive fixture (fires) and the good file fires nothing. Also covers the rules
 * borrowed from the bundled /doctor skill (guessable commands against package.json scripts,
 * tech-stack sections, formatter-enforced style rules, lazy-load candidates, directory trees,
 * the keep-always guard for prohibitions, the cross-file duplicate check), the suppression
 * comments, the fenced-code exemption, and the CLI exit codes.
 */
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { lint, repoContext, DEFAULTS, RULES } = require('./claude-md-lint.js');
const CLI = path.join(__dirname, 'claude-md-lint.js');

const rules = (text, opts) => lint(text, opts).findings.map((f) => f.rule);
const MANIFEST = { scripts: { dev: 'vite', test: 'vitest', 'db:reset': 'x' }, dependencies: ['react', 'vite', 'zod', '@types/node', 'vitest'] };

const GOOD = `# my-service

## Commands
\`\`\`bash
npm run dev          # starts on :4000, needs DATABASE_URL
npm test -- --runInBand   # parallel runs deadlock the test DB
\`\`\`

## Etiquette
- Branch names: \`feat/<ticket>-slug\`. PR title starts with the ticket number.
- Never push to \`main\`; CI deploys it.

## Gotchas
- \`.env.local\` wins over \`.env\`; a stale local file explains most "works on CI only" bugs.
- Migrations run in lexical order, so prefix with a timestamp.
`;

test('good CLAUDE.md is clean, with and without repo context', () => {
  const { findings, stats } = lint(GOOD);
  assert.deepEqual(findings, []);
  assert.equal(stats.fencedBlocks, 1);
  assert.ok(stats.proseWords > 0);
  assert.equal(stats.estTokens, Math.round(GOOD.length / 4));
  assert.deepEqual(lint(GOOD, { manifest: MANIFEST, formatterConfigs: ['.prettierrc'] }).findings, []);
});

test('size: over the line budget', () => {
  const text = Array.from({ length: 30 }, (_, i) => `- rule number ${i} about thing ${i}`).join('\n');
  assert.ok(rules(text, { maxLines: 10 }).includes('size'));
  assert.ok(!rules(text, { maxLines: 100 }).includes('size'));
});

test('size: over the word budget, fences excluded', () => {
  const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
  const inFence = '```\n' + words + '\n```\n';
  assert.ok(rules(words, { maxWords: 20 }).includes('size'));
  assert.ok(!rules(inFence, { maxWords: 20 }).includes('size'));
});

test('size: over the char budget (Claude Code memory-file warning)', () => {
  const text = 'x'.repeat(50);
  const f = lint(text, { maxChars: 40 }).findings.find((x) => x.rule === 'size');
  assert.ok(f);
  assert.match(f.message, /Claude Code itself warns/);
  assert.equal(DEFAULTS.maxChars, 40000);
});

test('self-evident practice', () => {
  assert.ok(rules('Always write clean code and follow best practices.').includes('self-evident'));
  assert.ok(rules('- Be careful when editing files.').includes('self-evident'));
});

test('std-convention: defaults Claude already knows', () => {
  assert.ok(rules('Follow PEP 8 in all Python files.').includes('std-convention'));
  assert.ok(rules('Use camelCase for JavaScript variables.').includes('std-convention'));
  // A delta from the default is a keeper.
  assert.ok(!rules('Indent with tabs, not spaces — the legacy formatter chokes on spaces.').includes('std-convention'));
});

test('enforced-elsewhere: style rule with a formatter config beside the file', () => {
  const line = 'Use single quotes and no trailing commas.';
  const f = lint(line, { formatterConfigs: ['.prettierrc', '.editorconfig'] }).findings.find((x) => x.rule === 'enforced-elsewhere');
  assert.ok(f);
  assert.match(f.message, /\.prettierrc, \.editorconfig/);
  // No config, no finding: the prose is the only enforcement.
  assert.ok(!rules(line).includes('enforced-elsewhere'));
  assert.ok(!rules(line, { formatterConfigs: [] }).includes('enforced-elsewhere'));
});

test('keep-always guard: prohibitions are exempt from the generic-rule checks', () => {
  assert.ok(!rules('Never follow PEP 8 here; the legacy formatter differs.').includes('std-convention'));
  assert.ok(!rules('Do not write clean code over the vendored tree; keep the diff minimal.').includes('self-evident'));
  assert.ok(!rules('Never use semicolons in this package.', { formatterConfigs: ['.prettierrc'] }).includes('enforced-elsewhere'));
  assert.ok(!rules('Do not call `reset()`; it returns a stale handle.').includes('code-derivable'));
});

test('guessable-command: standard invocations and manifest-listed scripts', () => {
  assert.ok(rules('```bash\nnpm install\nnpm test\n```').includes('guessable-command'));
  assert.equal(rules('```bash\nnpm install\nnpm test\n```').filter((r) => r === 'guessable-command').length, 2);
  // A trailing comment or an extra flag means the author added a gotcha: keep.
  assert.ok(!rules('```bash\nnpm test   # needs the sandbox DB up\n```').includes('guessable-command'));
  assert.ok(!rules('```bash\nnpm test -- --runInBand\n```').includes('guessable-command'));
  // Manifest scripts: bare `npm run dev` is listed, so it is guessable; unknown scripts are not.
  assert.ok(rules('```bash\nnpm run dev\n```', { manifest: MANIFEST }).includes('guessable-command'));
  assert.ok(rules('```bash\npnpm db:reset\n```', { manifest: MANIFEST }).includes('guessable-command'));
  assert.ok(!rules('```bash\nnpm run dev\n```').includes('guessable-command'));
  assert.ok(!rules('```bash\nnpm run deploy:prod\n```', { manifest: MANIFEST }).includes('guessable-command'));
  assert.ok(!rules('```bash\nnpm run dev -- --host 0.0.0.0\n```', { manifest: MANIFEST }).includes('guessable-command'));
  // A `$ ` prompt prefix is stripped before matching.
  assert.ok(rules('```\n$ cargo test\n```').includes('guessable-command'));
});

test('tech-stack: heading and dependency-named list run', () => {
  const f = lint('## Tech stack\n- React 18\n- Vite\n- Zod for validation\n- Vitest\n', { manifest: MANIFEST }).findings;
  const kinds = f.filter((x) => x.rule === 'tech-stack');
  assert.equal(kinds.length, 2, JSON.stringify(f));
  assert.equal(kinds[0].line, 1);
  assert.equal(kinds[1].line, 2);
  // Heading fires without a manifest; the list run needs one.
  assert.deepEqual(rules('## Dependencies\n- React\n- Vite\n- Zod\n- Vitest\n'), ['tech-stack']);
  assert.ok(!rules('- React\n- Vite\n- Zod\n', { manifest: MANIFEST }).includes('tech-stack'));
});

test('tutorial: long paragraph', () => {
  const para = Array.from({ length: 130 }, () => 'word').join(' ');
  const f = lint(para).findings.find((x) => x.rule === 'tutorial');
  assert.ok(f, 'expected a tutorial finding');
  assert.equal(f.line, 1);
  assert.ok(!rules(Array.from({ length: 100 }, () => 'word').join(' ')).includes('tutorial'));
});

test('file-inventory: run of path-led list items', () => {
  const items = Array.from({ length: 6 }, (_, i) => `- \`src/mod${i}.js\` — handles thing ${i}`).join('\n');
  const f = lint(items).findings.find((x) => x.rule === 'file-inventory');
  assert.ok(f);
  assert.equal(f.line, 1);
  assert.ok(!rules(items.split('\n').slice(0, 5).join('\n')).includes('file-inventory'));
});

test('file-inventory: fenced directory tree', () => {
  const tree = '```\nsrc/\n├── api/\n│   └── routes.js\n├── lib/\n└── index.js\n```';
  const f = lint(tree).findings.find((x) => x.rule === 'file-inventory');
  assert.ok(f);
  assert.equal(f.line, 1);
  assert.match(f.message, /directory tree/);
  assert.ok(!rules('```\nsrc/\n└── index.js\n```').includes('file-inventory'));
});

test('api-dump: run of signature-led list items', () => {
  const items = Array.from({ length: 5 }, (_, i) => `- \`get${i}(id)\` — returns record ${i}`).join('\n');
  assert.ok(rules(items).includes('api-dump'));
  assert.ok(!rules(items.split('\n').slice(0, 4).join('\n')).includes('api-dump'));
});

test('lazy-candidate: long task-specific section', () => {
  const body = Array.from({ length: 90 }, () => 'step').join(' ');
  const f = lint(`## How to deploy\n${body}\n\n## Gotchas\nshort`).findings.find((x) => x.rule === 'lazy-candidate');
  assert.ok(f);
  assert.equal(f.line, 1);
  assert.match(f.message, /move to a skill/);
  // Short sections and non-workflow headings stay.
  assert.ok(!rules('## How to deploy\nRun the deploy script; it refuses a dirty tree.').includes('lazy-candidate'));
  assert.ok(!rules(`## Gotchas\n${body}`).includes('lazy-candidate'));
});

test('volatile: counts, progress, TODO', () => {
  assert.ok(rules('We have covered 20 of 35 checklist items.').includes('volatile'));
  assert.ok(rules('Status: in progress').includes('volatile'));
  assert.ok(rules('TODO: wire the retry path.').includes('volatile'));
  assert.ok(rules('The dashboard is currently built by hand.').includes('volatile'));
});

test('code-derivable: describing what code does', () => {
  assert.ok(rules('`parseConfig()` returns the merged config object.').includes('code-derivable'));
  assert.ok(rules('This module contains the auth helpers.').includes('code-derivable'));
  assert.ok(!rules('Call `parseConfig()` before any DB access or the pool is unconfigured.').includes('code-derivable'));
});

test('ambiguous: hedged rules', () => {
  assert.ok(rules('Try to keep functions short if possible.').includes('ambiguous'));
  assert.ok(rules('You might want to run the linter when appropriate.').includes('ambiguous'));
  assert.ok(!rules('Run `npm run lint` before every commit.').includes('ambiguous'));
});

test('duplicate: same sentence twice in one file', () => {
  const text = 'Run the restore test before every commit to master.\n\nRun the restore test before every commit to master.';
  const f = lint(text).findings.find((x) => x.rule === 'duplicate');
  assert.ok(f);
  assert.equal(f.line, 3);
  assert.match(f.message, /line 1/);
  assert.ok(!rules('See below.\n\nSee below.').includes('duplicate'));
});

test('duplicate: sentence also present in an --against file', () => {
  const shared = 'Run the restore test before every commit to master.';
  const against = [{ name: 'global.md', text: `# global\n\nintro\n${shared}\n` }];
  const f = lint(`## local\n${shared}\nsomething else entirely here now`, { against }).findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'duplicate');
  assert.equal(f[0].line, 2);
  assert.match(f[0].message, /also in global\.md:4/);
  // Sentences inside the other file's fences do not count.
  assert.deepEqual(lint(shared, { against: [{ name: 'g', text: '```\n' + shared + '\n```' }] }).findings, []);
});

test('emphasis: too many shouting markers', () => {
  const text = Array.from({ length: 13 }, (_, i) => `You MUST do thing ${i}.`).join('\n');
  assert.ok(rules(text).includes('emphasis'));
  assert.ok(!rules(text, { emphasisMax: 20 }).includes('emphasis'));
});

test('fenced code is never linted as prose', () => {
  const text = '```\nAlways write clean code. TODO: try to be careful if possible.\n```';
  assert.deepEqual(lint(text).findings, []);
});

test('suppression: ignore comment covers the line and the next', () => {
  const text = '<!-- claude-md-lint-ignore -->\nTODO: this one is deliberate.\nTODO: this one is not.';
  const f = lint(text).findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 3);
});

test('suppression: file-level disable of named rules', () => {
  const text = '<!-- claude-md-lint-disable: volatile, ambiguous -->\nTODO: try to fix it.\nAlways write clean code.';
  assert.deepEqual(rules(text), ['self-evident']);
});

test('every fired rule is documented in RULES', () => {
  const fired = new Set();
  const fixtures = [
    ['Always write clean code.'], ['Follow PEP 8.'], ['TODO: x'], ['`f()` returns x.'], ['Try to be nice.'],
    ['six word sentence right here now.\n\nsix word sentence right here now.'],
    ['```\nnpm test\n```'], ['## Tech stack'], ['Use semicolons everywhere.', { formatterConfigs: ['.prettierrc'] }],
    [`## How to deploy\n${'w '.repeat(90)}`],
  ];
  for (const [t, o] of fixtures) for (const r of rules(t, o)) fired.add(r);
  for (const r of fired) assert.ok(RULES.includes(r), `${r} not in RULES`);
  assert.equal(RULES.length, 15);
  assert.ok(DEFAULTS.maxLines > 0 && DEFAULTS.maxWords > 0);
});

test('repoContext: reads package.json and finds formatter configs beside the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-lint-ctx-'));
  try {
    assert.deepEqual(repoContext(dir), { manifest: null, formatterConfigs: [] });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'x' }, dependencies: { react: '1' }, devDependencies: { vitest: '1' } }));
    fs.writeFileSync(path.join(dir, '.prettierrc'), '{}');
    const ctx = repoContext(dir);
    assert.deepEqual(Object.keys(ctx.manifest.scripts), ['dev']);
    assert.deepEqual(ctx.manifest.dependencies, ['react', 'vitest']);
    assert.deepEqual(ctx.formatterConfigs, ['.prettierrc']);
    fs.writeFileSync(path.join(dir, 'package.json'), '{not json');
    assert.equal(repoContext(dir).manifest, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: exit 0 clean, 1 findings, 2 usage; repo context and --against', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-md-lint-'));
  try {
    const good = path.join(dir, 'good.md');
    const bad = path.join(dir, 'bad.md');
    const other = path.join(dir, 'other.md');
    fs.writeFileSync(good, GOOD);
    fs.writeFileSync(bad, 'Always write clean code.\n');
    fs.writeFileSync(other, 'A sentence that lives in both files here.\n');

    const ok = spawnSync(process.execPath, [CLI, good], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /already lean/);

    const findings = spawnSync(process.execPath, [CLI, bad], { encoding: 'utf8' });
    assert.equal(findings.status, 1);
    assert.match(findings.stdout, /bad\.md:1\tself-evident\t/);

    const jsonRun = spawnSync(process.execPath, [CLI, bad, '--json'], { encoding: 'utf8' });
    assert.equal(jsonRun.status, 1);
    const json = JSON.parse(jsonRun.stdout);
    assert.equal(json.findings[0].rule, 'self-evident');
    assert.equal(json.stats.nonBlankLines, 1);
    assert.equal(json.context.manifest, null);

    // Repo context picked up from the file's directory: the standard command becomes a finding
    // only when package.json lists the script.
    fs.writeFileSync(path.join(dir, 'script.md'), '```bash\nnpm run dev\n```\n');
    assert.equal(spawnSync(process.execPath, [CLI, path.join(dir, 'script.md')], { encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }));
    const withPkg = spawnSync(process.execPath, [CLI, path.join(dir, 'script.md')], { encoding: 'utf8' });
    assert.equal(withPkg.status, 1);
    assert.match(withPkg.stdout, /guessable-command/);

    fs.writeFileSync(path.join(dir, 'dup.md'), 'A sentence that lives in both files here.\n');
    const against = spawnSync(process.execPath, [CLI, path.join(dir, 'dup.md'), '--against', other], { encoding: 'utf8' });
    assert.equal(against.status, 1);
    assert.match(against.stdout, /duplicate\talso in .*other\.md:1/);

    assert.equal(spawnSync(process.execPath, [CLI], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, path.join(dir, 'nope.md')], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, good, '--max-lines', 'x'], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [CLI, good, '--against', path.join(dir, 'nope.md')], { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
