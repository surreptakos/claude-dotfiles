'use strict';
// node --test gas/tests/cli.test.js — the CLI's pure helpers, and its agreement with the library.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const cli = require('../cli/gas.js');

const ROOT = path.join(__dirname, '..');
const LIB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'SelfDeploy.js'), 'utf8');

// A bare repo standing in for GitHub, with GAS_GIT_REMOTE pointed at it and the scratch repo beside it.
function fakeRemote(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-remote-'));
  const bare = path.join(dir, 'remote.git');
  cp.execFileSync('git', ['init', '-q', '--bare', bare]);
  const before = { remote: process.env.GAS_GIT_REMOTE, scratch: process.env.GAS_GIT_SCRATCH };
  process.env.GAS_GIT_REMOTE = bare;
  process.env.GAS_GIT_SCRATCH = path.join(dir, 'scratch');
  fs.mkdirSync(process.env.GAS_GIT_SCRATCH);
  t.after(() => {
    for (const [k, v] of [['GAS_GIT_REMOTE', before.remote], ['GAS_GIT_SCRATCH', before.scratch]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { bare, git: (args) => cp.execFileSync('git', ['--git-dir', bare].concat(args), { encoding: 'utf8' }).trim() };
}

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
  assert.deepEqual(a.preserve, []); assert.deepEqual(JSON.parse(JSON.stringify(b.preserve)), []);
  assert.equal(a.dropUnknown, false); assert.equal(b.dropUnknown, false);
  const c = cli.normalizeConfig({ scriptId: 'x', preserve: ['*Data', 'RuleData'], dropUnknown: 'yes' });
  assert.deepEqual(c.preserve, ['*Data', 'RuleData']); assert.equal(c.dropUnknown, true);
});

test('carryOver splits HEAD-only files the way the library does: preserved carried verbatim, the rest named', () => {
  const head = [{ name: 'appsscript', type: 'JSON', source: '{}' }, { name: 'GlData', type: 'SERVER_JS', source: 'var GL = 1;' }, { name: 'Old', type: 'SERVER_JS', source: '' }];
  const files = [{ name: 'appsscript', type: 'JSON', source: '{"a":1}' }, { name: 'Code', type: 'SERVER_JS', source: '' }];
  const c = cli.carryOver(head, files, { preserve: ['*Data'] });
  assert.deepEqual(c.kept, [{ name: 'GlData', type: 'SERVER_JS', source: 'var GL = 1;' }]);
  assert.deepEqual(c.unknown, ['Old']);
  assert.deepEqual(cli.carryOver(head, files, {}).kept, []);
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

test('the git fallback is taken when --via-git asks or the API refuses the write (403), and never otherwise', async () => {
  const calls = [];
  const api = (answer) => () => { calls.push('api'); if (answer instanceof Error) throw answer; return answer; };
  const viaGit = () => { calls.push('git'); return 'g'.repeat(40); };
  const forbidden = cli.apiError('create blob answered 403: proxy refused', 403);
  const unprocessable = cli.apiError('move ref answered 422', 422);

  const forced = await cli.viaApiOrGit({ 'via-git': true }, api('a'.repeat(40)), viaGit);
  assert.deepEqual([forced.via, forced.value], ['git', 'g'.repeat(40)]);
  assert.deepEqual(calls, ['git'], 'the flag keeps the API out of it entirely');

  const fell = await cli.viaApiOrGit({}, api(forbidden), viaGit);
  assert.deepEqual([fell.via, fell.value], ['git', 'g'.repeat(40)]);

  await assert.rejects(cli.viaApiOrGit({}, api(unprocessable), viaGit), /422/);
  assert.deepEqual(calls, ['git', 'api', 'git', 'api'], 'a 422 is an answer, not a road closure — git is never tried');

  const straight = await cli.viaApiOrGit({}, api('a'.repeat(40)), viaGit);
  assert.deepEqual([straight.via, cli.viaLabel(straight.via), cli.viaLabel('git')], ['api', 'the GitHub API', 'git push']);
  assert.equal(cli.isForbidden(forbidden), true); assert.equal(cli.isForbidden(unprocessable), false);
});

test('runViaGit pushes one gas-run.json commit to deploy/run, chained on the previous run request', (t) => {
  const remote = fakeRemote(t);
  const first = cli.runRequest('hello', '["a", 1]');
  const sha = cli.runViaGit('o/r', first);

  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(remote.git(['rev-parse', 'refs/heads/deploy/run']), sha);
  assert.equal(remote.git(['log', '-1', '--format=%s', sha]), 'gas run hello (' + first.id + ')');
  assert.equal(remote.git(['ls-tree', '--name-only', '-r', sha]), 'gas-run.json');
  assert.deepEqual(JSON.parse(remote.git(['show', sha + ':gas-run.json'])), first);
  assert.equal(remote.git(['rev-list', '--count', sha]), '1', 'the first request has no parent');

  const second = cli.runViaGit('o/r', cli.runRequest('again'));
  assert.equal(remote.git(['rev-parse', 'refs/heads/deploy/run']), second);
  assert.equal(remote.git(['rev-parse', second + '^']), sha);
});

test('refViaGit moves a deploy ref to a commit the remote already carries', (t) => {
  const remote = fakeRemote(t);
  const who = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' });
  const plumb = (args, input) => cp.execFileSync('git', ['--git-dir', remote.bare].concat(args), { encoding: 'utf8', input, env: who }).trim();
  const blob = plumb(['hash-object', '-w', '--stdin'], 'x\n');
  const tree = plumb(['mktree'], '100644 blob ' + blob + '\tCode.js\n');
  const commit = plumb(['commit-tree', tree, '-m', 'work']);
  remote.git(['update-ref', 'refs/heads/main', commit]);

  assert.equal(cli.refViaGit('o/r', 'deploy/test', commit), 'created');
  assert.equal(remote.git(['rev-parse', 'refs/heads/deploy/test']), commit);
  assert.equal(cli.refViaGit('o/r', 'deploy/test', commit), 'moved');
  assert.throws(() => cli.refViaGit('o/r', 'deploy/test', 'd'.repeat(40)), /cannot reach commit/);
});

test('logs names the Apps Script default Cloud project instead of asking it for entries', () => {
  assert.equal(cli.isDefaultGcpProject('project-id-3741568742576186263'), true);
  assert.equal(cli.isDefaultGcpProject('gpt-sheets-access-475817'), false);
  assert.equal(cli.isDefaultGcpProject(''), false);
});
