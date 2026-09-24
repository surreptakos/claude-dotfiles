#!/usr/bin/env node
// A small TypeSafe Jev client: one POST to https://api.typesafe.ai/v1/systemone, answers or null.
// Issue 724 (the tracker audit's stale-premise? Choice); the fleet model-routing ticket reuses it.
//
// Credential (owner, 2026-09-24): TYPESAFE_API_KEY is sent as the bearer token when it is set. When
// it is unset no header is sent: in a cloud session the egress proxy injects the credential for
// api.typesafe.ai. With neither a key nor a proxy (a GitHub Actions runner) no request is made at all.
//
// Every failure - no credential, a timeout, a refused auth, a 5xx, a malformed body - returns null,
// never throws: the caller's own code answers then. Jev is an addition, not a dependency.
//
//   askJev(state, questions, opts)      -> Promise<answers | null>
//   askJevSync(state, questions, opts)  -> answers | null   (runs askJev in a child node process)
'use strict';

const https = require('https');
const http = require('http');
const tls = require('tls');

const HOST = 'api.typesafe.ai';
const PATH = '/v1/systemone';
const MODEL = 'jev-latest';
const DEFAULT_TIMEOUT_MS = 5000;

/** The proxy URL to tunnel through, or null. Honours NO_PROXY for this host. Pure. */
function proxyFor(env) {
  const raw = env.HTTPS_PROXY || env.https_proxy || '';
  if (!raw) return null;
  const noProxy = String(env.NO_PROXY || env.no_proxy || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (noProxy.some((d) => d === '*' || HOST === d.replace(/^\./, '') || HOST.endsWith('.' + d.replace(/^\./, '')))) {
    return null;
  }
  try { return new URL(raw); } catch (e) { return null; }
}

/** Can a request possibly authenticate here? A key, or a proxy that may inject one. Pure. */
function jevReachable(env) {
  return Boolean((env || {}).TYPESAFE_API_KEY || proxyFor(env || {}));
}

/** POST one evaluation. Resolves to the `answers` map, or null on any failure. */
function askJev(state, questions, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  if (!jevReachable(env)) return Promise.resolve(null);
  const payload = JSON.stringify({ state, model: o.model || MODEL, questions });
  const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
  if (env.TYPESAFE_API_KEY) headers.Authorization = 'Bearer ' + env.TYPESAFE_API_KEY;
  const proxy = proxyFor(env);

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const send = (socket) => {
      const req = https.request({ host: HOST, path: PATH, method: 'POST', headers, servername: HOST,
                                  createConnection: socket ? () => socket : undefined }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return finish(null);
          try {
            const parsed = JSON.parse(body);
            finish(parsed && parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : null);
          } catch (e) { finish(null); }
        });
      });
      req.on('error', () => finish(null));
      req.setTimeout(timeoutMs, () => { req.destroy(); finish(null); });
      req.end(payload);
    };
    if (!proxy) return send(null);
    // Node's https does not read HTTPS_PROXY, so open the CONNECT tunnel by hand.
    const connect = http.request({ host: proxy.hostname, port: proxy.port || 80, method: 'CONNECT',
                                   path: HOST + ':443', headers: Object.assign({ Host: HOST + ':443' },
                                     proxy.username ? { 'Proxy-Authorization': 'Basic ' + Buffer.from(
                                       decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64') } : {}) });
    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return finish(null); }
      send(tls.connect({ socket, servername: HOST }));
    });
    connect.on('error', () => finish(null));
    connect.end();
  });
}

/** Synchronous form for scripts written around execSync (tools/tracker-audit.js). Spawns this file
 *  with the request on stdin; a child that fails, hangs past the timeout or prints junk is null. */
function askJevSync(state, questions, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  if (!jevReachable(env)) return null;
  const timeoutMs = o.timeoutMs || DEFAULT_TIMEOUT_MS;
  try {
    const out = require('child_process').execFileSync(process.execPath, [__filename], {
      input: JSON.stringify({ state, questions, model: o.model, timeoutMs }),
      env, timeout: timeoutMs + 2000, stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8',
    });
    const parsed = JSON.parse(out);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { input += c; });
  process.stdin.on('end', async () => {
    let req;
    try { req = JSON.parse(input); } catch (e) { process.stdout.write('null'); return; }
    const answers = await askJev(req.state, req.questions, { model: req.model, timeoutMs: req.timeoutMs });
    process.stdout.write(JSON.stringify(answers));
    process.exit(0);
  });
} else {
  module.exports = { askJev, askJevSync, jevReachable, proxyFor, MODEL };
}
