'use strict';
// node --test gas/tests/workflows.test.js — the reusable workflows keep the contract the library expects:
// a ref moved with the caller's own token, a status context polled by name, exit 2 when nothing answered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WF = path.join(__dirname, '..', '..', '.github', 'workflows');
const read = (f) => fs.readFileSync(path.join(WF, f), 'utf8');
const LIB = fs.readFileSync(path.join(__dirname, '..', 'lib', 'SelfDeploy.js'), 'utf8');
const ctx = (name) => new RegExp("GAS_STATUS_" + name + "_ = '([^']+)'").exec(LIB)[1];

for (const [file, refName, statusName] of [['gas-deploy.yml', 'deploy/test', 'DEPLOY'], ['gas-promote.yml', 'deploy/prod', 'PROMOTE']]) {
  test(file + ' is reusable, moves ' + refName + ' with GITHUB_TOKEN, polls the library\'s status context, and never calls Google', () => {
    const wf = read(file);
    assert.match(wf, /^on:\s*\n\s+workflow_call:/m);
    assert.ok(wf.includes("default: " + refName), 'default ref ' + refName);
    assert.ok(wf.includes('default: ' + ctx(statusName)), 'default status context ' + ctx(statusName));
    assert.match(wf, /git push --force origin "\$SHA:refs\/heads\/\$REF_NAME"/);
    assert.match(wf, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(wf, /commits\/\$\{SHA\}\/statuses/);
    assert.match(wf, /success\) .*exit 0/); assert.match(wf, /failure\|error\) .*exit 1/); assert.match(wf, /exit 2/);
    assert.match(wf, /permissions:\s*\n\s+contents: write\s*\n\s+statuses: read/);
    assert.ok(!/script\.google|googleapis|clasp|CLASPRC/.test(wf), 'nothing Google-side, no clasp');
  });
}

test('gas-promote.yml carries the freeze guard with an override and a timezone', () => {
  const wf = read('gas-promote.yml');
  for (const s of ['freeze_days', 'emergency_override', 'timezone', 'TZ="$TZ_NAME" date +%u', '::error::freeze day', '::warning::freeze day']) assert.ok(wf.includes(s), s);
});

test('gas-tests.yml runs the package on Linux with node --test', () => {
  const wf = read('gas-tests.yml');
  assert.match(wf, /node --test gas\/tests\/self_deploy\.test\.js gas\/tests\/cli\.test\.js gas\/tests\/workflows\.test\.js/);
  assert.match(wf, /ubuntu-latest/);
});

test('the consumer templates call the reusable workflows by their real paths', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'templates', 'deploy.yml'), 'utf8');
  assert.match(t, /uses: surreptakos\/claude-dotfiles\/\.github\/workflows\/gas-deploy\.yml@master/);
  assert.match(t, /permissions:\s*\n\s+contents: write\s*\n\s+statuses: read/);
  const p = fs.readFileSync(path.join(__dirname, '..', 'templates', 'promote.yml'), 'utf8');
  assert.match(p, /uses: surreptakos\/claude-dotfiles\/\.github\/workflows\/gas-promote\.yml@master/);
  assert.match(p, /freeze_days: '1,2,3'/);
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'gas.json'), 'utf8'));
  for (const k of ['scriptId', 'gcpProject', 'rootDir', 'include', 'exclude', 'hooks', 'runnable', 'pollMinutes']) assert.ok(k in cfg, k);
});
