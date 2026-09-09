'use strict';
// node --test gas/tests/self_deploy.test.js
//
// The library, driven the way Apps Script drives it, against fakes: a GitHub with deploy/* refs, commits,
// trees and file contents; an Apps Script API with HEAD content, versions and deployments; a Drive with
// or without the seed; Script Properties, CacheService, triggers, MailApp. Each sandbox is loaded with the
// library STAMPED as a given runtime build, which is exactly how a deployed copy differs from the source:
// `runtime: SHA_B` means "this tick runs the code the previous tick wrote".
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const LIB_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'SelfDeploy.js'), 'utf8');
const PLACEHOLDER = '__GAS_' + 'SHA__';
const SCRIPT_ID = '1TESTSCRIPTID000000000000000000000000000000000000000000000';
const REPO = 'acme/widgets';
const PROD = 'AKfycbPRODDEPLOYMENT';
const SHA_A = 'a'.repeat(40), SHA_B = 'b'.repeat(40), SHA_C = 'c'.repeat(40), SHA_R = 'd'.repeat(40);

const baseConfig = (extra) => Object.assign({ scriptId: SCRIPT_ID, rootDir: 'gas', hooks: { postDeploy: 'checkDeploy_' }, prod: { deploymentId: PROD } }, extra || {});
// A commit's files, keyed by path. The library source ships with its placeholder, as the repo carries it.
function repoFiles(cfg) {
  return {
    'gas.json': JSON.stringify(cfg),
    'README.md': '# outside rootDir\n',
    'gas/appsscript.json': '{"timeZone":"America/Chicago"}',
    'gas/Code.js': 'function hello(a, b) { return "hello " + a + b; }\nfunction secret_() { return 1; }\n',
    'gas/lib/util.js': 'var U = 1;\n',
    'gas/Page.html': '<html><meta name="aac-build" content="__BUILD_SHA__"></html>',
    'gas/SelfDeploy.js': LIB_SRC,
    'gas/tests/code.test.js': '// excluded by default\n'
  };
}

function load(opts) {
  opts = opts || {};
  const st = {
    props: Object.assign({}, opts.props || {}), cache: {}, fetches: [], puts: [], statuses: [], comments: [],
    versions: [], deployments: {}, triggers: (opts.triggers || []).slice(), mails: [], logs: [], drive: (opts.seed ? [opts.seed] : []),
    tokenMints: 0, headFiles: opts.headFiles || null
  };
  st.deployments[PROD] = { versionNumber: opts.prodVersion || 0 };
  for (let i = 1; i <= (opts.versionCount || 0); i++) st.versions.push({ versionNumber: i });
  const gh = { refs: Object.assign({}, opts.refs || {}), commits: Object.assign({}, opts.commits || {}), token: 'gh-ok', refsStatus: opts.refsStatus || 200, statusesCode: opts.statusesCode || 201 };
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });

  function fetch(url, params) {
    url = String(url); params = params || {};
    st.fetches.push((params.method || 'get').toUpperCase() + ' ' + url);
    const hdr = params.headers || {};
    if (url.indexOf('oauth2.googleapis.com/token') !== -1) {
      st.tokenMints++;
      return params.payload && params.payload.refresh_token === 'good-refresh' ? resp(200, { access_token: 'at-' + st.tokenMints, expires_in: 3599 }) : resp(400, { error: 'invalid_grant' });
    }
    if (url.indexOf('api.github.com') !== -1) {
      if (hdr.Authorization !== 'Bearer ' + gh.token) return resp(401, { message: 'Bad credentials' });
      let m;
      if (url.endsWith('/git/matching-refs/heads/deploy/')) {
        if (gh.refsStatus !== 200) return resp(gh.refsStatus, { message: 'nope' });
        return resp(200, Object.keys(gh.refs).filter((k) => gh.refs[k]).map((k) => ({ ref: 'refs/heads/deploy/' + k, object: { sha: gh.refs[k] } })));
      }
      m = url.match(/\/commits\/([0-9a-f]{40})$/);
      if (m) return gh.commits[m[1]] ? resp(200, { sha: m[1], commit: { tree: { sha: 'tree-' + m[1].slice(0, 6) } } }) : resp(404, {});
      m = url.match(/\/git\/trees\/tree-([0-9a-f]{6})\?recursive=1$/);
      if (m) {
        const sha = Object.keys(gh.commits).find((s) => s.slice(0, 6) === m[1]);
        return resp(200, { sha: 'tree', truncated: false, tree: Object.keys(gh.commits[sha]).map((p) => ({ path: p, type: 'blob' })) });
      }
      m = url.match(/\/contents\/(.+)\?ref=([0-9a-f]{40})$/);
      if (m) { const c = gh.commits[m[2]]; const p = decodeURIComponent(m[1]); return c && c[p] !== undefined ? resp(200, c[p]) : resp(404, { message: 'Not Found' }); }
      m = url.match(/\/statuses\/([0-9a-f]{40})$/);
      if (m) { const b = JSON.parse(params.payload); st.statuses.push({ sha: m[1], state: b.state, context: b.context, description: b.description }); return resp(gh.statusesCode, {}); }
      m = url.match(/\/commits\/([0-9a-f]{40})\/comments$/);
      if (m) { st.comments.push({ sha: m[1], body: JSON.parse(params.payload).body }); return resp(201, {}); }
      return resp(404, { message: 'unrouted ' + url });
    }
    if (url.indexOf('script.googleapis.com/v1/projects/' + SCRIPT_ID) !== -1) {
      if (hdr.Authorization !== 'Bearer at-' + st.tokenMints) return resp(401, { error: { message: 'stale token' } });
      const method = (params.method || 'get').toLowerCase();
      const body = params.payload ? JSON.parse(params.payload) : null;
      if (/\/content$/.test(url) && method === 'get') return resp(200, { scriptId: SCRIPT_ID, files: st.headFiles || [] });
      if (/\/content$/.test(url) && method === 'put') { st.puts.push(body.files); st.headFiles = body.files; return resp(200, {}); }
      if (/\/versions$/.test(url) && method === 'post') { const vn = st.versions.length + 1; st.versions.push({ versionNumber: vn, description: body.description }); return resp(200, { versionNumber: vn }); }
      if (/\/versions\?/.test(url)) { const page = url.match(/pageToken=(\d+)/) ? Number(url.match(/pageToken=(\d+)/)[1]) : 0; const slice = st.versions.slice(page * 200, page * 200 + 200); const out = { versions: slice }; if (st.versions.length > (page + 1) * 200) out.nextPageToken = String(page + 1); return resp(200, out); }
      let m = url.match(/\/deployments\/([^/?]+)$/);
      if (m && method === 'get') return st.deployments[m[1]] ? resp(200, { deploymentId: m[1], deploymentConfig: { versionNumber: st.deployments[m[1]].versionNumber } }) : resp(404, {});
      if (m && method === 'put') { st.deployments[m[1]] = { versionNumber: body.deploymentConfig.versionNumber, description: body.deploymentConfig.description }; return resp(200, {}); }
      return resp(404, { error: { message: 'unrouted ' + method + ' ' + url } });
    }
    return resp(500, 'unrouted ' + url);
  }
  const trig = (h) => ({ getHandlerFunction: () => h, getUniqueId: () => 'U-' + h });
  const sb = {
    st, gh,
    UrlFetchApp: { fetch },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (Object.prototype.hasOwnProperty.call(st.props, k) ? st.props[k] : null), setProperty: (k, v) => { st.props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (st.cache[k] === undefined ? null : st.cache[k]), put: (k, v) => { st.cache[k] = String(v); }, putAll: (o) => { Object.keys(o).forEach((k) => { st.cache[k] = String(o[k]); }); }, remove: (k) => { delete st.cache[k]; } }) },
    DriveApp: { getFilesByName: (name) => { const arr = st.drive.filter((f) => f.name === name && !f.trashed); let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; } },
    ScriptApp: {
      getScriptId: () => SCRIPT_ID,
      getProjectTriggers: () => st.triggers.map(trig),
      deleteTrigger: (t) => { st.triggers = st.triggers.filter((h) => h !== t.getHandlerFunction()); },
      newTrigger: (fn) => { const rec = { fn }; const b = { timeBased: () => b, everyMinutes: (n) => { rec.everyMinutes = n; return b; }, create: () => { st.triggers.push(fn); st.created = rec; } }; return b; }
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    MailApp: { sendEmail: (to, subject, body) => { st.mails.push({ to, subject, body }); } },
    Utilities: { computeDigest: (a, s) => Array.from(crypto.createHash('md5').update(String(s)).digest()), base64EncodeWebSafe: (bytes) => Buffer.from(bytes.map((b) => (b + 256) % 256)).toString('base64url'), DigestAlgorithm: { MD5: 'MD5' } },
    console: { log: (m) => st.logs.push(String(m)), warn: (m) => st.logs.push(String(m)) },
    Date, JSON, Math, String, Number, Array, Object, RegExp, Error, encodeURIComponent, decodeURIComponent, isNaN, parseInt
  };
  sb.globalThis = sb;
  const src = opts.runtime ? LIB_SRC.split(PLACEHOLDER).join(opts.runtime) : LIB_SRC;
  vm.createContext(sb);
  vm.runInContext(src, sb, { filename: 'SelfDeploy.js' });
  if (opts.host) vm.runInContext(opts.host, sb, { filename: 'Host.js' });
  sb.state = () => JSON.parse(st.props.GAS_STATE || '{}');
  sb.statusesFor = (ctx) => st.statuses.filter((s) => s.context === ctx);
  return sb;
}
const SEEDED = { GAS_REPO: REPO, GAS_GITHUB_TOKEN: 'gh-ok', GAS_GOOGLE_REFRESH_TOKEN: 'good-refresh', GAS_GOOGLE_CLIENT_ID: 'cid', GAS_GOOGLE_CLIENT_SECRET: 'csec' };
const seedFile = (obj) => ({ name: 'gas-seed-' + SCRIPT_ID + '.json', getBlob: () => ({ getDataAsString: () => (typeof obj === 'string' ? obj : JSON.stringify(obj)) }), setTrashed(v) { this.trashed = v; } });
const HOST_OK = 'function checkDeploy_() { return "page ok, 2 packs"; }\nfunction hello(a, b) { return "hello " + a + b; }\nfunction secret_() { return 1; }\nfunction sleepy() { throw new Error("boom"); }';

test('source pins: version matches gas/VERSION, one placeholder line, every log line tagged', () => {
  assert.equal(/var GAS_SELF_DEPLOY_VERSION = '([^']+)'/.exec(LIB_SRC)[1], fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim());
  assert.equal(LIB_SRC.split(PLACEHOLDER).length - 1, 1, 'exactly one literal placeholder: the stamp line');
  assert.ok(/var GAS_DEPLOYED_SHA = '__GAS_SHA__';/.test(LIB_SRC));
  assert.ok(!/console\.log\((?!'\[gas\] ')/.test(LIB_SRC.replace(/gasLog_\(/g, '')), 'console.log only inside gasLog_');
});

test('seed: both halves taken up into Script Properties and the file trashed; a malformed file is left alone', () => {
  const seed = seedFile({ google: { refresh_token: 'good-refresh', client_id: 'cid', client_secret: 'csec' }, github: { token: 'gh-ok', repo: REPO } });
  const sb = load({ seed });
  assert.equal(sb.gasSeedIngest_(), true);
  assert.equal(sb.st.props.GAS_GOOGLE_REFRESH_TOKEN, 'good-refresh');
  assert.equal(sb.st.props.GAS_REPO, REPO);
  assert.equal(seed.trashed, true);
  const bad = seedFile('not json');
  const sb2 = load({ seed: bad });
  assert.equal(sb2.gasSeedIngest_(), false);
  assert.equal(bad.trashed, undefined);
  const half = seedFile({ github: { token: 'gh-ok', repo: REPO } });
  const sb3 = load({ seed: half });
  assert.equal(sb3.gasSeedIngest_(), true);
  assert.equal(sb3.st.props.GAS_REPO, REPO);
  assert.equal(sb3.st.props.GAS_GOOGLE_REFRESH_TOKEN, undefined);
  assert.equal(sb3.gasSeedIngest_(), false, 'a second call with the github half present and the file gone does nothing');
});

test('an unseeded project ticks without throwing and says what it lacks', () => {
  const sb = load();
  const out = sb.gasDeployTick();
  assert.equal(out.error, undefined);
  assert.ok(sb.st.logs.some((l) => /no GAS_REPO/.test(l)));
  assert.equal(sb.st.fetches.length, 0);
});

test('deploy/test moved: the deployable set is pulled, stamped and written to HEAD; the verdict waits for the next tick', () => {
  const commits = {}; commits[SHA_B] = repoFiles(baseConfig({ buildMarker: { file: 'Page.html', placeholder: '__BUILD_SHA__' } }));
  const sb = load({ props: SEEDED, refs: { test: SHA_B }, commits });
  const out = sb.gasDeployTick();
  assert.equal(out.test.deployed, SHA_B);
  assert.equal(sb.st.puts.length, 1);
  const names = sb.st.puts[0].map((f) => f.name).sort();
  assert.deepEqual(names, ['Code', 'Page', 'SelfDeploy', 'appsscript', 'lib/util'], 'rootDir stripped, folders kept, tests and README left out');
  const byName = Object.fromEntries(sb.st.puts[0].map((f) => [f.name, f]));
  assert.equal(byName.appsscript.type, 'JSON'); assert.equal(byName.Code.type, 'SERVER_JS'); assert.equal(byName.Page.type, 'HTML');
  assert.ok(byName.SelfDeploy.source.indexOf("var GAS_DEPLOYED_SHA = '" + SHA_B + "'") !== -1, 'the library is stamped with the commit');
  assert.ok(byName.SelfDeploy.source.indexOf(PLACEHOLDER) === -1);
  assert.ok(byName.Page.source.indexOf('content="' + SHA_B + '"') !== -1, 'the optional build marker is stamped too');
  const s = sb.state();
  assert.equal(s.test.sha, SHA_B); assert.equal(s.test.pending, true); assert.equal(s.test.attempts, 0);
  assert.equal(sb.st.props.GAS_LAST_DEPLOYED_SHA, SHA_B);
  const st = sb.statusesFor('gas/deploy');
  assert.ok(st.length >= 1 && st.every((x) => x.state === 'pending' && x.sha === SHA_B));
  assert.ok(JSON.parse(sb.st.props.GAS_CONFIG).hooks.postDeploy === 'checkDeploy_', 'the config rides along for later ticks');
  assert.equal(sb.st.mails.length, 0);
  // Idempotent: the same tick again in this (old) runtime only counts a look.
  const again = sb.gasDeployTick();
  assert.equal(again.test.pending, SHA_B); assert.equal(again.test.look, 1);
  assert.equal(sb.st.puts.length, 1, 'nothing rewritten');
});

test('HEAD-only files: a deploy that would delete them is refused in words; preserved ones ride along verbatim; dropUnknown opts into the wipe', () => {
  const headFiles = [
    { name: 'appsscript', type: 'JSON', source: '{}' }, { name: 'Code', type: 'SERVER_JS', source: 'old' }, { name: 'SelfDeploy', type: 'SERVER_JS', source: 'old' },
    { name: 'GlData', type: 'SERVER_JS', source: 'var GL = { "6100": "Fire" };' }, { name: 'AliasData', type: 'SERVER_JS', source: 'var ALIAS = 1;' }
  ];
  // 1. Nothing preserved: refused before anything is written, the names in the status and the mail, and no retry loop.
  let commits = {}; commits[SHA_B] = repoFiles(baseConfig());
  let sb = load({ props: SEEDED, refs: { test: SHA_B }, commits, headFiles: headFiles.map((f) => Object.assign({}, f)) });
  let out = sb.gasDeployTick();
  assert.equal(out.test.refused, SHA_B); assert.deepEqual(JSON.parse(JSON.stringify(out.test.unknown)), ['GlData', 'AliasData']);
  assert.equal(sb.st.puts.length, 0, 'nothing written');
  let st = sb.statusesFor('gas/deploy');
  assert.equal(st[st.length - 1].state, 'failure'); assert.match(st[st.length - 1].description, /GlData, AliasData/); assert.match(st[st.length - 1].description, /would delete them/);
  assert.match(sb.state().test.error, /"preserve"/, 'the full way out is in the record and the mail; the status is capped at 140 chars');
  assert.equal(sb.st.mails.length, 1); assert.match(sb.st.mails[0].subject, /refused/);
  assert.equal(sb.state().test.error.indexOf('refused'), 0);
  const again = sb.gasDeployTick();
  assert.deepEqual(JSON.parse(JSON.stringify(again.test)), { unchanged: SHA_B.slice(0, 7) }, 'a refused commit is judged, not retried every five minutes');
  assert.equal(sb.st.mails.length, 1);
  // 2. Preserved by glob: carried over byte for byte, the rest of the set deployed as usual.
  commits = {}; commits[SHA_B] = repoFiles(baseConfig({ preserve: ['*Data'] }));
  sb = load({ props: SEEDED, refs: { test: SHA_B }, commits, headFiles: headFiles.map((f) => Object.assign({}, f)) });
  out = sb.gasDeployTick();
  assert.equal(out.test.deployed, SHA_B);
  const names = sb.st.puts[0].map((f) => f.name).sort();
  assert.deepEqual(names, ['AliasData', 'Code', 'GlData', 'Page', 'SelfDeploy', 'appsscript', 'lib/util']);
  const gl = sb.st.puts[0].find((f) => f.name === 'GlData');
  assert.deepEqual(gl, { name: 'GlData', type: 'SERVER_JS', source: 'var GL = { "6100": "Fire" };' });
  assert.ok(sb.st.puts[0].find((f) => f.name === 'SelfDeploy').source.indexOf("var GAS_DEPLOYED_SHA = '" + SHA_B + "'") !== -1, 'the repo copy replaced the old library');
  assert.ok(sb.st.logs.some((l) => /carrying over 2 file\(s\).*GlData, AliasData/.test(l)));
  assert.equal(sb.st.mails.length, 0);
  // 3. dropUnknown: the repo is the whole truth; what it lacks is dropped and named.
  commits = {}; commits[SHA_B] = repoFiles(baseConfig({ dropUnknown: true }));
  sb = load({ props: SEEDED, refs: { test: SHA_B }, commits, headFiles: headFiles.map((f) => Object.assign({}, f)) });
  out = sb.gasDeployTick();
  assert.equal(out.test.deployed, SHA_B);
  assert.deepEqual(sb.st.puts[0].map((f) => f.name).sort(), ['Code', 'Page', 'SelfDeploy', 'appsscript', 'lib/util']);
  assert.ok(sb.st.logs.some((l) => /dropping 2 file\(s\).*GlData, AliasData/.test(l)));
});

test('the next tick, running the deployed build, runs the host hook and records success', () => {
  const commits = {}; commits[SHA_B] = repoFiles(baseConfig());
  const pending = { test: { sha: SHA_B, pending: true, attempts: 1, at: 'x', files: 5, bytes: 100 } };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(pending), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { test: SHA_B }, commits, runtime: SHA_B, host: HOST_OK });
  const out = sb.gasDeployTick();
  assert.equal(out.test.ok, true);
  assert.equal(out.test.checks.hook, 'page ok, 2 packs');
  const s = sb.state();
  assert.equal(s.test.ok, true); assert.equal(s.test.pending, false); assert.equal(s.test.files, 5);
  const st = sb.statusesFor('gas/deploy');
  assert.equal(st[st.length - 1].state, 'success');
  assert.ok(/verified on HEAD/.test(st[st.length - 1].description));
  assert.equal(sb.st.puts.length, 0, 'verification writes nothing');
  assert.equal(sb.st.mails.length, 0);
  assert.equal(sb.gasDeployTick().test.unchanged, SHA_B.slice(0, 7), 'and then the ref is simply current');
});

test('a hook that throws fails the deploy: failure status, owner mailed, nothing promoted', () => {
  const pending = { test: { sha: SHA_B, pending: true, attempts: 0 } };
  const cfg = baseConfig({ hooks: { postDeploy: 'sleepy' } });
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(pending), GAS_CONFIG: JSON.stringify(cfg) }), refs: { test: SHA_B, prod: SHA_B }, runtime: SHA_B, host: HOST_OK });
  const out = sb.gasDeployTick();
  assert.equal(out.test.ok, false); assert.match(out.test.error, /boom/);
  assert.equal(sb.statusesFor('gas/deploy').pop().state, 'failure');
  assert.equal(sb.st.mails.length, 1); assert.match(sb.st.mails[0].subject, /FAILED/);
  assert.equal(sb.st.versions.length, 0, 'prod is not promoted on a failed test');
  assert.match(out.prod.waiting, /FAILED/);
  assert.equal(sb.statusesFor('gas/promote').pop().state, 'failure');
});

test('a hook named in gas.json that does not exist is a failure in words, not a silent pass', () => {
  const pending = { test: { sha: SHA_B, pending: true, attempts: 0 } };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(pending), GAS_CONFIG: JSON.stringify(baseConfig({ hooks: { postDeploy: 'nope_' } })) }), refs: { test: SHA_B }, runtime: SHA_B });
  const out = sb.gasDeployTick();
  assert.equal(out.test.ok, false); assert.match(out.test.error, /no such function/);
});

test('no hook declared: the deploy verifies on the runtime marker alone', () => {
  const pending = { test: { sha: SHA_B, pending: true, attempts: 0 } };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(pending), GAS_CONFIG: JSON.stringify(baseConfig({ hooks: {} })) }), refs: { test: SHA_B }, runtime: SHA_B });
  const out = sb.gasDeployTick();
  assert.equal(out.test.ok, true); assert.equal(out.test.checks.hook, 'none declared');
});

test('a build no tick ever runs fails after the bounded number of looks, naming the trigger-binding rule', () => {
  const pending = { test: { sha: SHA_B, pending: true, attempts: 4 } };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(pending), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { test: SHA_B }, runtime: SHA_A });
  const first = sb.gasDeployTick();
  assert.equal(first.test.look, 5);
  const second = sb.gasDeployTick();
  assert.equal(second.test.verified, false);
  assert.match(second.test.error, /bound to a versioned deployment/);
  assert.equal(sb.statusesFor('gas/deploy').pop().state, 'failure');
  assert.equal(sb.st.mails.length, 1);
  assert.equal(sb.state().test.pending, false);
});

test('deploy/prod: promoted only after deploy/test verified the same commit; one version, PROD moved, read back', () => {
  const okState = { test: { sha: SHA_B, pending: false, ok: true }, prod: { sha: SHA_A, version: 3 } };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(okState), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { test: SHA_B, prod: SHA_B }, runtime: SHA_B, versionCount: 3, prodVersion: 3 });
  const out = sb.gasDeployTick();
  assert.equal(out.prod.versionNumber, 4);
  assert.equal(sb.st.deployments[PROD].versionNumber, 4);
  assert.match(sb.st.versions[3].description, /deploy\/prod moved/);
  assert.equal(sb.statusesFor('gas/promote').pop().state, 'success');
  assert.equal(sb.st.mails.length, 1); assert.match(sb.st.mails[0].subject, /PROD promoted to version 4/); assert.ok(!/FAIL/.test(sb.st.mails[0].subject));
  assert.equal(sb.state().prod.sha, SHA_B);
  assert.equal(sb.gasDeployTick().prod.unchanged, SHA_B.slice(0, 7));
});

test('deploy/prod ahead of deploy/test waits, with a pending status that says so, and promotes once test catches up', () => {
  const commits = {}; commits[SHA_B] = repoFiles(baseConfig());
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify({ test: { sha: SHA_A, ok: true } }), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { test: SHA_B, prod: SHA_B }, commits, runtime: SHA_A, versionCount: 1, prodVersion: 1 });
  const out = sb.gasDeployTick();
  assert.equal(out.test.deployed, SHA_B);
  assert.match(out.prod.waiting, /waiting for deploy\/test/);
  assert.equal(sb.statusesFor('gas/promote').pop().state, 'pending');
  assert.equal(sb.st.versions.length, 1);
  assert.equal(sb.gasDeployTick().prod.waiting !== undefined, true, 'still waiting while pending');
  assert.equal(sb.statusesFor('gas/promote').length, 1, 'the waiting status is written once, not every tick');
});

test('the version cap: refused at 199 in words, warned at 180', () => {
  const okState = { test: { sha: SHA_B, ok: true } };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(okState), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { prod: SHA_B }, runtime: SHA_B, versionCount: 199, prodVersion: 199 });
  const out = sb.gasDeployTick();
  assert.match(out.prod.error, /promote refused: the project holds 199 of 200/);
  assert.equal(sb.st.versions.length, 199);
  assert.equal(sb.statusesFor('gas/promote').pop().state, 'failure');
  const sb2 = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify(okState), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { prod: SHA_B }, runtime: SHA_B, versionCount: 179, prodVersion: 179 });
  sb2.gasDeployTick();
  assert.ok(sb2.st.mails.some((m) => /180 of 200/.test(m.subject)));
});

test('deploy/run: the request runs on this runtime and reports through status, comment and log; private and library names refused', () => {
  const commits = {}; commits[SHA_R] = { 'gas-run.json': JSON.stringify({ id: 'r1', fn: 'hello', args: ['x', 1] }) };
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { run: SHA_R }, commits, runtime: SHA_B, host: HOST_OK });
  const out = sb.gasDeployTick();
  assert.equal(out.run.ok, true); assert.equal(out.run.result, 'hello x1'); assert.equal(out.run.id, 'r1');
  const st = sb.statusesFor('gas/run').pop();
  assert.equal(st.state, 'success'); assert.match(st.description, /ok hello id=r1/); assert.match(st.description, /hello x1/);
  assert.equal(sb.st.comments.length, 1); assert.match(sb.st.comments[0].body, /hello x1/);
  assert.ok(sb.st.logs.some((l) => /\[gas-run\] ok hello/.test(l)));
  assert.equal(sb.gasDeployTick().run.unchanged, SHA_R.slice(0, 7), 'a request runs once');
  for (const bad of ['secret_', 'gasDeployTick', 'nope']) {
    const c = {}; c[SHA_C] = { 'gas-run.json': JSON.stringify({ id: 'r2', fn: bad }) };
    const s2 = load({ props: Object.assign({}, SEEDED, { GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { run: SHA_C }, commits: c, runtime: SHA_B, host: HOST_OK });
    const o = s2.gasDeployTick();
    assert.equal(o.run.ok, false, bad);
    assert.equal(s2.statusesFor('gas/run').pop().state, 'failure');
  }
  const allow = {}; allow[SHA_C] = { 'gas-run.json': JSON.stringify({ id: 'r3', fn: 'hello', args: ['a', 'b'] }) };
  const s3 = load({ props: Object.assign({}, SEEDED, { GAS_CONFIG: JSON.stringify(baseConfig({ runnable: ['other'] })) }), refs: { run: SHA_C }, commits: allow, runtime: SHA_B, host: HOST_OK });
  assert.match(s3.gasDeployTick().run.error, /outside gas\.json `runnable`/);
});

test('an idle tick is one GitHub call and no Google call', () => {
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_STATE: JSON.stringify({ test: { sha: SHA_B, ok: true }, prod: { sha: SHA_B, version: 2 }, run: { sha: SHA_R } }), GAS_CONFIG: JSON.stringify(baseConfig()) }), refs: { test: SHA_B, prod: SHA_B, run: SHA_R }, runtime: SHA_B });
  sb.gasDeployTick();
  assert.equal(sb.st.fetches.length, 1);
  assert.match(sb.st.fetches[0], /matching-refs\/heads\/deploy\/$/);
});

test('gas.json naming another script id is refused before anything is written', () => {
  const commits = {}; commits[SHA_B] = repoFiles(baseConfig({ scriptId: '1OTHER' }));
  const sb = load({ props: SEEDED, refs: { test: SHA_B }, commits });
  const out = sb.gasDeployTick();
  assert.match(out.error, /another project's repo/);
  assert.equal(sb.st.puts.length, 0);
  assert.equal(sb.st.mails.length, 1);
});

test('a dead GitHub token: the tick reports it, mails once an hour, never loops on mail', () => {
  const sb = load({ props: SEEDED, refs: { test: SHA_B }, refsStatus: 401 });
  const a = sb.gasDeployTick(); const b = sb.gasDeployTick();
  assert.match(a.error, /re-seed GAS_GITHUB_TOKEN/); assert.match(b.error, /re-seed/);
  assert.equal(sb.st.mails.length, 1);
});

test('a lock left by a running tick skips the next one; the lock is released after a tick', () => {
  const sb = load({ props: SEEDED });
  sb.st.cache.GAS_TICK_LOCK = '1';
  assert.equal(sb.gasDeployTick().skipped, 'locked');
  delete sb.st.cache.GAS_TICK_LOCK;
  sb.gasDeployTick();
  assert.equal(sb.st.cache.GAS_TICK_LOCK, undefined);
});

test('gasInstall creates the tick trigger once; gasStatus reports; gasPromoteNow needs a prod id', () => {
  const sb = load({ props: Object.assign({}, SEEDED, { GAS_CONFIG: JSON.stringify(baseConfig({ pollMinutes: 7 })) }), runtime: SHA_B, headFiles: [{ name: 'SelfDeploy', type: 'SERVER_JS', source: "var GAS_DEPLOYED_SHA = '" + SHA_B + "';" }], versionCount: 2, prodVersion: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(sb.gasInstall())), { installed: true, trigger: 'gasDeployTick', everyMinutes: 7, version: sb.GAS_SELF_DEPLOY_VERSION });
  assert.equal(sb.st.created.everyMinutes, 7);
  assert.equal(sb.gasInstall().installed, false);
  assert.equal(sb.gasStatus().triggerInstalled, true);
  assert.equal(sb.gasStatus().runtime, SHA_B);
  const r = sb.gasPromoteNow('sunday guard');
  assert.equal(r.versionNumber, 3); assert.equal(r.sha, SHA_B);
  assert.equal(sb.gasUninstall().removed, 1);
  const bare = load({ props: SEEDED });
  assert.throws(() => bare.gasPromoteNow('x'), /no prod\.deploymentId/);
});

test('a token refresh is cached and retried once on a 401; a dead refresh token says how to re-seed', () => {
  const sb = load({ props: SEEDED, versionCount: 2 });
  assert.equal(sb.gasVersionCount_(), 2); assert.equal(sb.gasVersionCount_(), 2);
  assert.equal(sb.st.tokenMints, 1);
  const dead = load({ props: Object.assign({}, SEEDED, { GAS_GOOGLE_REFRESH_TOKEN: 'dead' }) });
  assert.throws(() => dead.gasVersionCount_(), /re-seed it/);
});

test('the glob: **, *, ? and literal dots behave as documented', () => {
  const sb = load();
  const m = (glob, p) => sb.gasGlobToRegExp_(glob).test(p);
  assert.ok(m('**/*.js', 'Code.js')); assert.ok(m('**/*.js', 'lib/a/b.js')); assert.ok(!m('**/*.js', 'Code.jsx'));
  assert.ok(m('*.js', 'Code.js')); assert.ok(!m('*.js', 'lib/Code.js'));
  assert.ok(m('tests/**', 'tests/x.js')); assert.ok(m('tests/**', 'tests/deep/y.js')); assert.ok(!m('tests/**', 'tests2/x.js'));
  assert.ok(m('**/*.test.js', 'a.test.js')); assert.ok(!m('**/*.test.js', 'atest.js'));
  assert.ok(m('Page?.html', 'Page1.html')); assert.ok(!m('Page?.html', 'Page10.html'));
});
