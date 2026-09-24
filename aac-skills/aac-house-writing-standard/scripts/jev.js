/**
 * jev - a small client for TypeSafe Jev (POST https://api.typesafe.ai/v1/systemone).
 *
 * One call: ask(state, questions) resolves to the answers map, or to null when
 * Jev is unavailable for any reason (no credential, an auth failure, a timeout,
 * the service down, a malformed reply). It never throws and never logs, so a
 * caller's fallback is "treat null as today's behavior".
 *
 * Credential (issue 731): TYPESAFE_API_KEY, when set, goes out as the bearer
 * header. When it is unset no header is sent: in a cloud session the proxy
 * injects the credential for api.typesafe.ai.
 *
 * Lives beside wr001-lint.js because the linter ships in the plugin payload,
 * where nothing outside this skill's folder resolves.
 */

const http = require("http");
const https = require("https");

const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";

// Node's fetch ignores HTTPS_PROXY, and the cloud proxy is what supplies the
// credential when TYPESAFE_API_KEY is unset. So with a proxy set, tunnel
// through it (HTTP CONNECT); the proxy's CA arrives via NODE_EXTRA_CA_CERTS.
function proxyFor(target) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return null;
  const host = target.hostname;
  const skip = (process.env.NO_PROXY || process.env.no_proxy || "").split(",")
    .map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^\*/, ""));
  const bypass = (e) => e === "" || (e.startsWith(".")
    ? host.endsWith(e) || host === e.slice(1)
    : host === e || host.endsWith(`.${e}`));
  if (skip.some(bypass)) return null;
  return new URL(proxy);
}

function proxyFetch(proxy, url, init) {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const auth = proxy.username ? { "Proxy-Authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` } : {};
    const connect = http.request({
      host: proxy.hostname, port: proxy.port || 80, method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`, headers: auth, signal: init.signal,
    });
    connect.on("error", reject);
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); return reject(new Error(`proxy CONNECT ${res.statusCode}`)); }
      const req = https.request({
        socket, servername: target.hostname, host: target.hostname, path: target.pathname,
        method: init.method, headers: init.headers, signal: init.signal, agent: false,
      }, (r) => {
        let data = "";
        r.setEncoding("utf8");
        r.on("data", (d) => { data += d; });
        r.on("end", () => resolve({ ok: r.statusCode >= 200 && r.statusCode < 300, status: r.statusCode, json: async () => JSON.parse(data) }));
        r.on("error", reject);
      });
      req.on("error", reject);
      req.end(init.body);
    });
    connect.end();
  });
}

function defaultFetch(url, init) {
  const proxy = proxyFor(new URL(url));
  return proxy ? proxyFetch(proxy, url, init) : globalThis.fetch(url, init);
}

function createJev(opts = {}) {
  const url = opts.url || JEV_URL;
  const timeoutMs = opts.timeoutMs || 5000;
  const fetchImpl = opts.fetch || defaultFetch;
  const apiKey = "apiKey" in opts ? opts.apiKey : process.env.TYPESAFE_API_KEY;

  return async function ask(state, questions) {
    if (typeof fetchImpl !== "function") return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ state, model: JEV_MODEL, questions }),
        signal: ctl.signal,
      });
      if (!res || !res.ok) return null;
      const body = await res.json();
      const answers = body && body.answers;
      if (!answers || typeof answers !== "object") return null;
      for (const id of Object.keys(questions)) if (!answers[id]) return null;
      return answers;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

module.exports = { createJev, JEV_URL, JEV_MODEL };
