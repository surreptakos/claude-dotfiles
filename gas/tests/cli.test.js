'use strict';
// node --test gas/tests/cli.test.js — the CLI's pure helpers, and its agreement with the library.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cli = require('../cli/gas.js');

const ROOT = path.join(__dirname, '..');
const LIB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'SelfDeploy.js'), 'utf8');

test('parseArgs: flags with values, =, bare flags, positionals', () => {
  const { flags, rest } = cli.parseArgs(['ref', 'o/r', 'deploy/test', 'abc', '--wait', '15', '--paste', '--out=dir', '--limit', '3']);
  assert.deepEqual(rest, ['ref', 'o/r', 'deploy/test', 'abc']);
  assert.deepEqual(flags, { wait: '15', paste: true, out: 'dir', limit: '3' });
});

test('normalizeCredentials accepts a clasp 3 ~/.clasprc.json, a clasp 2 one, and its own shape', () => {
  const c3 = cli.normalizeCredentials({ tokens: { default: { client_id: 'id', client_secret: 'sec', refresh_token: 'rt', scope: 'a b' } } });
  assert.deepEqual([c3.client_id, c3.client_secret, c3.refresh_token, c3.scopes], ['id', 'sec', 'rt', ['a', 'b']]);
  const c2 = cli.normalizeCredentials({ token: { refresh_token: 'rt2' }, oauth2ClientSettings: { clientId: 'id2', clientSecret: 'sec2' } });
  assert.deepEqual([c2.client_id, c2.client_secret, c2.refresh_token], ['id2', 'sec2', 'rt2']);
  const own = cli.normalizeCredentials({ client_id: 'i', client_secret: 's', refresh_token: 'r', account: 'me@x' });
  assert.equal(own.account, 'me@x');
  assert.throws(() => cli.normalizeCredentials({ client_id: 'i' }), /lacks/);
});

test('codeFromRedirect reads the code and checks the state', () => {
  assert.equal(cli.codeFromRedirect('http://localhost:4242/?state=s1&code=4%2Fabc&scope=x', 's1'), '4/abc');
  assert.throws(() => cli.codeFromRedirect('http://localhost/?state=other&code=1', 's1'), /state mismatch/);
  assert.throws(() => cli.codeFromRedirect('http://localhost/?error=access_denied', 's1'), /no `code=`/);
});

test('script names and types follow the Apps Script API (folders kept, extension dropped)', () => {
  assert.equal(cli.scriptName('Code.js'), 'Code');
  assert.equal(cli.scriptName('lib/util.gs'), 'lib/util');
  assert.equal(cli.scriptName('appsscript.json'), 'appsscript');
  assert.equal(cli.scriptName('Page.html'), 'Page');
  assert.deepEqual(['a.js', 'b.gs', 'c.html', 'appsscript.json'].map(cli.scriptType), ['SERVER_JS', 'SERVER_JS', 'HTML', 'JSON']);
  assert.deepEqual(['SERVER_JS', 'HTML', 'JSON'].map(cli.extFor), ['.js', '.html', '.json']);
});

test('the CLI glob and the library glob agree on one table', () => {
  const sb = { console, RegExp, String };
  vm.createContext(sb);
  vm.runInContext(LIB_SRC.replace(/^var GAS_DEPLOYED_SHA.*$/m, "var GAS_DEPLOYED_SHA = '';"), sb);
  const table = [
    ['**/*.js', 'Code.js', true], ['**/*.js', 'lib/a/b.js', true], ['**/*.js', 'Code.jsx', false],
    ['*.js', 'Code.js', true], ['*.js', 'lib/Code.js', false],
    ['tests/**', 'tests/x.js', true], ['tests/**', 'tests/deep/y.js', true], ['tests/**', 'tests2/x.js', false],
    ['**/*.test.js', 'a.test.js', true], ['**/*.test.js', 'atest.js', false],
    ['Page?.html', 'Page1.html', true], ['Page?.html', 'Page10.html', false],
    ['appsscript.json', 'appsscript.json', true], ['appsscript.json', 'x/appsscript.json', false]
  ];
  for (const [glob, p, want] of table) {
    assert.equal(cli.globToRegExp(glob).test(p), want, 'cli ' + glob + ' vs ' + p);
    assert.equal(sb.gasGlobToRegExp_(glob).test(p), want, 'lib ' + glob + ' vs ' + p);
  }
});

test('normalizeConfig defaults match the library\'s', () => {
  const sb = { console, RegExp, String, Number, Array };
  vm.createContext(sb);
  vm.runInContext(LIB_SRC.replace(/^var GAS_DEPLOYED_SHA.*$/m, "var GAS_DEPLOYED_SHA = '';"), sb);
  const a = cli.normalizeConfig({ scriptId: 'x', rootDir: './gas/' });
  const b = sb.gasNormalizeConfig_({ scriptId: 'x', rootDir: './gas/' });
  assert.deepEqual(a.include, JSON.parse(JSON.stringify(b.include))); assert.deepEqual(a.exclude, JSON.parse(JSON.stringify(b.exclude)));
  assert.equal(a.rootDir, 'gas'); assert.equal(b.rootDir, 'gas');
  assert.equal(a.pollMinutes, b.pollMinutes);
});

test('localDeployables walks rootDir with include/exclude and skips node_modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-'));
  for (const f of ['appsscript.json', 'Code.js', 'lib/util.js', 'Page.html', 'tests/a.test.js', 'node_modules/x/index.js', 'notes.md']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), '');
  }
  assert.deepEqual(cli.localDeployables(dir, {}), ['Code.js', 'Page.html', 'appsscript.json', 'lib/util.js']);
  assert.deepEqual(cli.localDeployables(dir, { include: ['*.js'] }), ['Code.js']);
});

test('seedPayload carries both halves, and the github half only when complete', () => {
  const cred = { client_id: 'i', client_secret: 's', refresh_token: 'r' };
  assert.deepEqual(cli.seedPayload(cred, { token: 't', repo: 'o/r' }), { google: { refresh_token: 'r', client_id: 'i', client_secret: 's' }, github: { token: 't', repo: 'o/r' } });
  assert.deepEqual(Object.keys(cli.seedPayload(cred, { token: 't' })), ['google']);
});

test('runRequest builds {id, fn, args}; args must be JSON and become an array', () => {
  const r = cli.runRequest('hello', '["a", 1]');
  assert.equal(r.fn, 'hello'); assert.deepEqual(r.args, ['a', 1]); assert.match(r.id, /^\d{8}T\d{6}-[0-9a-f]{6}$/);
  assert.deepEqual(cli.runRequest('f', '5').args, [5]);
  assert.deepEqual(cli.runRequest('f').args, []);
  assert.throws(() => cli.runRequest('f', '{bad'), /args must be JSON/);
});

test('deployedShaOf reads the stamp the library carries; libraryVersionOf reads the version', () => {
  assert.equal(cli.deployedShaOf([{ name: 'SelfDeploy', source: "var GAS_DEPLOYED_SHA = '" + 'e'.repeat(40) + "';" }]), 'e'.repeat(40));
  assert.equal(cli.deployedShaOf([{ name: 'Code', source: 'x' }]), '');
  assert.equal(cli.libraryVersionOf(LIB_SRC), fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim());
});

test('the published client and the login scopes are the ones the README promises', () => {
  assert.match(cli.PUBLISHED_CLIENT.client_id, /^1072944905499-/);
  for (const s of ['script.projects', 'script.deployments', 'drive.file', 'logging.read']) assert.ok(cli.LOGIN_SCOPES.some((x) => x.endsWith('/' + s)), s);
  assert.deepEqual(cli.STATUS, { deploy: 'gas/deploy', promote: 'gas/promote', run: 'gas/run' });
  assert.equal(cli.REF_PREFIX, 'deploy/'); assert.equal(cli.RUN_FILE, 'gas-run.json'); assert.equal(cli.SEED_PREFIX, 'gas-seed-');
});
