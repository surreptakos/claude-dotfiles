'use strict';
/**
 * node --test tests/claims-tripwire-recipe.test.js
 *
 * Issue 939. The wrapper-test recipe in aac-skills/consistency-audit/claims-tripwire.md used to
 * load the engine from ~/.claude/skills only, a path a desktop no longer gets (issue 734). This
 * suite runs the recipe itself: it lifts the js block out of the doc, drops it into a temp
 * consuming repo, and runs it under a fake home, so the doc cannot drift from what it claims.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const RECIPE_DOC = path.join(ROOT, 'aac-skills', 'consistency-audit', 'claims-tripwire.md');
const REL = path.join('consistency-audit', 'claims-audit.js');

function recipeSource() {
  const doc = fs.readFileSync(RECIPE_DOC, 'utf8');
  const section = doc.slice(doc.indexOf('## 2. Add a wrapper test'), doc.indexOf('## 3.'));
  const m = section.match(/```js\n([\s\S]*?)```/);
  assert.ok(m, 'no js block under "## 2. Add a wrapper test"');
  return m[1];
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A consuming repo holding the recipe, and a fake home; returns run() and cleanup. */
function fixture(engines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claims-recipe-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  for (const [rel, body] of Object.entries(engines)) write(path.join(home, rel), body);
  write(path.join(dir, 'repo', 'tests', 'claims-audit.test.js'), recipeSource());
  const env = Object.assign({}, process.env, { HOME: home, USERPROFILE: home });
  delete env.NODE_TEST_CONTEXT; // a nested test run that inherits it exits 0 whatever it did
  return {
    home,
    run() {
      const r = spawnSync(process.execPath, [path.join(dir, 'repo', 'tests', 'claims-audit.test.js')], { env, encoding: 'utf8' });
      return { code: r.status, out: String(r.stdout) + String(r.stderr) };
    },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const marker = (name, code) => `console.log('ENGINE-${name}'); process.exit(${code});\n`;
const cacheRel = (version) => path.join('.claude', 'plugins', 'cache', 'claude-dotfiles', 'aac-skills', version, 'skills', REL);

test('a home holding only a plugin-cache layout runs the newest version directory', () => {
  const fx = fixture({
    [cacheRel('2026.9.9')]: marker('OLD', 1),
    [cacheRel('2026.9.10')]: marker('NEW', 0),
  });
  try {
    const r = fx.run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ENGINE-NEW/);
    assert.doesNotMatch(r.out, /ENGINE-OLD/);
  } finally { fx.cleanup(); }
});

test('the container skills copy wins over a plugin cache', () => {
  const fx = fixture({
    [path.join('.claude', 'skills', REL)]: marker('SKILLS', 0),
    [cacheRel('2026.9.10')]: marker('CACHE', 0),
  });
  try {
    const r = fx.run();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ENGINE-SKILLS/);
  } finally { fx.cleanup(); }
});

test('a home holding neither fails once, listing every path tried', () => {
  const fx = fixture({});
  try {
    const r = fx.run();
    assert.notEqual(r.code, 0, 'the recipe passed with no engine anywhere');
    assert.ok(r.out.includes(path.join(fx.home, '.claude', 'skills', REL)), r.out);
    assert.ok(r.out.includes(path.join(fx.home, '.claude', 'plugins', 'cache', 'claude-dotfiles', 'aac-skills', '*', 'skills', REL)), r.out);
    assert.doesNotMatch(r.out, /ENOENT/);
  } finally { fx.cleanup(); }
});

test('a cache holding version directories lists each one when no engine is in them', () => {
  const fx = fixture({
    [path.join('.claude', 'plugins', 'cache', 'claude-dotfiles', 'aac-skills', '2026.9.10', 'other.txt')]: 'x',
    [path.join('.claude', 'plugins', 'cache', 'claude-dotfiles', 'aac-skills', '2026.9.9', 'other.txt')]: 'x',
  });
  try {
    const r = fx.run();
    assert.notEqual(r.code, 0);
    assert.ok(r.out.includes(path.join('2026.9.10', 'skills', REL)), r.out);
    assert.ok(r.out.includes(path.join('2026.9.9', 'skills', REL)), r.out);
  } finally { fx.cleanup(); }
});
