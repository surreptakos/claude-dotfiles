#!/usr/bin/env node
/**
 * node --test tools/upstream-skills-hook.test.js
 *
 * The cloud-container SessionStart hook .claude/hooks/upstream-skills.sh delivers the
 * third-party plugins a container cannot install from their marketplaces (issue 928): it
 * shallow-clones each repo in UPSTREAM_SKILLS_REPOS and copies what a plugin install would
 * have registered. The travel-hacker plugin (borski/travel-hacking-toolkit) added two shapes
 * the i-have-adhd and typesafe repos never had, and this test pins both:
 *
 *   - its scripted skills live under plugins/<name>/skills/<skill>/ (with scripts/), while the
 *     root skills/<skill>/ holds SKILL.md only, so the nested tree must win the copy;
 *   - it ships agents/*.md and a .mcp.json whose servers a plugin install would register; the
 *     hook copies the agents to ~/.claude/agents/ and merges the servers into the user-scope
 *     mcpServers of ~/.claude.json without touching servers already there.
 *
 * Fixture: a local git repo carrying all four shapes, cloned over file://, so the test runs
 * offline. Requires git on PATH and a bash (tools/posix-shell.js falls back to Git for Windows').
 */
'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { shell } = require('./posix-shell.js');
const BASH = shell('bash');

const HOOK = path.resolve(__dirname, '..', '.claude', 'hooks', 'upstream-skills.sh');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '');
}

function makeFixtureRepo(root) {
  const repo = path.join(root, 'toolkit.git-src');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'fixture']);
  write(path.join(repo, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nroot copy\n');
  write(path.join(repo, 'skills', 'beta', 'SKILL.md'), '---\nname: beta\n---\nbeta\n');
  write(path.join(repo, 'skills', 'notes', 'README.md'), 'no SKILL.md here\n');
  write(path.join(repo, 'plugins', 'toolkit', 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nnested copy\n');
  write(path.join(repo, 'plugins', 'toolkit', 'skills', 'alpha', 'scripts', 'run.py'), 'print("ok")\n');
  write(path.join(repo, 'agents', 'scout.md'), '---\nname: scout\n---\nagent\n');
  write(path.join(repo, '.mcp.json'), JSON.stringify({
    mcpServers: {
      hello: { type: 'http', url: 'https://mcp.example.invalid/mcp' },
      keyed: { type: 'http', url: 'https://mcp.example.invalid/k', headers: { Authorization: 'Bearer ${EXAMPLE_KEY:-unset}' } },
    },
  }, null, 2));
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'fixture']);
  return fileUrl(repo);
}

function runHook(home, repoUrl, extraEnv) {
  return BASH.run([HOOK], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      CLAUDE_CODE_REMOTE: 'true',
      UPSTREAM_SKILLS_HOME: home,
      UPSTREAM_SKILLS_REPOS: repoUrl,
      ...extraEnv,
    },
  });
}

test('a cloud session gets the nested skills, the agents and the MCP servers of an upstream plugin', { skip: BASH.skip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-skills-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const repoUrl = makeFixtureRepo(root);
  write(path.join(home, '.claude.json'), JSON.stringify({
    numStartups: 3,
    mcpServers: { existing: { type: 'http', url: 'https://keep.example.invalid' } },
  }));
  write(path.join(home, '.claude', 'skills', 'alpha', 'stale.txt'), 'from an earlier session\n');

  const r = runHook(home, repoUrl);
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);

  const alpha = path.join(home, '.claude', 'skills', 'alpha');
  assert.equal(fs.readFileSync(path.join(alpha, 'SKILL.md'), 'utf8').trim().split('\n').pop(), 'nested copy',
    'plugins/<name>/skills/ wins over the root skills/ copy');
  assert.ok(fs.existsSync(path.join(alpha, 'scripts', 'run.py')), 'the nested skill brings its scripts/');
  assert.ok(!fs.existsSync(path.join(alpha, 'stale.txt')), 'a previous copy is replaced, not merged');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'beta', 'SKILL.md')), 'a root-only skill is still copied');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', 'notes')), 'a directory without SKILL.md is not a skill');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'agents', 'scout.md')), 'agents/*.md land in ~/.claude/agents/');

  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.equal(cfg.numStartups, 3, 'other keys of ~/.claude.json survive');
  assert.deepEqual(cfg.mcpServers.existing, { type: 'http', url: 'https://keep.example.invalid' }, 'an existing server is untouched');
  assert.equal(cfg.mcpServers.hello.url, 'https://mcp.example.invalid/mcp');
  assert.equal(cfg.mcpServers.keyed.headers.Authorization, 'Bearer ${EXAMPLE_KEY:-unset}',
    'the env placeholder reaches the config verbatim for Claude Code to expand at launch');

  const again = runHook(home, repoUrl);
  assert.equal(again.status, 0, `second run exited ${again.status}: ${again.stderr}`);
  const cfg2 = JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8'));
  assert.deepEqual(cfg2, cfg, 'a second run is a no-op on ~/.claude.json');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a failed clone leaves the previous copies and ~/.claude.json alone', { skip: BASH.skip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-skills-'));
  const home = path.join(root, 'home');
  write(path.join(home, '.claude', 'skills', 'alpha', 'SKILL.md'), 'kept\n');
  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { existing: { type: 'http', url: 'https://keep.example.invalid' } } }));
  const r = runHook(home, fileUrl(path.join(root, 'missing')));
  assert.equal(r.status, 0, 'never fails the session');
  assert.match(r.stderr, /clone of .* failed; previous copies kept/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf8'), 'kept\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers, { existing: { type: 'http', url: 'https://keep.example.invalid' } });
  fs.rmSync(root, { recursive: true, force: true });
});

test('outside a cloud container the hook exits 0 and touches nothing', { skip: BASH.skip }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-skills-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const r = BASH.run([HOOK], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, TEMP: process.env.TEMP, TMP: process.env.TMP, UPSTREAM_SKILLS_HOME: home },
  });
  assert.equal(r.status, 0);
  assert.deepEqual(fs.readdirSync(home), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a marketplace entry with an upstream git source copies only its listed skills, nested paths included', { skip: BASH.skip }, () => {
  // The upstream-subset plugins (tools/build-cloud-plugin.py UPSTREAM_PLUGINS) reach a container
  // through this path: the entry's skills list is the allowlist, so a sibling directory the
  // upstream also ships (here `unwanted`, standing for writing-guidelines or an upstream copy of
  // a skill the AAC payload edits) must not land in ~/.claude/skills.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-skills-'));
  const home = path.join(root, 'home');
  fs.mkdirSync(home);
  const repo = path.join(root, 'subset.git-src');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'fixture']);
  write(path.join(repo, 'skills', 'engineering', 'tdd', 'SKILL.md'), '---\nname: tdd\n---\nupstream tdd\n');
  write(path.join(repo, 'skills', 'engineering', 'tdd', 'tests.md'), 'sidecar\n');
  write(path.join(repo, 'skills', 'productivity', 'grill-me', 'SKILL.md'), '---\nname: grill-me\n---\ngrill\n');
  write(path.join(repo, 'skills', 'unwanted', 'SKILL.md'), '---\nname: unwanted\n---\nnot listed\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'fixture']);
  const marketplace = path.join(root, 'marketplace.json');
  write(marketplace, JSON.stringify({
    name: 'fixture',
    plugins: [
      { name: 'aac-skills', source: './marketplace/aac-skills', version: '0.0.0' },
      {
        name: 'subset',
        source: { source: 'git-subdir', url: fileUrl(repo), path: 'skills', ref: 'main' },
        strict: false,
        skills: ['./engineering/tdd', './productivity/grill-me', './missing/nope'],
      },
    ],
  }));
  const r = runHook(home, fileUrl(path.join(root, 'no-such-repo')), { UPSTREAM_SKILLS_MARKETPLACE: marketplace });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  const skills = path.join(home, '.claude', 'skills');
  assert.equal(fs.readFileSync(path.join(skills, 'tdd', 'SKILL.md'), 'utf8').trim().split('\n').pop(), 'upstream tdd',
    'a nested skill path lands under its own name');
  assert.ok(fs.existsSync(path.join(skills, 'tdd', 'tests.md')), 'the skill directory is copied whole');
  assert.ok(fs.existsSync(path.join(skills, 'grill-me', 'SKILL.md')), 'every listed skill is copied');
  assert.ok(!fs.existsSync(path.join(skills, 'unwanted')), 'an upstream skill the entry does not list stays out');
  assert.ok(!fs.existsSync(path.join(skills, 'engineering')), 'the upstream tree is not copied as a whole');
  assert.match(r.stderr, /has no skills\/missing\/nope\/SKILL\.md; skipped/, 'a listed path the upstream lacks is reported, not fatal');
  fs.rmSync(root, { recursive: true, force: true });
});

test('the committed marketplace.json names an upstream subset for every skill that left aac-skills', () => {
  const m = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
  const served = new Set();
  for (const p of m.plugins) {
    if (p.source && typeof p.source === 'object' && Array.isArray(p.skills)) {
      for (const s of p.skills) served.add(path.posix.basename(s));
    }
  }
  for (const name of ['tdd', 'grill-me', 'teach', 'prototype', 'wizard', 'wait-what',
    'to-questionnaire', 'writing-for-agents', 'codebase-design', 'domain-modeling', 'improve-codebase-architecture',
    'composition-patterns', 'react-best-practices', 'react-native-skills', 'react-view-transitions',
    'web-design-guidelines', 'agent-browser', 'find-skills']) {
    assert.ok(served.has(name), `${name} is served by an upstream marketplace entry`);
    assert.ok(!fs.existsSync(path.resolve(__dirname, '..', 'aac-skills', name)), `${name} no longer has an aac-skills copy`);
  }
  assert.ok(!served.has('writing-guidelines'), 'writing-guidelines is killed, not served');
  for (const local of ['ask-matt', 'code-review', 'triage', 'to-tickets', 'to-spec', 'implement', 'grill-with-docs', 'grilling', 'handoff',
    'research', 'wayfinder', 'diagnosing-bugs', 'setup-matt-pocock-skills']) {
    assert.ok(!served.has(local), `${local} (locally edited) is not also served upstream`);
    assert.ok(fs.existsSync(path.resolve(__dirname, '..', 'aac-skills', local, 'SKILL.md')), `${local} stays vendored`);
  }
  // A frontmatter flag flip is a local edit (Dan, 2026-10-01): the ask-matt flows call these two,
  // so the vendored copies must keep model invocation on, where upstream turns it off.
  for (const flow of ['to-spec', 'to-tickets']) {
    const text = fs.readFileSync(path.resolve(__dirname, '..', 'aac-skills', flow, 'SKILL.md'), 'utf8');
    assert.match(text, /^disable-model-invocation: false\r?$/m, `${flow} keeps disable-model-invocation: false`);
  }
});

test('the default repo list names the travel-hacker toolkit beside i-have-adhd and typesafe', () => {
  const text = fs.readFileSync(HOOK, 'utf8');
  const line = text.split('\n').find((l) => l.startsWith('REPOS='));
  assert.ok(line, 'REPOS= default line present');
  for (const repo of ['ayghri/i-have-adhd', 'typesafe-ai/skills', 'borski/travel-hacking-toolkit']) {
    assert.ok(line.includes(repo), `${repo} in the default REPOS`);
  }
});
