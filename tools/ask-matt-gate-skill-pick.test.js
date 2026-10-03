#!/usr/bin/env node
/**
 * node --test tools/ask-matt-gate-skill-pick.test.js
 *
 * Issue 1302: the skill pick. On every prompt the `claude-prompt` hook reads every installed
 * skill's description from disk (the user plugin registry's active install paths, the Desktop org
 * plugin folders beside the running plugin, the user skills folder), shortlists at most eight by
 * word overlap, and lets Jev pick one or `none` in the same request as the route. The added
 * context names the pick and says to open it before acting; each prompt logs one pick line.
 *
 * Every case runs a copy of the gate from a fake Desktop `rpm/plugin_self/hooks/scripts/` folder,
 * so the org plugin beside it is found the way the real one is, against a fake Claude home.
 * TYPESAFE_JEV_STUB stands in for TypeSafe; nothing here reaches the network.
 */
'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const REPO = path.resolve(__dirname, '..');
const HOOKS = path.join(REPO, 'profile', 'codex', 'hooks');

// One canned answer per route level, so the route walk always completes (issue 839).
const ROUTE = {
  correction: 0.02,
  'route.scope': 'software',
  'route.kind': 'question',
  'route.settled': 'single',
  'route.codebase': 'repo',
};

function skill(dir, front) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${front}\n---\n\n# Body\n`, 'utf-8');
}

function plugin(dir, name) {
  fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name }), 'utf-8');
}

/** A fake Claude home plus a fake Desktop rpm folder holding the gate. Every skill mentions widgets. */
function fixture({ userSkill = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-pick-'));
  const home = path.join(root, 'home', '.claude');
  const cache = path.join(home, 'plugins', 'cache', 'mkt', 'tools');
  const active = path.join(cache, '2.0.0');
  fs.mkdirSync(path.join(home, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(home, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: {
      'tools@mkt': [
        { scope: 'project', projectPath: path.join(root, 'elsewhere'), installPath: path.join(cache, '1.0.0') },
        { scope: 'user', installPath: active, version: '2.0.0' },
      ],
    },
  }), 'utf-8');
  skill(path.join(active, 'skills', 'active-widget'), 'name: active-widget\ndescription: Polish a widget in the active version.');
  skill(path.join(active, 'skills', 'hidden-widget'),
    'name: hidden-widget\ndescription: Polish a widget, typed by name only.\ndisable-model-invocation: true');
  skill(path.join(active, 'skills', 'meta-hidden-widget'),
    "name: meta-hidden-widget\ndescription: Polish a widget, stamped hidden.\nmetadata:\n  disable-model-invocation: 'true'");
  skill(path.join(cache, '1.0.0', 'skills', 'old-widget'), 'name: old-widget\ndescription: Polish a widget in an old version.');
  skill(path.join(home, 'plugins', 'cache', '.trash', 'tools', 'skills', 'trashed-widget'),
    'name: trashed-widget\ndescription: Polish a widget from the trash.');

  const rpm = path.join(root, 'rpm');
  const self = path.join(rpm, 'plugin_self');
  plugin(self, 'aac-skills');
  const scripts = path.join(self, 'hooks', 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  for (const name of ['ask_matt_gate.py', 'jev.py', 'route-gate.json']) {
    fs.copyFileSync(path.join(HOOKS, name), path.join(scripts, name));
  }
  skill(path.join(self, 'skills', 'self-widget'), 'name: self-widget\ndescription: Polish a widget from the running plugin.');
  const org = path.join(rpm, 'plugin_org');
  plugin(org, 'legal');
  skill(path.join(org, 'skills', 'org-widget'),
    'name: org-widget\ndescription: >\n  Review a widget contract against the\n  negotiation playbook.');
  if (userSkill) skill(path.join(home, 'skills', 'user-widget'), 'description: "Sketch a widget by hand."');
  return { root, home, gate: path.join(scripts, 'ask_matt_gate.py'), state: path.join(root, 'state') };
}

function prompt(fx, text, stub, sessionId = 's-pick') {
  const [bin, base] = process.platform === 'win32' ? ['py', ['-3', fx.gate]] : ['python3', [fx.gate]];
  const res = spawnSync(bin, [...base, 'claude-prompt'], {
    input: JSON.stringify({ session_id: sessionId, prompt: text, cwd: fx.root }),
    encoding: 'utf-8',
    env: {
      ...process.env,
      TYPESAFE_JEV_STUB: typeof stub === 'string' ? stub : JSON.stringify(stub),
      GOVERNANCE_CLAUDE_HOME: fx.home,
      ASK_MATT_GATE_STATE_DIR: fx.state,
    },
  });
  assert.strictEqual(res.status, 0, `gate exited ${res.status}: ${res.stderr}`);
  return JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
}

function picks(fx) {
  const log = path.join(fx.state, 'skill-pick.log');
  if (!fs.existsSync(log)) return [];
  return fs.readFileSync(log, 'utf-8').trim().split('\n').map((line) => JSON.parse(line.split('\t')[2]));
}

test('Jev picks a candidate: the context names it, its description, and says to open it first', () => {
  const fx = fixture();
  const context = prompt(fx, 'review the widget contract', { ...ROUTE, skill: 'legal:org-widget' });
  assert.match(context, /SKILL PICKED BY JEV: legal:org-widget/);
  assert.match(context, /Review a widget contract against the negotiation playbook\./);
  assert.match(context, /Open it with the Skill tool \(skill: "legal:org-widget"\) before acting/);
  const [line] = picks(fx);
  assert.strictEqual(line.pick, 'legal:org-widget');
  assert.strictEqual(line.confidence, 1);
});

test('candidates: the active version, the org plugin and user skills; never an old version or trash', () => {
  const fx = fixture({ userSkill: true });
  prompt(fx, 'polish the widget', { ...ROUTE, skill: 'none' });
  const [line] = picks(fx);
  assert.deepStrictEqual([...line.shortlist].sort(),
    ['aac-skills:self-widget', 'legal:org-widget', 'tools:active-widget', 'user-widget']);
  assert.strictEqual(line.pick, 'none');
});

test('a disable-model-invocation skill is never a candidate, top level or under metadata', () => {
  const fx = fixture();
  prompt(fx, 'hidden widget typed stamped', { ...ROUTE, skill: 'none' });
  const [line] = picks(fx);
  assert.ok(!line.shortlist.some((name) => /hidden/.test(name)), JSON.stringify(line.shortlist));
});

test('a prompt that shortlists nothing sends no skill question and names no skill', () => {
  const fx = fixture();
  // The stub answers no `skill` id: had the hook asked one, the whole request would be unavailable
  // and the route unchecked.
  const context = prompt(fx, 'hi there', ROUTE);
  assert.match(context, /ROUTE PICKED BY JEV: direct-answer/);
  assert.doesNotMatch(context, /SKILL PICKED/);
  assert.deepStrictEqual(picks(fx), [
    { pick: null, confidence: null, shortlist: [], reason: 'nothing shortlisted' },
  ]);
});

test('Jev unavailable: no skill named, the hook still exits cleanly', () => {
  const fx = fixture();
  const context = prompt(fx, 'polish the widget', 'off');
  assert.doesNotMatch(context, /SKILL PICKED/);
  const [line] = picks(fx);
  assert.strictEqual(line.pick, null);
  assert.strictEqual(line.reason, 'Jev unavailable');
});

test('each prompt appends one pick line to the skill-pick log', () => {
  const fx = fixture();
  prompt(fx, 'polish the widget', { ...ROUTE, skill: 'tools:active-widget' });
  prompt(fx, 'hi there', ROUTE);
  prompt(fx, 'polish the widget', 'off');
  assert.deepStrictEqual(picks(fx).map((line) => line.reason), ['picked', 'nothing shortlisted', 'Jev unavailable']);
});

test('Jev gets 10 s; the prompt hook gets 15 s in the plugin build and the Codex hooks file', () => {
  const gate = fs.readFileSync(path.join(HOOKS, 'ask_matt_gate.py'), 'utf-8');
  assert.match(gate, /^PROMPT_JEV_TIMEOUT = 10\.0$/m);
  const timeouts = (file, event, needle) => JSON.parse(fs.readFileSync(file, 'utf-8')).hooks[event]
    .flatMap((group) => group.hooks).filter((hook) => hook.command.includes(needle)).map((hook) => hook.timeout);
  const payload = path.join(REPO, 'marketplace', 'aac-skills', 'hooks', 'hooks.json');
  assert.deepStrictEqual(timeouts(payload, 'UserPromptSubmit', 'claude-prompt'), [15]);
  assert.deepStrictEqual(timeouts(path.join(REPO, 'profile', 'codex', 'hooks.json'), 'UserPromptSubmit', '" prompt'), [15]);
});
