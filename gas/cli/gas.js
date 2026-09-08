#!/usr/bin/env node
'use strict';
// gas — the Apps Script CLI that replaces clasp for AAC repos. Zero dependencies, Node 18+.
//
//   node <claude-dotfiles>/gas/cli/gas.js <command> [args]
//
// Credentials: ~/.config/gas/credentials.json (or GAS_CREDENTIALS_JSON in the environment), minted by
// `gas login` from clasp's PUBLISHED OAuth client. That client's refresh tokens have no seven-day expiry;
// the private client in gpt-sheets-access-475817 (consent screen in Testing) does, which is why every
// CLASPRC_JSON ever stored in GitHub died weekly. GitHub calls take GITHUB_TOKEN / GH_TOKEN, else
// `gh auth token`.
//
// Commands
//   login [--paste] [--no-browser]      OAuth consent once per account; loopback redirect, or paste the
//                                       redirect URL when no browser can reach this machine.
//   import-clasprc [path]               Take an existing ~/.clasprc.json (any client) as the credential.
//   whoami                              Which account, which scopes, when the access token expires.
//   scripts                             Every Apps Script project the account can see in Drive.
//   seed <scriptId> --repo o/r [--github-token T | --github-token-env NAME]
//                                       Write gas-seed-<scriptId>.json to Drive for the script to ingest.
//   pull <scriptId> [--out dir] [--version N]
//   push <scriptId> --dir <rootDir> [--sha S]   Write HEAD from disk (bootstrap or emergency; stamps S).
//   versions <scriptId> | deployments <scriptId>
//   promote <scriptId> --deployment ID [--desc text]   Cut a version of HEAD and move a deployment to it.
//   logs [--project P] [--minutes 60] [--filter F] [--limit 200] [--all]   Cloud Logging, [gas] lines by default.
//   status <owner/repo>                 deploy/* refs and the latest gas/* status on each.
//   ref <owner/repo> <deploy/test|deploy/prod> <sha> [--wait minutes]   Move a ref; wait for its status.
//   run <owner/repo> <fn> [argsJson] [--wait minutes]   Push a run request to deploy/run; print the result.
//   vendor <repoRoot>                   Copy the library into the repo's rootDir (gas.json says where).
//   init <repoRoot> --script-id ID [--root-dir gas] [--prod-deployment ID] [--gcp-project P]
//
// Exit 0 ok / 1 the call answered no / 2 could not get an answer (2 is not a pass).

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const cp = require('child_process');

const VERSION = readVersion();
// clasp's own public OAuth client. Public by Google's design for installed apps; printed in clasp's source.
const PUBLISHED_CLIENT = {
  client_id: '1072944905499-vm2v2i5dvn0a0d2o4ca36i1vge8cvbn0.apps.googleusercontent.com',
  client_secret: 'v6V3fKV_zWU7iw1DrpO1rknX'
};
const LOGIN_SCOPES = [
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.webapp.deploy',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/logging.read',
  'https://www.googleapis.com/auth/userinfo.email'
];
const CRED_PATH = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'gas', 'credentials.json');
const SCRIPT_API = 'https://script.googleapis.com/v1/projects/';
const GITHUB_API = 'https://api.github.com';
const SEED_PREFIX = 'gas-seed-';
const REF_PREFIX = 'deploy/';
const STATUS = { deploy: 'gas/deploy', promote: 'gas/promote', run: 'gas/run' };
const RUN_FILE = 'gas-run.json';

function readVersion() {
  try { return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); } catch (e) { return '0.0.0'; }
}

// ---------------------------------------------------------------------------------------------
// HTTP (proxy-aware: HTTPS_PROXY via CONNECT, CA from GAS_CA_FILE / SSL_CERT_FILE / NODE_EXTRA_CA_CERTS)
// ---------------------------------------------------------------------------------------------
function caBundle() {
  const f = process.env.GAS_CA_FILE || process.env.SSL_CERT_FILE;
  try { return f ? fs.readFileSync(f) : undefined; } catch (e) { return undefined; }
}
function request(method, url, headers, body, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : (Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ 'User-Agent': 'gas-cli/' + VERSION }, headers || {});
    if (data != null) h['Content-Length'] = Buffer.byteLength(data);
    const ca = caBundle();
    const onResp = (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (opts.followRedirects && resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          return resolve(request('GET', resp.headers.location, { 'User-Agent': h['User-Agent'] }, null, opts));
        }
        resolve({ status: resp.statusCode, headers: resp.headers, text });
      });
    };
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
    if (proxy && u.protocol === 'https:') {
      const p = new URL(proxy);
      const creq = http.request({ host: p.hostname, port: p.port || 80, method: 'CONNECT', path: u.hostname + ':' + (u.port || 443) });
      creq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) return reject(new Error('proxy CONNECT to ' + u.hostname + ' answered ' + res.statusCode));
        const r = https.request({ host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers: h, socket, agent: false, ca, servername: u.hostname }, onResp);
        r.on('error', reject); if (data != null) r.write(data); r.end();
      });
      creq.on('error', reject); creq.end();
      return;
    }
    const mod = u.protocol === 'https:' ? https : http;
    const r = mod.request({ host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method, headers: h, ca }, onResp);
    r.on('error', reject); if (data != null) r.write(data); r.end();
  });
}
async function json(method, url, headers, body, opts) {
  const r = await request(method, url, headers, body, opts);
  let parsed = null;
  try { parsed = r.text ? JSON.parse(r.text) : {}; } catch (e) { parsed = null; }
  return { status: r.status, body: parsed, text: r.text };
}

// ---------------------------------------------------------------------------------------------
// Google credential
// ---------------------------------------------------------------------------------------------
function loadCredentials() {
  if (process.env.GAS_CREDENTIALS_JSON) return normalizeCredentials(JSON.parse(process.env.GAS_CREDENTIALS_JSON));
  if (fs.existsSync(CRED_PATH)) return normalizeCredentials(JSON.parse(fs.readFileSync(CRED_PATH, 'utf8')));
  throw new Error('no credential at ' + CRED_PATH + ' and GAS_CREDENTIALS_JSON is unset — run `gas login` (or `gas import-clasprc`)');
}
// Accepts this tool's shape, a raw ~/.clasprc.json (clasp 2 or 3), or a bare token object.
function normalizeCredentials(raw) {
  const t = (raw && raw.tokens && raw.tokens.default) || (raw && raw.token) || raw || {};
  const c = raw && raw.oauth2ClientSettings ? raw.oauth2ClientSettings : {};
  const out = {
    client_id: t.client_id || t.clientId || c.clientId || raw.client_id || '',
    client_secret: t.client_secret || t.clientSecret || c.clientSecret || raw.client_secret || '',
    refresh_token: t.refresh_token || raw.refresh_token || '',
    scopes: raw.scopes || (t.scope ? String(t.scope).split(' ') : []),
    account: raw.account || ''
  };
  if (!out.client_id || !out.client_secret || !out.refresh_token) throw new Error('credential lacks client_id, client_secret or refresh_token');
  return out;
}
function saveCredentials(cred) {
  fs.mkdirSync(path.dirname(CRED_PATH), { recursive: true });
  fs.writeFileSync(CRED_PATH, JSON.stringify(cred, null, 2) + '\n', { mode: 0o600 });
  return CRED_PATH;
}
let accessTokenCache = null;
async function accessToken(force) {
  if (!force && accessTokenCache && accessTokenCache.exp > Date.now() / 1000 + 60) return accessTokenCache.token;
  const cred = loadCredentials();
  const form = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(cred.refresh_token)
    + '&client_id=' + encodeURIComponent(cred.client_id) + '&client_secret=' + encodeURIComponent(cred.client_secret);
  const r = await json('POST', 'https://oauth2.googleapis.com/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, form);
  if (!r.body || !r.body.access_token) throw new Error('token refresh failed (' + r.status + '): ' + (r.text || '').slice(0, 200) + ' — the refresh token is dead or revoked; run `gas login` again');
  accessTokenCache = { token: r.body.access_token, exp: Date.now() / 1000 + Number(r.body.expires_in || 3600) };
  return accessTokenCache.token;
}
async function gauth() { return { Authorization: 'Bearer ' + (await accessToken()) }; }
async function gapi(method, url, body, opts) {
  let r = await json(method, url, Object.assign({ 'Content-Type': 'application/json' }, await gauth()), body, opts);
  if (r.status === 401) r = await json(method, url, Object.assign({ 'Content-Type': 'application/json' }, { Authorization: 'Bearer ' + (await accessToken(true)) }), body, opts);
  if (r.status < 200 || r.status >= 300) throw new Error(method + ' ' + url.replace(/\?.*$/, '') + ' answered ' + r.status + ': ' + (r.text || '').slice(0, 300));
  return r.body;
}

// The consent, once. Loopback redirect on a random port; --paste reads the redirect URL from stdin for a
// machine no browser can reach (a cloud container: open the URL anywhere, paste the localhost URL back).
async function login(flags) {
  const port = await freePort();
  const redirect = 'http://localhost:' + port;
  const state = crypto.randomBytes(16).toString('hex');
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + [
    'client_id=' + encodeURIComponent(PUBLISHED_CLIENT.client_id), 'redirect_uri=' + encodeURIComponent(redirect),
    'response_type=code', 'access_type=offline', 'prompt=consent', 'state=' + state,
    'scope=' + encodeURIComponent(LOGIN_SCOPES.join(' '))].join('&');
  console.log('Open this URL and grant access:\n\n  ' + url + '\n');
  let code = null;
  if (flags.paste) {
    console.log('When the browser lands on a localhost URL that will not load, paste that whole URL here:');
    const line = await readLine();
    code = codeFromRedirect(line, state);
  } else {
    code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const c = codeFromRedirect('http://localhost' + req.url, state);
          res.end('gas: signed in. You can close this tab.');
          server.close(); resolve(c);
        } catch (e) { res.statusCode = 400; res.end(String(e.message)); }
      });
      server.listen(port, '127.0.0.1');
      setTimeout(() => { server.close(); reject(new Error('no redirect arrived in 10 minutes — retry with --paste')); }, 600000).unref();
    });
  }
  const form = 'code=' + encodeURIComponent(code) + '&client_id=' + encodeURIComponent(PUBLISHED_CLIENT.client_id)
    + '&client_secret=' + encodeURIComponent(PUBLISHED_CLIENT.client_secret) + '&redirect_uri=' + encodeURIComponent(redirect) + '&grant_type=authorization_code';
  const r = await json('POST', 'https://oauth2.googleapis.com/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, form);
  if (!r.body || !r.body.refresh_token) throw new Error('token exchange failed (' + r.status + '): ' + (r.text || '').slice(0, 300));
  const cred = { client_id: PUBLISHED_CLIENT.client_id, client_secret: PUBLISHED_CLIENT.client_secret, refresh_token: r.body.refresh_token, scopes: String(r.body.scope || '').split(' '), account: '' };
  accessTokenCache = { token: r.body.access_token, exp: Date.now() / 1000 + Number(r.body.expires_in || 3600) };
  const who = await json('GET', 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(r.body.access_token));
  cred.account = (who.body && who.body.email) || '';
  const where = saveCredentials(cred);
  console.log('Signed in as ' + (cred.account || '(unknown)') + '; credential written to ' + where);
  return cred;
}
function codeFromRedirect(urlText, expectedState) {
  const m = /[?&]code=([^&\s]+)/.exec(String(urlText || ''));
  if (!m) throw new Error('no `code=` in what was pasted');
  const s = /[?&]state=([^&\s]+)/.exec(String(urlText));
  if (expectedState && s && decodeURIComponent(s[1]) !== expectedState) throw new Error('state mismatch — paste the URL from THIS login attempt');
  return decodeURIComponent(m[1]);
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject);
  });
}
function readLine() {
  return new Promise((resolve) => { let buf = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => { buf += d; if (buf.indexOf('\n') !== -1) { process.stdin.pause(); resolve(buf.split('\n')[0].trim()); } }); });
}
async function importClasprc(file) {
  const p = file || path.join(os.homedir(), '.clasprc.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const cred = normalizeCredentials(raw);
  const priv = !/^1072944905499-/.test(cred.client_id);
  const who = await json('GET', 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(await (async () => { accessTokenCache = null; process.env.GAS_CREDENTIALS_JSON = JSON.stringify(cred); return accessToken(true); })()));
  cred.account = (who.body && who.body.email) || '';
  cred.scopes = String((who.body && who.body.scope) || '').split(' ').filter(Boolean);
  delete process.env.GAS_CREDENTIALS_JSON;
  const where = saveCredentials(cred);
  console.log('Imported ' + p + ' as ' + (cred.account || '(unknown)') + ' → ' + where);
  if (priv) console.log('WARNING: this token belongs to a private OAuth client (' + cred.client_id.slice(0, 14) + '…). If that client\'s consent screen is in Testing, the token dies in seven days; `gas login` mints one that does not.');
  return cred;
}
async function whoami() {
  const tok = await accessToken();
  const r = await json('GET', 'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(tok));
  if (r.status !== 200) throw new Error('tokeninfo answered ' + r.status + ': ' + r.text.slice(0, 200));
  const cred = loadCredentials();
  const out = { email: r.body.email, client_id: cred.client_id, published_client: /^1072944905499-/.test(cred.client_id), expires_in_s: Number(r.body.expires_in || 0), scopes: String(r.body.scope || '').split(' ').filter(Boolean) };
  console.log(JSON.stringify(out, null, 2));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Apps Script API
// ---------------------------------------------------------------------------------------------
const scriptName = (rel) => String(rel).replace(/\\/g, '/').replace(/\.(json|js|gs|html)$/i, '');
const scriptType = (rel) => /\.json$/i.test(rel) ? 'JSON' : (/\.(js|gs)$/i.test(rel) ? 'SERVER_JS' : 'HTML');
const extFor = (type) => type === 'JSON' ? '.json' : (type === 'SERVER_JS' ? '.js' : '.html');
async function getContent(scriptId, version) {
  return gapi('GET', SCRIPT_API + scriptId + '/content' + (version ? '?versionNumber=' + Number(version) : ''));
}
function deployedShaOf(files) {
  for (const f of files || []) { const m = /var GAS_DEPLOYED_SHA = '([0-9a-f]{40}|[^']*)'/.exec(f.source || ''); if (m) return m[1]; }
  return '';
}
async function pull(scriptId, flags) {
  const content = await getContent(scriptId, flags.version);
  const out = flags.out || '.';
  let n = 0;
  for (const f of content.files || []) {
    const p = path.join(out, f.name + extFor(f.type));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.source || '');
    n++;
  }
  console.log('pulled ' + n + ' files from ' + scriptId + (flags.version ? ' @v' + flags.version : ' (HEAD)') + ' into ' + out + '; build ' + (deployedShaOf(content.files) || 'unstamped'));
  return n;
}
// Everything under dir that gas.json (if present beside/above dir) or the defaults include.
function localDeployables(dir, cfg) {
  cfg = normalizeConfig(cfg || {});
  const files = [];
  const walk = (d, rel) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) { if (ent.name === 'node_modules' || ent.name === '.git') continue; walk(path.join(d, ent.name), r); }
      else if (matchesAny(r, cfg.include) && !matchesAny(r, cfg.exclude)) files.push(r);
    }
  };
  walk(dir, '');
  return files.sort();
}
async function push(scriptId, flags) {
  if (!flags.dir) throw new Error('push needs --dir <rootDir>');
  const cfg = readGasJson(findRepoRoot(flags.dir)) || {};
  const rel = localDeployables(flags.dir, cfg);
  if (rel.indexOf('appsscript.json') === -1) throw new Error('no appsscript.json under ' + flags.dir);
  const sha = flags.sha || ('local-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14));
  const files = rel.map((r) => {
    let src = fs.readFileSync(path.join(flags.dir, r), 'utf8');
    if (src.indexOf('var GAS_DEPLOYED_SHA = ') !== -1) src = src.split('__GAS_' + 'SHA__').join(sha);
    if (cfg.buildMarker && cfg.buildMarker.file === r) src = src.split(cfg.buildMarker.placeholder || '__BUILD_SHA__').join(sha);
    return { name: scriptName(r), type: scriptType(r), source: src };
  });
  await gapi('PUT', SCRIPT_API + scriptId + '/content', { files });
  const back = await getContent(scriptId);
  console.log('pushed ' + files.length + ' files to HEAD of ' + scriptId + '; HEAD reads build ' + (deployedShaOf(back.files) || 'unstamped'));
  return files.length;
}
async function versions(scriptId) {
  let token = '', all = [];
  do {
    const page = await gapi('GET', SCRIPT_API + scriptId + '/versions?pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    all = all.concat(page.versions || []); token = page.nextPageToken || '';
  } while (token);
  const latest = all.reduce((m, v) => (!m || Number(v.versionNumber) > Number(m.versionNumber) ? v : m), null);
  console.log('versions: ' + all.length + ' of 200' + (latest ? '; latest v' + latest.versionNumber + ' ' + (latest.description || '') : ''));
  return all;
}
async function deployments(scriptId) {
  const r = await gapi('GET', SCRIPT_API + scriptId + '/deployments?pageSize=50');
  for (const d of r.deployments || []) {
    const c = d.deploymentConfig || {};
    console.log(d.deploymentId + '  ' + (c.versionNumber ? 'v' + c.versionNumber : 'HEAD') + '  ' + (c.description || '') + '  ' + (d.updateTime || ''));
  }
  return r.deployments || [];
}
async function promote(scriptId, flags) {
  if (!flags.deployment) throw new Error('promote needs --deployment <id>');
  const all = await versions(scriptId);
  if (all.length >= 199) throw new Error('promote refused: ' + all.length + ' of 200 versions used — delete old versions in the editor');
  const v = await gapi('POST', SCRIPT_API + scriptId + '/versions', { description: flags.desc || 'gas promote' });
  await gapi('PUT', SCRIPT_API + scriptId + '/deployments/' + flags.deployment, { deploymentConfig: { scriptId, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: flags.desc || 'gas promote' } });
  const back = await gapi('GET', SCRIPT_API + scriptId + '/deployments/' + flags.deployment);
  const got = (back.deploymentConfig || {}).versionNumber;
  if (got !== v.versionNumber) throw new Error('deployment reads v' + got + ' after moving to v' + v.versionNumber);
  console.log('deployment ' + flags.deployment + ' is at v' + got);
  return got;
}
async function scripts() {
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.script' and trashed=false");
  const r = await gapi('GET', 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name,modifiedTime)&pageSize=100');
  for (const f of r.files || []) console.log(f.id + '  ' + f.name + '  ' + f.modifiedTime);
  return r.files || [];
}

// ---------------------------------------------------------------------------------------------
// Seeding: the one Drive file the script ingests and trashes
// ---------------------------------------------------------------------------------------------
function seedPayload(cred, github) {
  const out = { google: { refresh_token: cred.refresh_token, client_id: cred.client_id, client_secret: cred.client_secret } };
  if (github && github.token && github.repo) out.github = { token: github.token, repo: github.repo };
  return out;
}
async function seed(scriptId, flags) {
  const cred = loadCredentials();
  const ghToken = flags['github-token'] || (flags['github-token-env'] ? process.env[flags['github-token-env']] : '') || process.env.GAS_GITHUB_TOKEN || '';
  if (!flags.repo) throw new Error('seed needs --repo owner/name');
  if (!ghToken) throw new Error('seed needs a GitHub token: --github-token, --github-token-env NAME, or GAS_GITHUB_TOKEN');
  const name = SEED_PREFIX + scriptId + '.json';
  const payload = seedPayload(cred, { token: ghToken, repo: flags.repo });
  const boundary = 'gas' + crypto.randomBytes(8).toString('hex');
  const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name, mimeType: 'application/json' })
    + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(payload) + '\r\n--' + boundary + '--';
  const r = await json('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', Object.assign({ 'Content-Type': 'multipart/related; boundary=' + boundary }, await gauth()), body);
  if (r.status !== 200) throw new Error('Drive upload answered ' + r.status + ': ' + r.text.slice(0, 300));
  console.log('seed written to Drive as ' + name + ' (file ' + r.body.id + '). The script ingests it on its next tick and trashes it; run gasInstall() once in the editor if the tick trigger is not installed yet.');
  return r.body;
}

// ---------------------------------------------------------------------------------------------
// Cloud Logging
// ---------------------------------------------------------------------------------------------
async function logs(flags) {
  const project = flags.project || (readGasJson(findRepoRoot(process.cwd())) || {}).gcpProject;
  if (!project) throw new Error('logs needs --project <gcp project id> (or gcpProject in gas.json)');
  const minutes = Number(flags.minutes || 60);
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const base = 'timestamp>="' + since + '"';
  const filter = flags.filter ? base + ' AND (' + flags.filter + ')' : (flags.all ? base : base + ' AND (textPayload:"[gas]" OR jsonPayload.message:"[gas]")');
  const r = await gapi('POST', 'https://logging.googleapis.com/v2/entries:list', { resourceNames: ['projects/' + project], filter, orderBy: 'timestamp asc', pageSize: Math.min(Number(flags.limit || 200), 1000) });
  for (const e of r.entries || []) {
    const msg = e.textPayload || (e.jsonPayload && (e.jsonPayload.message || JSON.stringify(e.jsonPayload))) || '';
    console.log(e.timestamp + ' ' + (e.severity || '') + ' ' + String(msg).replace(/\s+/g, ' ').slice(0, 400));
  }
  console.log('-- ' + (r.entries || []).length + ' entries' + (r.nextPageToken ? ' (more; raise --limit)' : ''));
  return r.entries || [];
}

// ---------------------------------------------------------------------------------------------
// GitHub: refs, statuses, run requests
// ---------------------------------------------------------------------------------------------
function githubToken() {
  const t = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (t) return t;
  try { return cp.execFileSync('gh', ['auth', 'token'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { return ''; }
}
async function gh(method, suffix, body) {
  const tok = githubToken();
  if (!tok) throw new Error('no GitHub token: set GITHUB_TOKEN or sign in with `gh auth login`');
  const r = await json(method, GITHUB_API + suffix, { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body);
  return r;
}
async function refs(repo) {
  const r = await gh('GET', '/repos/' + repo + '/git/matching-refs/heads/' + REF_PREFIX);
  if (r.status !== 200) throw new Error('matching-refs answered ' + r.status + ': ' + (r.text || '').slice(0, 200));
  const out = {};
  for (const x of r.body || []) out[String(x.ref).replace(/^refs\/heads\//, '')] = x.object.sha;
  return out;
}
async function latestStatus(repo, sha, context) {
  const r = await gh('GET', '/repos/' + repo + '/commits/' + sha + '/statuses?per_page=100');
  if (r.status !== 200) return null;
  const mine = (r.body || []).filter((s) => s.context === context);
  return mine.length ? mine[0] : null;                           // newest first
}
async function status(repo) {
  const all = await refs(repo);
  const rows = [];
  for (const name of [REF_PREFIX + 'test', REF_PREFIX + 'prod', REF_PREFIX + 'run']) {
    const sha = all[name];
    const ctx = name.endsWith('test') ? STATUS.deploy : (name.endsWith('prod') ? STATUS.promote : STATUS.run);
    const st = sha ? await latestStatus(repo, sha, ctx) : null;
    rows.push({ ref: name, sha: sha ? sha.slice(0, 7) : '-', status: st ? st.state : (sha ? 'no status yet' : '-'), description: st ? st.description : '', at: st ? st.updated_at : '' });
  }
  for (const row of rows) console.log(row.ref.padEnd(12) + row.sha.padEnd(9) + row.status.padEnd(15) + row.description + (row.at ? '  (' + row.at + ')' : ''));
  return rows;
}
async function moveRef(repo, name, sha) {
  const r = await gh('PATCH', '/repos/' + repo + '/git/refs/heads/' + name, { sha, force: true });
  if (r.status === 200) return 'moved';
  if (r.status === 422 || r.status === 404) {
    const c = await gh('POST', '/repos/' + repo + '/git/refs', { ref: 'refs/heads/' + name, sha });
    if (c.status === 201) return 'created';
    throw new Error('create ref ' + name + ' answered ' + c.status + ': ' + (c.text || '').slice(0, 200));
  }
  throw new Error('move ref ' + name + ' answered ' + r.status + ': ' + (r.text || '').slice(0, 200));
}
async function waitForStatus(repo, sha, context, minutes) {
  const deadline = Date.now() + Number(minutes) * 60000;
  let last = null;
  for (;;) {
    last = await latestStatus(repo, sha, context);
    if (last && last.state !== 'pending') return last;
    if (Date.now() >= deadline) return last;
    console.log((last ? last.state + ' — ' + last.description : 'no ' + context + ' status yet') + '; asking again in 20s');
    await new Promise((z) => setTimeout(z, 20000));
  }
}
async function ref(repo, name, sha, flags) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('sha must be 40 hex characters');
  const did = await moveRef(repo, name, sha);
  console.log(name + ' ' + did + ' to ' + sha.slice(0, 7));
  if (!flags.wait) return { moved: did };
  const context = name.endsWith('prod') ? STATUS.promote : STATUS.deploy;
  const st = await waitForStatus(repo, sha, context, flags.wait);
  if (!st) { console.log('FAIL  no ' + context + ' status on ' + sha.slice(0, 7) + ' after ' + flags.wait + ' minutes — is the tick trigger installed?'); process.exitCode = 2; return null; }
  if (st.state === 'pending') { console.log('FAIL  still pending after ' + flags.wait + ' minutes: ' + st.description); process.exitCode = 2; return st; }
  console.log((st.state === 'success' ? 'PASS  ' : 'FAIL  ') + context + ' ' + st.state + ' — ' + st.description);
  if (st.state !== 'success') process.exitCode = 1;
  return st;
}
// A run request is one commit on deploy/run holding gas-run.json. Built with the Git Data API so the
// caller needs no clone: blob -> tree -> commit (parent: the previous run, when there is one) -> ref.
function runRequest(fn, argsJson) {
  let args = [];
  if (argsJson !== undefined && argsJson !== '') {
    try { args = JSON.parse(argsJson); } catch (e) { throw new Error('args must be JSON (an array for several arguments): ' + e.message); }
    if (!Array.isArray(args)) args = [args];
  }
  return { id: new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + '-' + crypto.randomBytes(3).toString('hex'), fn, args, requestedAt: new Date().toISOString() };
}
async function run(repo, fn, argsJson, flags) {
  const req = runRequest(fn, argsJson);
  const all = await refs(repo);
  const parent = all[REF_PREFIX + 'run'] || '';
  const blob = await gh('POST', '/repos/' + repo + '/git/blobs', { content: JSON.stringify(req, null, 2) + '\n', encoding: 'utf-8' });
  if (blob.status !== 201) throw new Error('create blob answered ' + blob.status + ': ' + (blob.text || '').slice(0, 200));
  const tree = await gh('POST', '/repos/' + repo + '/git/trees', { tree: [{ path: RUN_FILE, mode: '100644', type: 'blob', sha: blob.body.sha }] });
  if (tree.status !== 201) throw new Error('create tree answered ' + tree.status);
  const commit = await gh('POST', '/repos/' + repo + '/git/commits', { message: 'gas run ' + fn + ' (' + req.id + ')', tree: tree.body.sha, parents: parent ? [parent] : [] });
  if (commit.status !== 201) throw new Error('create commit answered ' + commit.status + ': ' + (commit.text || '').slice(0, 200));
  const did = await moveRef(repo, REF_PREFIX + 'run', commit.body.sha);
  console.log('run request ' + req.id + ' for ' + fn + ' pushed as ' + commit.body.sha.slice(0, 7) + ' (' + did + ')');
  if (flags.wait === 0 || flags.wait === '0') return { sha: commit.body.sha, id: req.id };
  const st = await waitForStatus(repo, commit.body.sha, STATUS.run, flags.wait || 10);
  if (!st || st.state === 'pending') { console.log('FAIL  no verdict within the wait — is the tick trigger installed?'); process.exitCode = 2; return st; }
  console.log((st.state === 'success' ? 'PASS  ' : 'FAIL  ') + st.description);
  const comments = await gh('GET', '/repos/' + repo + '/commits/' + commit.body.sha + '/comments');
  if (comments.status === 200 && (comments.body || []).length) console.log('\n' + comments.body[comments.body.length - 1].body);
  if (st.state !== 'success') process.exitCode = 1;
  return st;
}

// ---------------------------------------------------------------------------------------------
// Repo files: gas.json, vendoring
// ---------------------------------------------------------------------------------------------
function findRepoRoot(start) {
  let d = path.resolve(start || '.');
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, 'gas.json')) || fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return path.resolve(start || '.');
}
function readGasJson(root) {
  const p = path.join(root, 'gas.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
function normalizeConfig(cfg) {
  return {
    scriptId: String(cfg.scriptId || ''), gcpProject: String(cfg.gcpProject || ''),
    rootDir: String(cfg.rootDir || '').replace(/^\.?\/+|\/+$/g, ''),
    include: Array.isArray(cfg.include) && cfg.include.length ? cfg.include.map(String) : ['**/*.js', '**/*.gs', '**/*.html', 'appsscript.json'],
    exclude: Array.isArray(cfg.exclude) ? cfg.exclude.map(String) : ['**/*.test.js', 'tests/**', 'test/**', 'node_modules/**'],
    buildMarker: cfg.buildMarker && cfg.buildMarker.file ? { file: String(cfg.buildMarker.file), placeholder: String(cfg.buildMarker.placeholder || '__BUILD_SHA__') } : null,
    prod: cfg.prod && cfg.prod.deploymentId ? { deploymentId: String(cfg.prod.deploymentId) } : null,
    hooks: { postDeploy: (cfg.hooks && cfg.hooks.postDeploy) || '', notify: (cfg.hooks && cfg.hooks.notify) || '' },
    runnable: Array.isArray(cfg.runnable) ? cfg.runnable.map(String) : [],
    pollMinutes: Number(cfg.pollMinutes || 0) || 5
  };
}
// Same glob as the library's gasGlobToRegExp_ — gas/tests/cli.test.js holds the two to one table.
function globToRegExp(glob) {
  let re = '';
  const g = String(glob).replace(/^\.?\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\.+^$()[]{}|'.indexOf(c) !== -1) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}
const matchesAny = (rel, patterns) => patterns.some((p) => globToRegExp(p).test(rel));
function libraryVersionOf(src) { const m = /var GAS_SELF_DEPLOY_VERSION = '([^']+)'/.exec(src || ''); return m ? m[1] : ''; }
function vendor(repoRoot) {
  const root = findRepoRoot(repoRoot);
  const cfg = readGasJson(root);
  if (!cfg) throw new Error('no gas.json at ' + root + ' — run `gas init` first');
  const n = normalizeConfig(cfg);
  const dest = path.join(root, n.rootDir, 'SelfDeploy.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'SelfDeploy.js'), 'utf8');
  const before = fs.existsSync(dest) ? libraryVersionOf(fs.readFileSync(dest, 'utf8')) : '';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, src);
  console.log('vendored SelfDeploy.js ' + (before ? before + ' → ' : '') + libraryVersionOf(src) + ' at ' + path.relative(root, dest));
  return dest;
}
function init(repoRoot, flags) {
  const root = path.resolve(repoRoot || '.');
  const p = path.join(root, 'gas.json');
  if (fs.existsSync(p) && !flags.force) throw new Error(p + ' exists — edit it, or pass --force');
  if (!flags['script-id']) throw new Error('init needs --script-id');
  const cfg = {
    scriptId: flags['script-id'], gcpProject: flags['gcp-project'] || 'gpt-sheets-access-475817',
    rootDir: flags['root-dir'] === undefined ? '' : flags['root-dir'],
    include: ['**/*.js', '**/*.gs', '**/*.html', 'appsscript.json'],
    exclude: ['**/*.test.js', 'tests/**', 'test/**', 'node_modules/**'],
    hooks: { postDeploy: '', notify: '' }, runnable: [], pollMinutes: 5
  };
  if (flags['prod-deployment']) cfg.prod = { deploymentId: flags['prod-deployment'] };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  console.log('wrote ' + p);
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------
function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const eq = k.indexOf('=');
      if (eq !== -1) flags[k.slice(0, eq)] = k.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}
async function main() {
  const { flags, rest } = parseArgs(process.argv.slice(2));
  const cmd = rest[0];
  const need = (n, what) => { if (rest.length < n + 1) throw new Error(cmd + ' needs ' + what); };
  switch (cmd) {
    case 'login': return login(flags);
    case 'import-clasprc': return importClasprc(rest[1]);
    case 'whoami': return whoami();
    case 'scripts': return scripts();
    case 'seed': need(1, '<scriptId>'); return seed(rest[1], flags);
    case 'pull': need(1, '<scriptId>'); return pull(rest[1], flags);
    case 'push': need(1, '<scriptId>'); return push(rest[1], flags);
    case 'versions': need(1, '<scriptId>'); return versions(rest[1]);
    case 'deployments': need(1, '<scriptId>'); return deployments(rest[1]);
    case 'promote': need(1, '<scriptId>'); return promote(rest[1], flags);
    case 'logs': return logs(flags);
    case 'status': need(1, '<owner/repo>'); return status(rest[1]);
    case 'ref': need(3, '<owner/repo> <deploy/test|deploy/prod> <sha>'); return ref(rest[1], rest[2], rest[3], flags);
    case 'run': need(2, '<owner/repo> <fn> [argsJson]'); return run(rest[1], rest[2], rest[3], flags);
    case 'vendor': return vendor(rest[1] || '.');
    case 'init': return init(rest[1] || '.', flags);
    case 'version': console.log(VERSION); return;
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1, 32).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
      process.exitCode = cmd ? 2 : 0;
  }
}
module.exports = { parseArgs, normalizeCredentials, codeFromRedirect, scriptName, scriptType, extFor, deployedShaOf, seedPayload, globToRegExp, matchesAny, normalizeConfig, runRequest, libraryVersionOf, localDeployables, PUBLISHED_CLIENT, LOGIN_SCOPES, STATUS, REF_PREFIX, SEED_PREFIX, RUN_FILE };
if (require.main === module) {
  main().catch((e) => { console.error('ERR  ' + (e && e.message ? e.message : e)); process.exit(process.exitCode || 2); });
}
