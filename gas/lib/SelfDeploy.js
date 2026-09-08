// SelfDeploy.js — an Apps Script project that deploys itself from GitHub. No clasp, no credential in CI.
//
// VENDORED from surreptakos/claude-dotfiles, gas/lib/SelfDeploy.js. Do not edit the copy in a project;
// upgrade it with `node <claude-dotfiles>/gas/cli/gas.js vendor <repo>` and commit the result.
//
// THE MODEL (pull mode, the only mode in this version)
//
//   A time trigger, `gasDeployTick`, runs every few minutes on HEAD. Each tick asks GitHub for the
//   `deploy/*` refs of the repo named in Script Properties — one HTTP call when nothing has moved.
//
//   deploy/test  moved  -> this tick pulls the deployable set at that commit (declared in the repo's
//                          gas.json), stamps GAS_DEPLOYED_SHA below with the commit, writes HEAD through
//                          the Apps Script API, reads it back, and records "pending". THE NEXT TICK runs
//                          the code it just wrote: it sees its own GAS_DEPLOYED_SHA equal the pending
//                          commit, runs the host's post-deploy hook, and records the verdict as a commit
//                          status (`gas/deploy`) on that commit, so the pull request shows it.
//   deploy/prod  moved  -> once deploy/test has verified that same commit, one new version of HEAD and
//                          the PROD deployment moved to it, read back, status `gas/promote`.
//   deploy/run   moved  -> the commit carries gas-run.json {id, fn, args}; the tick runs `fn` on the
//                          code it is running (HEAD) and reports through status `gas/run`, a commit
//                          comment when the token may write one, and a log line.
//
//   Nothing on the internet answers for the script. CI's only job is to move a ref with its own
//   GITHUB_TOKEN and wait for the status. A Google refresh token from clasp's PUBLISHED OAuth client
//   (no seven-day expiry, unlike a client whose consent screen is in Testing) and a GitHub token live in
//   Script Properties, seeded once through a Drive file and never in code or in GitHub.
//
// WHY A TRIGGER, AND WHY THE NEXT TICK VERIFIES
//
//   Apps Script runs a trigger on the deployment that created it, and a versioned web-app deployment runs
//   its pinned version, not HEAD (aac-sales-cockpit, 2026-09-08: a check scheduled by an endpoint judged
//   the endpoint's own build and passed a broken deploy). A trigger installed from the editor or from
//   another HEAD trigger runs HEAD, so the tick is always the newest code by the time it verifies. The
//   execution that WRITES HEAD is still the previous build; that is why the verdict is one tick later.
//
// WHAT THE HOST PROVIDES
//
//   - gas.json at the repo root (see gas/templates/gas.json): scriptId, rootDir, include/exclude,
//     optional buildMarker, prod deployment id, hooks, runnable list.
//   - Optionally a post-deploy hook function (its name in gas.json `hooks.postDeploy`) that throws when
//     the deploy is bad and returns a short summary when it is good. And optionally a notify hook
//     (`hooks.notify`, called (subject, body, isFailure)); without one, MailApp mails the owner.
//   - The trigger, installed once: run `gasInstall()` in the editor, or call `gasEnsureTrigger_()` from
//     any trigger the project already has.
//   - Manifest scopes the library uses: script.external_request (UrlFetch), script.scriptapp (triggers),
//     drive (the seed file), userinfo.email and mail (the owner mail). See gas/README.md.
//
// LOGGING: every line starts with [gas]. In Cloud Logging, filter on that.

var GAS_SELF_DEPLOY_VERSION = '0.1.0';
// THE RUNTIME'S OWN BUILD MARKER. The deploy replaces the placeholder with the commit it writes, so the
// code that runs can always say which commit it is. Compared against the pending record each tick.
var GAS_DEPLOYED_SHA = '__GAS_SHA__';
var GAS_SHA_PLACEHOLDER_ = '__GAS_' + 'SHA__';                // spelled so the stamp never hits this line

var GAS_PROPS_ = {
  repo: 'GAS_REPO',                            // owner/name
  ghToken: 'GAS_GITHUB_TOKEN',                 // reads the repo, writes commit statuses (and comments, optionally)
  refresh: 'GAS_GOOGLE_REFRESH_TOKEN',         // from the PUBLISHED clasp client, see gas/README.md
  clientId: 'GAS_GOOGLE_CLIENT_ID',
  clientSecret: 'GAS_GOOGLE_CLIENT_SECRET',
  state: 'GAS_STATE',                          // {test, prod, run, lastTick}
  config: 'GAS_CONFIG',                        // the gas.json last deployed, so prod/run ticks need no fetch
  lastDeployedSha: 'GAS_LAST_DEPLOYED_SHA'
};
var GAS_SEED_PREFIX_ = 'gas-seed-';            // Drive file: gas-seed-<scriptId>.json
var GAS_REF_PREFIX_ = 'deploy/';               // deploy/test, deploy/prod, deploy/run
var GAS_TICK_HANDLER_ = 'gasDeployTick';
var GAS_TICK_MINUTES_DEFAULT_ = 5;
var GAS_TICK_LOCK_CK_ = 'GAS_TICK_LOCK';       // CacheService, so a slow tick is not overlapped
var GAS_TICK_LOCK_S_ = 240;
var GAS_TOKEN_CK_ = 'GAS_GOOGLE_ACCESS_TOKEN', GAS_TOKEN_EXP_CK_ = 'GAS_GOOGLE_ACCESS_TOKEN_EXP';
var GAS_VERIFY_MAX_TICKS_ = 6;                 // a pending build never seen by a runtime in this many ticks fails
var GAS_STATUS_DEPLOY_ = 'gas/deploy', GAS_STATUS_PROMOTE_ = 'gas/promote', GAS_STATUS_RUN_ = 'gas/run';
var GAS_VERSION_CAP_ = 200, GAS_VERSION_WARN_AT_ = 180, GAS_VERSION_FAIL_AT_ = 199;   // Apps Script's cap
var GAS_GITHUB_API_ = 'https://api.github.com';
var GAS_SCRIPT_API_ = 'https://script.googleapis.com/v1/projects/';
var GAS_TOKEN_URL_ = 'https://oauth2.googleapis.com/token';
var GAS_RUN_FILE_ = 'gas-run.json';
var GAS_RESULT_MAX_ = 60000;

// ============================================================================================
// Entry points (no trailing underscore: runnable from the editor)
// ============================================================================================

// The trigger handler. Never throws to the trigger: every failure is logged, recorded and mailed here.
function gasDeployTick() {
  var cache = CacheService.getScriptCache();
  if (cache.get(GAS_TICK_LOCK_CK_)) { gasLog_('tick skipped — the previous tick is still running'); return { skipped: 'locked' }; }
  cache.put(GAS_TICK_LOCK_CK_, '1', GAS_TICK_LOCK_S_);
  var out = { version: GAS_SELF_DEPLOY_VERSION, runtime: gasRuntimeSha_() };
  try {
    gasSeedIngest_();
    var repo = gasRepo_();
    if (!repo) { gasLog_('no GAS_REPO property and no seed — nothing to do (gas/README.md, "Seeding")'); return out; }
    var state = gasState_();
    var refs = gasRefs_(repo);
    out.refs = refs;
    out.test = gasTickTest_(repo, refs.test, state);
    out.prod = gasTickProd_(repo, refs.prod, state);
    out.run = gasTickRun_(repo, refs.run, state);
    state.lastTick = new Date().toISOString();
    gasSaveState_(state);
  } catch (e) {
    var why = String((e && e.message) || e);
    gasLog_('tick failed :: ' + why);
    if (!/too many times/i.test(why)) gasNotifyOnce_('tick:' + why.slice(0, 80), '[gas] deploy tick failed', why + '\n\n' + (e && e.stack ? e.stack : ''), true);
    out.error = why;
  } finally {
    cache.remove(GAS_TICK_LOCK_CK_);
  }
  return out;
}

// Installs the tick trigger if the project lacks it. Run once from the editor, or let a trigger the
// project already has call gasEnsureTrigger_(). Idempotent.
function gasInstall() {
  var made = gasEnsureTrigger_();
  return { installed: made, trigger: GAS_TICK_HANDLER_, everyMinutes: gasTickMinutes_(), version: GAS_SELF_DEPLOY_VERSION };
}
function gasUninstall() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === GAS_TICK_HANDLER_) { ScriptApp.deleteTrigger(t); n++; }
  });
  return { removed: n };
}
// What the library knows right now — read from the editor, or from a host diagnostic.
function gasStatus() {
  return { version: GAS_SELF_DEPLOY_VERSION, runtime: gasRuntimeSha_(), repo: gasRepo_() || null,
           state: gasState_(), config: gasConfig_() || null, triggerInstalled: gasTriggerInstalled_() };
}
// Promote HEAD to the PROD deployment now, outside the deploy/prod ref — for a host's own policy trigger
// (a Sunday guard, a Thursday promote). Returns what promoteFromRef would.
function gasPromoteNow(reason) {
  var cfg = gasConfig_();
  if (!cfg || !cfg.prod || !cfg.prod.deploymentId) throw new Error('gas.json declares no prod.deploymentId — nothing to promote to');
  var sha = gasHeadSha_();
  return gasPromote_(cfg, sha, String(reason || 'promoted by the host'));
}

// ============================================================================================
// The three ref-driven steps
// ============================================================================================

function gasTickTest_(repo, sha, state) {
  var t = state.test || {};
  if (!sha) return { note: 'no ' + GAS_REF_PREFIX_ + 'test ref' };
  // 1. A pending build: is this runtime it? Then verify; if not, count the look.
  if (t.pending) {
    if (gasRuntimeSha_() === t.sha) return gasVerify_(repo, t, state);
    t.attempts = Number(t.attempts || 0) + 1;
    t.lastSeen = gasRuntimeSha_();
    if (t.attempts >= GAS_VERIFY_MAX_TICKS_) {
      var why = 'no tick ran build ' + t.sha.slice(0, 7) + ' in ' + t.attempts + ' looks (this runtime is ' + (t.lastSeen || 'unstamped').slice(0, 7)
        + ') — the write did not reach HEAD\'s runtime, or the tick trigger is bound to a versioned deployment (gas/README.md, "The trigger")';
      t.pending = false; t.ok = false; t.error = why; t.at = new Date().toISOString();
      state.test = t;
      gasStatus_(repo, t.sha, GAS_STATUS_DEPLOY_, 'failure', why);
      gasNotify_('[gas] deploy of ' + t.sha.slice(0, 7) + ' could not be verified', why, true);
      gasLog_('verify FAILED for ' + t.sha.slice(0, 7) + ' :: ' + why);
      return { verified: false, error: why };
    }
    state.test = t;
    gasLog_('waiting for a tick that runs ' + t.sha.slice(0, 7) + ' (this one runs ' + (t.lastSeen || 'unstamped').slice(0, 7) + ', look ' + t.attempts + ')');
    return { pending: t.sha, look: t.attempts };
  }
  // 2. The ref points at what is deployed: nothing to do.
  if (sha === t.sha && (t.ok || t.error)) return { unchanged: sha.slice(0, 7) };
  // 3. Deploy it.
  return gasDeployCommit_(repo, sha, state);
}

function gasDeployCommit_(repo, sha, state) {
  var cfg = gasFetchConfig_(repo, sha);
  var files = gasDeployables_(repo, sha, cfg);
  var bytes = files.reduce(function (n, f) { return n + f.source.length; }, 0);
  gasStatus_(repo, sha, GAS_STATUS_DEPLOY_, 'pending', 'writing HEAD (' + files.length + ' files)');
  gasProjectUpdateContent_(files);
  var now = gasHeadSha_();
  if (now !== sha) throw new Error('the write did not take: HEAD reads ' + (now || 'no marker') + ' after writing ' + sha.slice(0, 7));
  state.test = { sha: sha, pending: true, attempts: 0, at: new Date().toISOString(), files: files.length, bytes: bytes };
  gasSaveState_(state);
  gasSaveConfig_(cfg);
  PropertiesService.getScriptProperties().setProperty(GAS_PROPS_.lastDeployedSha, sha);
  gasStatus_(repo, sha, GAS_STATUS_DEPLOY_, 'pending', 'HEAD written; the next tick verifies it');
  gasLog_('HEAD is now ' + sha.slice(0, 7) + ' (' + files.length + ' files, ' + bytes + ' bytes); verification on the next tick');
  return { deployed: sha, files: files.length, bytes: bytes };
}

// This runtime IS the pending build. Ask the host, record, report.
function gasVerify_(repo, t, state) {
  var cfg = gasConfig_() || {};
  var result = { sha: t.sha, ok: false, at: new Date().toISOString(), checks: {} };
  try {
    result.checks.runtime = 'this tick runs ' + t.sha.slice(0, 7);
    var hook = cfg.hooks && cfg.hooks.postDeploy;
    if (hook) {
      var fn = gasGlobal_(hook);
      if (typeof fn !== 'function') throw new Error('gas.json names post-deploy hook "' + hook + '" but no such function exists in the project');
      var summary = fn();
      result.checks.hook = summary === undefined ? 'ok' : gasShort_(summary, 500);
    } else {
      result.checks.hook = 'none declared';
    }
    result.ok = true;
  } catch (e) {
    result.error = String((e && e.message) || e);
  }
  state.test = { sha: t.sha, pending: false, ok: result.ok, error: result.error || '', checks: result.checks, at: result.at, files: t.files, bytes: t.bytes };
  gasSaveState_(state);
  if (result.ok) {
    gasStatus_(repo, t.sha, GAS_STATUS_DEPLOY_, 'success', 'deployed and verified on HEAD' + (cfg.hooks && cfg.hooks.postDeploy ? ' (' + gasShort_(result.checks.hook, 100) + ')' : ''));
    gasLog_('verified ' + t.sha.slice(0, 7) + ' :: ' + JSON.stringify(result.checks));
  } else {
    gasStatus_(repo, t.sha, GAS_STATUS_DEPLOY_, 'failure', result.error);
    gasNotify_('[gas] deploy of ' + t.sha.slice(0, 7) + ' FAILED its post-deploy check', result.error + '\n\nHEAD carries the new code; nothing was promoted. Fix forward with a new commit.', true);
    gasLog_('verify FAILED for ' + t.sha.slice(0, 7) + ' :: ' + result.error);
  }
  return result;
}

function gasTickProd_(repo, sha, state) {
  if (!sha) return { note: 'no ' + GAS_REF_PREFIX_ + 'prod ref' };
  var cfg = gasConfig_();
  if (!cfg || !cfg.prod || !cfg.prod.deploymentId) return { note: 'gas.json declares no prod.deploymentId' };
  var p = state.prod || {};
  if (sha === p.sha) return { unchanged: sha.slice(0, 7) };
  var t = state.test || {};
  if (!(t.sha === sha && t.ok)) {
    var waiting = t.sha === sha ? (t.pending ? 'waiting for deploy/test to verify ' + sha.slice(0, 7) : 'deploy/test FAILED for ' + sha.slice(0, 7) + ', refusing to promote')
                                : 'deploy/prod points at ' + sha.slice(0, 7) + ' but deploy/test verified ' + (t.sha || 'nothing').slice(0, 7) + ' — move deploy/test first';
    if (p.waitingFor !== sha) { gasStatus_(repo, sha, GAS_STATUS_PROMOTE_, t.sha === sha && !t.pending ? 'failure' : 'pending', waiting); p.waitingFor = sha; state.prod = p; }
    return { waiting: waiting };
  }
  try {
    var r = gasPromote_(cfg, sha, 'deploy/prod moved to ' + sha.slice(0, 7));
    state.prod = { sha: sha, version: r.versionNumber, at: new Date().toISOString() };
    gasStatus_(repo, sha, GAS_STATUS_PROMOTE_, 'success', 'PROD is version ' + r.versionNumber);
    gasNotify_('[gas] PROD promoted to version ' + r.versionNumber + ' (build ' + sha.slice(0, 7) + ')', 'Versions used: ' + r.versions + ' of ' + GAS_VERSION_CAP_ + '.', false);
    return r;
  } catch (e) {
    var why = String((e && e.message) || e);
    gasStatus_(repo, sha, GAS_STATUS_PROMOTE_, 'failure', why);
    gasNotify_('[gas] PROD promote of ' + sha.slice(0, 7) + ' FAILED', why, true);
    gasLog_('promote FAILED for ' + sha.slice(0, 7) + ' :: ' + why);
    state.prod = { sha: p.sha, version: p.version, failed: sha, error: why, at: new Date().toISOString() };
    return { error: why };
  }
}

function gasPromote_(cfg, sha, reason) {
  var count = gasVersionCount_();
  if (count >= GAS_VERSION_FAIL_AT_) {
    throw new Error('promote refused: the project holds ' + count + ' of ' + GAS_VERSION_CAP_ + ' versions; delete old versions by hand in the Apps Script editor');
  }
  var v = gasScriptApi_('post', '/versions', { description: 'PROD: ' + reason + ' (' + (sha || 'unstamped').slice(0, 7) + ')' });
  var vn = Number(v.versionNumber || 0);
  if (!vn) throw new Error('versions.create answered without a versionNumber: ' + JSON.stringify(v).slice(0, 200));
  gasScriptApi_('put', '/deployments/' + cfg.prod.deploymentId, {
    deploymentConfig: { scriptId: ScriptApp.getScriptId(), versionNumber: vn, manifestFileName: 'appsscript',
                        description: 'PROD @' + (sha || 'unstamped').slice(0, 7) + ' — ' + reason }
  });
  var got = Number((gasScriptApi_('get', '/deployments/' + cfg.prod.deploymentId).deploymentConfig || {}).versionNumber || 0);
  if (got !== vn) throw new Error('the PROD deployment reads version ' + got + ' after moving it to ' + vn);
  var used = count + 1;
  if (used >= GAS_VERSION_WARN_AT_) {
    gasNotify_('[gas] Apps Script versions: ' + used + ' of ' + GAS_VERSION_CAP_ + ' used', 'Promotes refuse at ' + GAS_VERSION_FAIL_AT_ + '. Versions cannot be deleted by API; delete old ones by hand in the editor.', true);
  }
  gasLog_('PROD is version ' + vn + ' (build ' + (sha || 'unstamped').slice(0, 7) + '; ' + used + '/' + GAS_VERSION_CAP_ + ' versions) — ' + reason);
  return { versionNumber: vn, sha: sha, versions: used };
}

// deploy/run: a commit whose root carries gas-run.json {id, fn, args}. Runs on THIS runtime (HEAD).
function gasTickRun_(repo, sha, state) {
  if (!sha) return { note: 'no ' + GAS_REF_PREFIX_ + 'run ref' };
  var r = state.run || {};
  if (sha === r.sha) return { unchanged: sha.slice(0, 7) };
  var cfg = gasConfig_() || {};
  var req = null, out = { sha: sha, at: new Date().toISOString() };
  try {
    var raw = gasGithubRaw_(repo, GAS_RUN_FILE_, sha);
    if (raw.code !== 200) throw new Error(GAS_RUN_FILE_ + ' is not at the root of ' + sha.slice(0, 7) + ' (' + raw.code + ')');
    req = JSON.parse(raw.text);
    var fn = String(req.fn || '');
    if (!gasRunnable_(fn, cfg)) throw new Error('"' + fn + '" is not runnable: it ends in an underscore or is outside gas.json `runnable`');
    var f = gasGlobal_(fn);
    if (typeof f !== 'function') throw new Error('no function named "' + fn + '" in this project');
    var args = Array.isArray(req.args) ? req.args : (req.args === undefined ? [] : [req.args]);
    var started = Date.now();
    var value = f.apply(null, args);
    out.ok = true; out.ms = Date.now() - started; out.id = req.id || ''; out.fn = fn;
    out.result = gasShort_(value, GAS_RESULT_MAX_);
  } catch (e) {
    out.ok = false; out.error = String((e && e.message) || e); out.id = (req && req.id) || ''; out.fn = (req && req.fn) || '';
  }
  state.run = { sha: sha, id: out.id, fn: out.fn, ok: out.ok, at: out.at };
  var line = (out.ok ? 'ok' : 'FAILED') + ' ' + (out.fn || '?') + (out.id ? ' id=' + out.id : '') + (out.ms !== undefined ? ' ' + out.ms + 'ms' : '');
  gasStatus_(repo, sha, GAS_STATUS_RUN_, out.ok ? 'success' : 'failure', line + ' — ' + gasShort_(out.ok ? out.result : out.error, 100));
  gasCommitComment_(repo, sha, '**gas run** `' + (out.fn || '?') + '` on build ' + gasRuntimeSha_().slice(0, 7) + ' — ' + (out.ok ? 'ok' : 'FAILED') + (out.ms !== undefined ? ' in ' + out.ms + ' ms' : '')
    + '\n\n```\n' + (out.ok ? out.result : out.error) + '\n```');
  gasLog_('[gas-run] ' + line + ' :: ' + gasShort_(out.ok ? out.result : out.error, 2000));
  return out;
}
function gasRunnable_(fn, cfg) {
  if (!fn || !/^[A-Za-z_$][\w$]*$/.test(fn)) return false;
  if (cfg && Array.isArray(cfg.runnable) && cfg.runnable.length) return cfg.runnable.indexOf(fn) !== -1;
  return !/_$/.test(fn) && !/^gas[A-Z]/.test(fn);                 // no private helpers, and not this library
}

// ============================================================================================
// GitHub: refs, config, tree, files, statuses
// ============================================================================================

function gasRepo_() { return String(PropertiesService.getScriptProperties().getProperty(GAS_PROPS_.repo) || '').trim(); }
function gasGithubToken_() { return String(PropertiesService.getScriptProperties().getProperty(GAS_PROPS_.ghToken) || ''); }
function gasGithub_(method, suffix, payload, raw) {
  var opts = { method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + gasGithubToken_(), Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
               'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'gas-self-deploy/' + GAS_SELF_DEPLOY_VERSION } };
  if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch(GAS_GITHUB_API_ + suffix, opts);
  return { code: res.getResponseCode(), text: res.getContentText() || '' };
}
function gasGithubRaw_(repo, path, ref) {
  return gasGithub_('get', '/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(ref), null, true);
}
// One call for every deploy/* ref. {test, prod, run} → sha or ''.
function gasRefs_(repo) {
  var r = gasGithub_('get', '/repos/' + repo + '/git/matching-refs/heads/' + GAS_REF_PREFIX_);
  if (r.code === 401 || r.code === 403) throw new Error('GitHub refused the stored token (' + r.code + ') — re-seed GAS_GITHUB_TOKEN (gas/README.md, "Seeding")');
  if (r.code !== 200) throw new Error('GitHub matching-refs answered ' + r.code + ': ' + r.text.slice(0, 200));
  var out = { test: '', prod: '', run: '' };
  var arr = [];
  try { arr = JSON.parse(r.text) || []; } catch (e) { arr = []; }
  arr.forEach(function (x) {
    var name = String(x.ref || '').replace(/^refs\/heads\//, '');
    var sha = (x.object && x.object.sha) || '';
    if (name === GAS_REF_PREFIX_ + 'test') out.test = sha;
    if (name === GAS_REF_PREFIX_ + 'prod') out.prod = sha;
    if (name === GAS_REF_PREFIX_ + 'run') out.run = sha;
  });
  return out;
}
function gasFetchConfig_(repo, sha) {
  var r = gasGithubRaw_(repo, 'gas.json', sha);
  if (r.code !== 200) throw new Error('gas.json is not at the root of ' + sha.slice(0, 7) + ' (' + r.code + ') — see gas/templates/gas.json');
  var cfg;
  try { cfg = JSON.parse(r.text); } catch (e) { throw new Error('gas.json at ' + sha.slice(0, 7) + ' is not valid JSON: ' + e.message); }
  if (cfg.scriptId && cfg.scriptId !== ScriptApp.getScriptId()) {
    throw new Error('gas.json names scriptId ' + cfg.scriptId + ' but this project is ' + ScriptApp.getScriptId() + ' — refusing to deploy another project\'s repo');
  }
  return gasNormalizeConfig_(cfg);
}
function gasNormalizeConfig_(cfg) {
  var out = {};
  out.scriptId = String(cfg.scriptId || '');
  out.rootDir = String(cfg.rootDir || '').replace(/^\.?\/+|\/+$/g, '');
  out.include = Array.isArray(cfg.include) && cfg.include.length ? cfg.include.map(String) : ['**/*.js', '**/*.gs', '**/*.html', 'appsscript.json'];
  out.exclude = Array.isArray(cfg.exclude) ? cfg.exclude.map(String) : ['**/*.test.js', 'tests/**', 'test/**', 'node_modules/**'];
  out.buildMarker = cfg.buildMarker && cfg.buildMarker.file ? { file: String(cfg.buildMarker.file), placeholder: String(cfg.buildMarker.placeholder || '__BUILD_SHA__') } : null;
  out.prod = cfg.prod && cfg.prod.deploymentId ? { deploymentId: String(cfg.prod.deploymentId) } : null;
  out.hooks = { postDeploy: (cfg.hooks && cfg.hooks.postDeploy) ? String(cfg.hooks.postDeploy) : '', notify: (cfg.hooks && cfg.hooks.notify) ? String(cfg.hooks.notify) : '' };
  out.runnable = Array.isArray(cfg.runnable) ? cfg.runnable.map(String) : [];
  out.pollMinutes = Number(cfg.pollMinutes || 0) || GAS_TICK_MINUTES_DEFAULT_;
  return out;
}
// The deployable set at a commit: every blob under rootDir matching include and not exclude, as Apps
// Script API file objects; this library stamped with the sha; the optional build marker stamped too.
function gasDeployables_(repo, sha, cfg) {
  var commit = gasGithub_('get', '/repos/' + repo + '/commits/' + sha);
  if (commit.code !== 200) throw new Error('GitHub commit ' + sha.slice(0, 7) + ' answered ' + commit.code);
  var treeSha = (((JSON.parse(commit.text) || {}).commit || {}).tree || {}).sha;
  var tree = gasGithub_('get', '/repos/' + repo + '/git/trees/' + treeSha + '?recursive=1');
  if (tree.code !== 200) throw new Error('GitHub tree ' + String(treeSha).slice(0, 7) + ' answered ' + tree.code);
  var parsed = JSON.parse(tree.text) || {};
  if (parsed.truncated) throw new Error('GitHub truncated the tree listing at ' + sha.slice(0, 7) + ' — the repo is too large to list in one call');
  var root = cfg.rootDir ? cfg.rootDir + '/' : '';
  var paths = (parsed.tree || []).filter(function (e) {
    if (e.type !== 'blob') return false;
    if (root && e.path.indexOf(root) !== 0) return false;
    var rel = e.path.slice(root.length);
    return gasMatchesAny_(rel, cfg.include) && !gasMatchesAny_(rel, cfg.exclude);
  }).map(function (e) { return e.path.slice(root.length); });
  if (paths.indexOf('appsscript.json') === -1) throw new Error('no appsscript.json under "' + (cfg.rootDir || '.') + '" at ' + sha.slice(0, 7) + ' — refusing to deploy a tree without a manifest');
  var libName = null;
  var files = paths.map(function (rel) {
    var r = gasGithubRaw_(repo, root + rel, sha);
    if (r.code !== 200) throw new Error('GitHub could not serve ' + root + rel + ' at ' + sha.slice(0, 7) + ' (' + r.code + ')');
    var src = r.text;
    if (src.indexOf('var GAS_DEPLOYED_SHA = ') !== -1 && src.indexOf(GAS_SHA_PLACEHOLDER_) !== -1) {
      src = src.split(GAS_SHA_PLACEHOLDER_).join(sha);
      libName = rel;
    }
    if (cfg.buildMarker && rel === cfg.buildMarker.file) src = src.split(cfg.buildMarker.placeholder).join(sha);
    return { name: gasScriptName_(rel), type: gasScriptType_(rel), source: src };
  });
  if (!libName) throw new Error('the deployable set at ' + sha.slice(0, 7) + ' carries no SelfDeploy.js with the GAS_DEPLOYED_SHA placeholder — a deploy of it could never be verified');
  return files;
}
// Apps Script API names: the path under rootDir without its extension (clasp's convention, folders kept).
function gasScriptName_(rel) { return String(rel).replace(/\.(json|js|gs|html)$/i, ''); }
function gasScriptType_(rel) { return /\.json$/i.test(rel) ? 'JSON' : (/\.(js|gs)$/i.test(rel) ? 'SERVER_JS' : 'HTML'); }
// A small glob: `**` any path, `*` within a segment, `?` one char. Enough for include/exclude lists.
function gasMatchesAny_(rel, patterns) {
  for (var i = 0; i < patterns.length; i++) if (gasGlobToRegExp_(patterns[i]).test(rel)) return true;
  return false;
}
function gasGlobToRegExp_(glob) {
  var re = '';
  var g = String(glob).replace(/^\.?\//, '');
  for (var i = 0; i < g.length; i++) {
    var c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\.+^$()[]{}|'.indexOf(c) !== -1) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}
// Commit status: how CI and the pull request see a deploy. Best-effort — a token without statuses:write
// still deploys; the record then lives in GAS_STATE and the log only.
function gasStatus_(repo, sha, context, stateName, description) {
  try {
    var r = gasGithub_('post', '/repos/' + repo + '/statuses/' + sha, { state: stateName, context: context, description: gasShort_(description, 140) });
    if (r.code !== 201) gasLog_('commit status ' + context + '=' + stateName + ' on ' + sha.slice(0, 7) + ' not written (' + r.code + '): ' + r.text.slice(0, 120));
    return r.code === 201;
  } catch (e) { gasLog_('commit status failed :: ' + (e && e.message)); return false; }
}
function gasCommitComment_(repo, sha, body) {
  try {
    var r = gasGithub_('post', '/repos/' + repo + '/commits/' + sha + '/comments', { body: gasShort_(body, 60000) });
    if (r.code !== 201) gasLog_('commit comment on ' + sha.slice(0, 7) + ' not written (' + r.code + ')');
    return r.code === 201;
  } catch (e) { return false; }
}

// ============================================================================================
// Google: the stored refresh token, the Apps Script API
// ============================================================================================

function gasGoogleToken_(forceRefresh) {
  var cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    var tok = cache.get(GAS_TOKEN_CK_), exp = Number(cache.get(GAS_TOKEN_EXP_CK_) || '0');
    if (tok && (Date.now() / 1000) < exp - 120) return tok;
  }
  var sp = PropertiesService.getScriptProperties();
  if (!sp.getProperty(GAS_PROPS_.refresh)) gasSeedIngest_();
  var refresh = sp.getProperty(GAS_PROPS_.refresh);
  if (!refresh) throw new Error('no Google credential in Script Properties — seed ' + gasSeedFileName_() + ' in Drive (gas/README.md, "Seeding")');
  var res = UrlFetchApp.fetch(GAS_TOKEN_URL_, {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'refresh_token', refresh_token: refresh, client_id: sp.getProperty(GAS_PROPS_.clientId) || '', client_secret: sp.getProperty(GAS_PROPS_.clientSecret) || '' }
  });
  var body = {};
  try { body = JSON.parse(res.getContentText() || '{}'); } catch (e) { body = {}; }
  if (!body.access_token) {
    throw new Error('Google token refresh failed (' + res.getResponseCode() + '): ' + String(res.getContentText() || '').slice(0, 200) + ' — the stored refresh token is dead; re-seed it (gas/README.md, "Seeding")');
  }
  var ttl = Math.min(Number(body.expires_in || 3600), 3500);
  var o = {}; o[GAS_TOKEN_CK_] = body.access_token; o[GAS_TOKEN_EXP_CK_] = String(Math.floor(Date.now() / 1000) + ttl);
  cache.putAll(o, ttl);
  return body.access_token;
}
function gasScriptApi_(method, suffix, payload, query) {
  var url = GAS_SCRIPT_API_ + ScriptApp.getScriptId() + suffix + (query ? '?' + query : '');
  function call(force) {
    var opts = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + gasGoogleToken_(force) } };
    if (payload) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(payload); }
    return UrlFetchApp.fetch(url, opts);
  }
  var res = call(false);
  if (res.getResponseCode() === 401) res = call(true);
  var rc = res.getResponseCode(), text = res.getContentText() || '';
  if (rc < 200 || rc >= 300) throw new Error('Apps Script API ' + String(method).toUpperCase() + ' ' + suffix + ' answered ' + rc + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}
function gasProjectUpdateContent_(files) { return gasScriptApi_('put', '/content', { files: files }); }
// The build HEAD carries, read through the API (never through this runtime, which may be older).
function gasHeadSha_() {
  var content = gasScriptApi_('get', '/content');
  var files = content.files || [];
  for (var i = 0; i < files.length; i++) {
    var m = /var GAS_DEPLOYED_SHA = '([0-9a-f]{40})'/.exec(files[i].source || '');
    if (m) return m[1];
  }
  return '';
}
function gasVersionCount_() {
  var n = 0, token = '';
  for (var guard = 0; guard < 20; guard++) {
    var page = gasScriptApi_('get', '/versions', null, 'pageSize=200' + (token ? '&pageToken=' + encodeURIComponent(token) : ''));
    n += (page.versions || []).length;
    token = page.nextPageToken || '';
    if (!token) break;
  }
  return n;
}

// ============================================================================================
// Seeding: one Drive file, read once, trashed
// ============================================================================================

function gasSeedFileName_() { return GAS_SEED_PREFIX_ + ScriptApp.getScriptId() + '.json'; }
// {google: {refresh_token, client_id, client_secret}, github: {token, repo}} — any half may be absent when
// the other is already set. Returns whether anything was taken up; never throws (the tick calls it first).
function gasSeedIngest_() {
  try {
    var sp = PropertiesService.getScriptProperties();
    var haveGoogle = !!sp.getProperty(GAS_PROPS_.refresh), haveGithub = !!sp.getProperty(GAS_PROPS_.ghToken) && !!sp.getProperty(GAS_PROPS_.repo);
    if (haveGoogle && haveGithub) return false;
    var it = DriveApp.getFilesByName(gasSeedFileName_());
    while (it.hasNext()) {
      var f = it.next();
      var seed = null;
      try { seed = JSON.parse(f.getBlob().getDataAsString()); } catch (pe) { seed = null; }
      if (!seed || typeof seed !== 'object') { gasLog_('seed file is not JSON — left in place'); continue; }
      var took = [];
      var g = seed.google || {};
      if (g.refresh_token && g.client_id && g.client_secret) {
        sp.setProperty(GAS_PROPS_.refresh, String(g.refresh_token)); sp.setProperty(GAS_PROPS_.clientId, String(g.client_id)); sp.setProperty(GAS_PROPS_.clientSecret, String(g.client_secret));
        took.push('google');
      }
      var h = seed.github || {};
      if (h.token && h.repo) { sp.setProperty(GAS_PROPS_.ghToken, String(h.token)); sp.setProperty(GAS_PROPS_.repo, String(h.repo)); took.push('github'); }
      if (!took.length) { gasLog_('seed file carries neither a complete google nor a complete github half — left in place'); continue; }
      try { f.setTrashed(true); } catch (te) { gasLog_('could not trash the seed file :: ' + te.message); }
      gasLog_('credentials taken up from ' + gasSeedFileName_() + ' (' + took.join(', ') + ') and the file trashed');
      return true;
    }
  } catch (e) { gasLog_('seed ingest failed :: ' + (e && e.message)); }
  return false;
}

// ============================================================================================
// State, config, trigger, notify, log
// ============================================================================================

function gasState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(GAS_PROPS_.state);
  try { return raw ? (JSON.parse(raw) || {}) : {}; } catch (e) { return {}; }
}
function gasSaveState_(state) { PropertiesService.getScriptProperties().setProperty(GAS_PROPS_.state, JSON.stringify(state)); }
function gasConfig_() {
  var raw = PropertiesService.getScriptProperties().getProperty(GAS_PROPS_.config);
  try { return raw ? gasNormalizeConfig_(JSON.parse(raw) || {}) : null; } catch (e) { return null; }
}
function gasSaveConfig_(cfg) { PropertiesService.getScriptProperties().setProperty(GAS_PROPS_.config, JSON.stringify(cfg)); }
function gasRuntimeSha_() { return /^[0-9a-f]{40}$/.test(GAS_DEPLOYED_SHA) ? GAS_DEPLOYED_SHA : ''; }
function gasTickMinutes_() { var cfg = gasConfig_(); return (cfg && cfg.pollMinutes) || GAS_TICK_MINUTES_DEFAULT_; }
function gasTriggerInstalled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === GAS_TICK_HANDLER_; });
}
// Creates the tick trigger when it is missing. A trigger runs the deployment that created it, so call
// this from the editor or from a trigger that already runs HEAD — never from a versioned web app.
function gasEnsureTrigger_() {
  if (gasTriggerInstalled_()) return false;
  ScriptApp.newTrigger(GAS_TICK_HANDLER_).timeBased().everyMinutes(gasTickMinutes_()).create();
  gasLog_('installed the ' + GAS_TICK_HANDLER_ + ' trigger, every ' + gasTickMinutes_() + ' minutes');
  return true;
}
function gasGlobal_(name) {
  try { return (typeof globalThis !== 'undefined' ? globalThis : this)[name]; } catch (e) { return undefined; }
}
function gasNotify_(subject, body, isFailure) {
  try {
    var cfg = gasConfig_();
    var hook = cfg && cfg.hooks && cfg.hooks.notify ? gasGlobal_(cfg.hooks.notify) : null;
    if (typeof hook === 'function') { hook(subject, body, !!isFailure); return; }
    var to = Session.getEffectiveUser().getEmail();
    if (!to) { gasLog_('no owner address to notify :: ' + subject); return; }
    MailApp.sendEmail(to, (isFailure ? '[FAIL] ' : '') + subject, String(body || ''));
  } catch (e) { gasLog_('notify failed :: ' + (e && e.message) + ' :: ' + subject); }
}
// The same failure every tick would otherwise mail every five minutes. Once an hour per distinct reason.
function gasNotifyOnce_(key, subject, body, isFailure) {
  var cache = CacheService.getScriptCache();
  var ck = 'GAS_NOTIFIED_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(key)));
  if (cache.get(ck)) return false;
  cache.put(ck, '1', 3600);
  gasNotify_(subject, body, isFailure);
  return true;
}
function gasShort_(v, n) {
  var s = typeof v === 'string' ? v : (v === undefined ? '' : (function () { try { return JSON.stringify(v); } catch (e) { return String(v); } })());
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function gasLog_(msg) { console.log('[gas] ' + msg); }
