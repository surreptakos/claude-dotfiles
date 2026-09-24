'use strict';
// node --test gas/tests/cli.test.js — the CLI's pure helpers, and its agreement with the library.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const http = require('http');
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

// A local server standing in for api.github.com: GAS_GITHUB_API points gh() at it, GITHUB_TOKEN gives it
// something to send. `handler(req, res)` gets {method, url, body} and answers with the raw `res`.
function fakeGithubApi(t, handler) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch (e) { body = null; }
      handler({ method: req.method, url: req.url, body }, res);
    });
  });
  server.listen(0);
  const before = { api: process.env.GAS_GITHUB_API, token: process.env.GITHUB_TOKEN };
  process.env.GAS_GITHUB_API = 'http://127.0.0.1:' + server.address().port;
  process.env.GITHUB_TOKEN = 'test-token';
  t.after(() => {
    server.close();
    for (const [k, v] of [['GAS_GITHUB_API', before.api], ['GITHUB_TOKEN', before.token]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  return server;
}
function sendJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

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

test('runViaApi retries the commit on a 422 fast-forward rejection and lands on the new tip', async (t) => {
  const repo = 'o/r';
  const oldTip = 'a'.repeat(40);
  const newTip = 'b'.repeat(40);
  const finalCommit = 'c'.repeat(40);
  const firstCommit = 'd'.repeat(40);
  let refsCalls = 0, patchCalls = 0;
  const commits = [];
  fakeGithubApi(t, (req, res) => {
    if (req.method === 'GET' && /\/git\/matching-refs\/heads\/deploy$/.test(req.url)) {
      refsCalls++;
      const sha = refsCalls === 1 ? oldTip : newTip;
      return sendJson(res, 200, [{ ref: 'refs/heads/deploy/run', object: { sha } }]);
    }
    if (req.method === 'POST' && /\/git\/blobs$/.test(req.url)) return sendJson(res, 201, { sha: 'blob-sha' });
    if (req.method === 'POST' && /\/git\/trees$/.test(req.url)) return sendJson(res, 201, { sha: 'tree-sha' });
    if (req.method === 'POST' && /\/git\/commits$/.test(req.url)) {
      commits.push(req.body);
      return sendJson(res, 201, { sha: commits.length === 1 ? firstCommit : finalCommit });
    }
    if (req.method === 'PATCH' && /\/git\/refs\/heads\/deploy\/run$/.test(req.url)) {
      patchCalls++;
      assert.equal(req.body.force, false, 'the run path must not force the ref move');
      if (patchCalls === 1) return sendJson(res, 422, { message: 'Update is not a fast forward' });
      return sendJson(res, 200, { ref: 'refs/heads/deploy/run', object: { sha: req.body.sha } });
    }
    res.writeHead(404); res.end('unhandled: ' + req.method + ' ' + req.url);
  });

  const sha = await cli.runViaApi(repo, cli.runRequest('hello'));
  assert.equal(sha, finalCommit);
  assert.equal(commits.length, 2, 'the commit is rebuilt once, after the rejection');
  assert.deepEqual(commits[0].parents, [oldTip], 'the first attempt is built on the tip read at the start');
  assert.deepEqual(commits[1].parents, [newTip], 'the retry is rebuilt on the new tip, not the orphaned old one');
  assert.equal(patchCalls, 2);
});

test('runViaApi gives up after 3 straight fast-forward rejections and names the race', async (t) => {
  const repo = 'o/r';
  let tip = 'a'.repeat(40);
  let commitN = 0;
  fakeGithubApi(t, (req, res) => {
    if (req.method === 'GET' && /\/git\/matching-refs\/heads\/deploy$/.test(req.url)) return sendJson(res, 200, [{ ref: 'refs/heads/deploy/run', object: { sha: tip } }]);
    if (req.method === 'POST' && /\/git\/blobs$/.test(req.url)) return sendJson(res, 201, { sha: 'blob-sha' });
    if (req.method === 'POST' && /\/git\/trees$/.test(req.url)) return sendJson(res, 201, { sha: 'tree-sha' });
    if (req.method === 'POST' && /\/git\/commits$/.test(req.url)) { commitN++; return sendJson(res, 201, { sha: String(commitN).repeat(40).slice(0, 40) }); }
    if (req.method === 'PATCH' && /\/git\/refs\/heads\/deploy\/run$/.test(req.url)) { tip = 'e'.repeat(40); return sendJson(res, 422, { message: 'Update is not a fast forward' }); }
    res.writeHead(404); res.end('unhandled');
  });
  await assert.rejects(cli.runViaApi(repo, cli.runRequest('hello')), /lost the fast-forward race 3 times/);
  assert.equal(commitN, cli.RUN_RACE_ATTEMPTS, 'one commit build per attempt, no more');
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

test('runViaGit is fast-forward only: a concurrent push is not orphaned, the retry rebuilds on it', (t) => {
  const remote = fakeRemote(t);
  const who = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' });
  const plumb = (args, input) => cp.execFileSync('git', ['--git-dir', remote.bare].concat(args), { encoding: 'utf8', input, env: who }).trim();

  const first = cli.runViaGit('o/r', cli.runRequest('first'));

  // Simulate the race directly on the plumbing runViaGit itself uses: right as our push is about to go
  // out, a concurrent caller lands its own commit on deploy/run, parented on the same tip we read. A
  // --force push would have overwritten it (orphaning it, the bug this fix closes); fast-forward-only
  // must instead be rejected, re-read the new tip, and rebuild on top of the racer's commit.
  const realSpawnSync = cp.spawnSync;
  let raced = false, raceCommit = '';
  t.after(() => { cp.spawnSync = realSpawnSync; });
  cp.spawnSync = function (bin, args) {
    if (!raced && bin === 'git' && args[0] === 'push' && String(args[args.length - 1]).endsWith(':refs/heads/deploy/run')) {
      raced = true;
      const blob = plumb(['hash-object', '-w', '--stdin'], 'race\n');
      const tree = plumb(['mktree'], '100644 blob ' + blob + '\tgas-run.json\n');
      raceCommit = plumb(['commit-tree', tree, '-p', first, '-m', 'race']);
      plumb(['update-ref', 'refs/heads/deploy/run', raceCommit]);
    }
    return realSpawnSync.apply(this, arguments);
  };

  const second = cli.runViaGit('o/r', cli.runRequest('second'));

  assert.equal(raced, true, 'the race was actually injected');
  assert.equal(remote.git(['rev-parse', 'refs/heads/deploy/run']), second, 'the retried push landed');
  assert.equal(remote.git(['rev-parse', second + '^']), raceCommit, 'rebuilt on the racer\'s commit, not orphaning it');
  assert.doesNotThrow(() => remote.git(['cat-file', '-e', raceCommit]), 'the racer\'s commit still exists, reachable from the new tip');
});

test('logs names the Apps Script default Cloud project instead of asking it for entries', () => {
  assert.equal(cli.isDefaultGcpProject('project-id-3741568742576186263'), true);
  assert.equal(cli.isDefaultGcpProject('gpt-sheets-access-475817'), false);
  assert.equal(cli.isDefaultGcpProject(''), false);
});
