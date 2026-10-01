#!/usr/bin/env node
/**
 * Web adapter for aac-design audit mode (PRD issue 1079). Renders one page in headless Chromium
 * and writes one evidence bundle. audit.py runs it; run it by hand only to debug.
 *
 *   node web_adapter.js TARGET --out DIR [--signin STEPS.json] [--commit SHA] [--no-axe]
 *
 * TARGET is an .html file or an http(s) URL, a local harness address included. It drives Chromium
 * over the DevTools protocol with Node's own WebSocket, so nothing is installed: the browser is
 * the one already on the machine (AAC_DESIGN_CHROME, CHROME_PATH or CHROME_BIN first, then the
 * usual install paths, then the Playwright cache a cloud session ships with).
 *
 * The bundle keeps the reviewers' inputs apart from the detector's (the A/B rule in CRITIQUE.md):
 *   evidence/  images, structure.json (DOM with computed styles, accessibility tree), text.txt
 *   detector/  measures.json, and axe.json when axe-core ran
 *   bundle.json  the manifest, listing every fault the measures found
 *
 * axe-core is fetched on first use and checked against a pinned sha256; it is never vendored.
 * Exit 0 bundle written, 3 the page could not be audited (no browser, navigation failed).
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const AXE = {
  version: '4.10.2',
  url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js',
  sha256: 'b511cd9dec01c76f4b2ad1723b66b6db37d4c2eb4ed199076e1829d9ee7b75e3',
};

/** Desktop, tablet, phone, and a 1440 px window at 200% zoom (half the CSS width, twice the density). */
const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  { name: 'tablet-768', width: 768, height: 1024, deviceScaleFactor: 1, mobile: false },
  { name: 'phone-390', width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
  { name: 'zoom-200', width: 720, height: 450, deviceScaleFactor: 2, mobile: false },
];
const FORM_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio',
  'spinbutton', 'slider', 'switch', 'button', 'link', 'menuitem', 'tab']);

function die(msg) {
  process.stderr.write(`web_adapter: ${msg}\n`);
  process.exit(3);
}

// ----------------------------------------------------------------------------- browser
function onPath(names) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const n of names) for (const d of dirs) {
    const p = path.join(d, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findChrome() {
  for (const k of ['AAC_DESIGN_CHROME', 'CHROME_PATH', 'CHROME_BIN']) {
    if (process.env[k] && fs.existsSync(process.env[k])) return process.env[k];
  }
  const cands = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (!base) continue;
      cands.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      cands.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    cands.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    cands.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    const hit = onPath(['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']);
    if (hit) return hit;
  }
  // A cloud session's preinstalled Chromium sits in the Playwright cache.
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), process.platform === 'win32' ? 'AppData/Local/ms-playwright' : '.cache/ms-playwright');
  if (fs.existsSync(cache)) {
    for (const d of fs.readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n)).sort().reverse()) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-win/chrome.exe',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) cands.push(path.join(cache, d, rel));
    }
  }
  return cands.find((p) => fs.existsSync(p)) || null;
}

async function launch(bin) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-chrome-'));
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'];
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');
  const proc = spawn(bin, args, { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 300 && !fs.existsSync(portFile); i++) await sleep(50);
  if (!fs.existsSync(portFile)) { proc.kill(); die(`${bin} did not open a DevTools port`); }
  let lines = [];
  for (let i = 0; i < 40 && lines.length < 2; i++) {
    lines = fs.readFileSync(portFile, 'utf8').split('\n').filter(Boolean);
    if (lines.length < 2) await sleep(25);
  }
  const ws = new WebSocket(`ws://127.0.0.1:${lines[0]}${lines[1]}`);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools socket failed')); });
  const close = () => {
    try { ws.close(); } catch (_) { /* already closed */ }
    proc.kill();
    // Chrome holds the profile for a moment after the kill; tidy-up never decides the result.
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* locked */ } }, 500).unref();
  };
  return { ws, close };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** A DevTools client bound to one page session. */
function client(ws) {
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) rej(new Error(`${m.error.message}`)); else res(m.result);
    } else if (m.method) {
      for (const l of listeners) l(m);
    }
  };
  let session;
  const raw = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    pending.set(msg.id, { res, rej });
    ws.send(JSON.stringify(msg));
  });
  return {
    async open() {
      const { targetId } = await raw('Target.createTarget', { url: 'about:blank' });
      ({ sessionId: session } = await raw('Target.attachToTarget', { targetId, flatten: true }));
    },
    send: (method, params) => raw(method, params, session),
    waitFor(method, ms) {
      return new Promise((res) => {
        const t = setTimeout(() => res(null), ms);
        listeners.push((m) => { if (m.method === method && m.sessionId === session) { clearTimeout(t); res(m); } });
      });
    },
  };
}

// ----------------------------------------------------------------------------- page helpers
async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}

async function settle(cdp) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(cdp, 'document.readyState') === 'complete') break;
    await sleep(50);
  }
  await evaluate(cdp, 'document.fonts ? document.fonts.ready.then(() => true) : true');
  await sleep(250);
}

async function navigate(cdp, url) {
  const loaded = cdp.waitFor('Page.loadEventFired', 15000);
  const r = await cdp.send('Page.navigate', { url });
  if (r.errorText) return r.errorText;
  await loaded;
  await settle(cdp);
  return null;
}

async function screenshot(cdp, file) {
  const m = await cdp.send('Page.getLayoutMetrics');
  const size = m.cssContentSize || m.contentSize;
  const vp = m.cssLayoutViewport || m.layoutViewport;
  const clip = { x: 0, y: 0, width: Math.max(vp.clientWidth, Math.ceil(size.width)), height: Math.min(Math.ceil(size.height) || vp.clientHeight, 12000), scale: 1 };
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
}

/** Runs in the page: every element with its computed styles, measured contrast and focusables. */
const DOM_PROBE = `(() => {
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[tabindex],[contenteditable=""],[contenteditable=true]';
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
    let out = { r: 255, g: 255, b: 255, a: 1 }; for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out); return out; };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const sel = (el) => { if (el.id) return '#' + el.id; const parts = []; for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
    let s = e.tagName.toLowerCase(); if (e.id) { parts.unshift('#' + e.id); break; } const sib = e.parentElement ? [...e.parentElement.children].filter((x) => x.tagName === e.tagName) : [];
    if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(e) + 1) + ')'; parts.unshift(s); } return parts.join(' > '); };
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
  const elements = [], contrast = [], focusables = [];
  const all = [...document.body.querySelectorAll('*')].slice(0, 5000);
  for (const el of all) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    const visible = cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    const text = ownText(el).slice(0, 120);
    const row = { selector: sel(el), tag: el.tagName.toLowerCase(), text, rect: [Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)],
      style: { color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontFamily: cs.fontFamily,
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity, outline: cs.outlineStyle + ' ' + cs.outlineWidth, boxShadow: cs.boxShadow,
        animation: cs.animationName, transition: cs.transitionProperty } };
    elements.push(row);
    if (text && visible && r.width > 0 && r.height > 0 && !['script', 'style', 'noscript'].includes(row.tag)) {
      const fg0 = parse(cs.color), bg = bgOf(el); const fg = over(fg0, bg);
      const l1 = lum(fg), l2 = lum(bg); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      contrast.push({ selector: row.selector, text: text.slice(0, 60), fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, required: large ? 3 : 4.5, fontSize: cs.fontSize });
    }
    if (el.matches(FOCUSABLE) && !el.disabled && el.tabIndex >= 0) {
      focusables.push({ selector: row.selector, tag: row.tag, tabIndex: el.tabIndex, width: r.width, height: r.height, visible });
    }
  }
  return { url: location.href, title: document.title, lang: document.documentElement.lang || '',
    elements, contrast, focusables, text: document.body.innerText,
    commit: (document.querySelector('meta[name="aac-commit"],meta[name="commit"],meta[name="git-commit"]') || {}).content || null };
})()`;

const FOCUS_PROBE = `(() => { const el = document.activeElement; if (!el || el === document.body || el === document.documentElement) return null;
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  const sel = el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.getAttribute('name') ? '[name="' + el.getAttribute('name') + '"]' : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : '');
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
  return { selector: sel, width: r.width, height: r.height, ring, href: location.href }; })()`;

// ----------------------------------------------------------------------------- measures
async function axeRun(cdp, noAxe) {
  if (noAxe) return { unavailable: 'skipped with --no-axe' };
  const cacheDir = process.env.AAC_DESIGN_CACHE || path.join(os.tmpdir(), 'aac-design-cache');
  const file = path.join(cacheDir, `axe-${AXE.version}.min.js`);
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  let src = fs.existsSync(file) ? fs.readFileSync(file) : null;
  if (!src || sha(src) !== AXE.sha256) {
    try {
      const r = await fetch(AXE.url);
      if (!r.ok) return { unavailable: `fetching axe-core ${AXE.version} returned HTTP ${r.status}` };
      src = Buffer.from(await r.arrayBuffer());
    } catch (e) {
      return { unavailable: `fetching axe-core ${AXE.version} failed: ${e.message}` };
    }
    if (sha(src) !== AXE.sha256) return { unavailable: `axe-core ${AXE.version} did not match its pinned sha256; not run` };
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, src);
  }
  await evaluate(cdp, `${src.toString('utf8')}\n;true`);
  const res = await evaluate(cdp, `axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags, nodes: v.nodes.map((n) => n.target.join(' ')) })))`);
  return { version: AXE.version, sha256: AXE.sha256, violations: res };
}

async function a11yTree(cdp) {
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const out = [];
  for (const n of nodes) {
    if (n.ignored) continue;
    const role = n.role?.value || '';
    const name = (n.name?.value || '').trim();
    let where = '';
    if (n.backendDOMNodeId && (FORM_ROLES.has(role) || role === 'image' || role === 'img')) {
      try {
        const d = (await cdp.send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId })).node;
        const a = d.attributes || [];
        const attr = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ''; };
        where = d.nodeName.toLowerCase() + (attr('id') ? `#${attr('id')}` : '') + (attr('name') ? `[name="${attr('name')}"]` : '');
      } catch (_) { /* node gone */ }
    }
    if (role === 'StaticText' || role === 'InlineTextBox' || role === 'generic' || role === 'none') continue;
    out.push({ role, name, where });
  }
  return out;
}

async function keyboardWalk(cdp, focusables) {
  await evaluate(cdp, 'document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); true');
  const start = await evaluate(cdp, 'location.href');
  const stops = [];
  const limit = Math.min(400, focusables.length * 2 + 5);
  for (let i = 0; i < limit; i++) {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    }
    await sleep(20);
    const f = await evaluate(cdp, FOCUS_PROBE);
    if (!f) { if (stops.length) break; continue; }
    if (stops.length && f.selector === stops[0].selector) break;
    stops.push(f);
    if (stops.length > 1 && f.selector === stops[stops.length - 2].selector) break;
  }
  return { start, stops };
}

// ----------------------------------------------------------------------------- run
function parseArgs(argv) {
  const a = { target: null, out: null, signin: null, commit: null, noAxe: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--out') a.out = argv[++i];
    else if (k === '--signin') a.signin = argv[++i];
    else if (k === '--commit') a.commit = argv[++i];
    else if (k === '--no-axe') a.noAxe = true;
    else if (!a.target) a.target = k;
    else die(`unexpected argument ${k}`);
  }
  if (!a.target || !a.out) die('usage: web_adapter.js TARGET --out DIR [--signin STEPS.json] [--commit SHA] [--no-axe]');
  return a;
}

async function signIn(cdp, file) {
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
  const sub = (v) => String(v).replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => process.env[k] ?? '');
  for (const s of steps) {
    if (s.goto) { const err = await navigate(cdp, sub(s.goto)); if (err) throw new Error(`sign-in step goto ${s.goto}: ${err}`); }
    else if (s.fill) await evaluate(cdp, `(() => { const e = document.querySelector(${JSON.stringify(s.fill)}); e.focus(); e.value = ${JSON.stringify(sub(s.value))}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    else if (s.click) { const nav = cdp.waitFor('Page.loadEventFired', s.waitMs || 5000); await evaluate(cdp, `document.querySelector(${JSON.stringify(s.click)}).click(), true`); await nav; await settle(cdp); }
    else if (s.waitFor) { for (let i = 0; i < 200 && !(await evaluate(cdp, `!!document.querySelector(${JSON.stringify(s.waitFor)})`)); i++) await sleep(50); }
    else if (s.wait) await sleep(Number(s.wait));
    else throw new Error(`unknown sign-in step ${JSON.stringify(s)}`);
  }
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const isUrl = /^https?:\/\//i.test(a.target);
  const abs = isUrl ? null : path.resolve(a.target);
  if (!isUrl && !fs.existsSync(abs)) die(`${a.target} does not exist`);
  const url = isUrl ? a.target : pathToFileURL(abs).href;
  const bin = findChrome();
  if (!bin) die('no Chromium found; set AAC_DESIGN_CHROME to a Chrome, Edge or Chromium binary');

  const out = path.resolve(a.out);
  for (const d of ['evidence/images', 'detector']) fs.mkdirSync(path.join(out, d), { recursive: true });
  const { ws, close } = await launch(bin);
  const faults = [];
  const unavailable = [];
  const images = [];
  const measures = {};
  const fault = (measure, kind, where, detail) => faults.push({ measure, kind, where: String(where || '').slice(0, 160), detail: String(detail || '') });
  try {
    const cdp = client(ws);
    await cdp.open();
    for (const d of ['Page', 'Runtime', 'DOM', 'Accessibility', 'Network']) await cdp.send(`${d}.enable`);
    if (a.signin) await signIn(cdp, a.signin);
    const navErr = await navigate(cdp, url);
    if (navErr) throw new Error(`${url} did not load: ${navErr}`);

    // Every viewport: an image, and whether the page reflows without sideways scrolling.
    const reflow = [];
    for (const v of VIEWPORTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: v.mobile });
      await sleep(200);
      const rel = `evidence/images/${v.name}.png`;
      await screenshot(cdp, path.join(out, rel));
      images.push({ path: rel, label: v.name === 'zoom-200' ? '1440 px window at 200% zoom' : `${v.width} px viewport` });
      const w = await evaluate(cdp, '({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })');
      reflow.push({ viewport: v.name, ...w, overflow: w.scroll > w.client + 1 });
      if (w.scroll > w.client + 1 && v.width <= 720) fault('web.zoom-200', 'horizontal-scroll', v.name, `content ${w.scroll} px wide in a ${w.client} px viewport`);
    }
    measures['web.zoom-200'] = { viewports: reflow };
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(200);

    const dom = await evaluate(cdp, DOM_PROBE);
    const tree = await a11yTree(cdp);
    fs.writeFileSync(path.join(out, 'evidence', 'structure.json'), JSON.stringify({ url: dom.url, title: dom.title, lang: dom.lang, dom: dom.elements, accessibility_tree: tree }, null, 1));
    fs.writeFileSync(path.join(out, 'evidence', 'text.txt'), dom.text);

    measures['web.contrast'] = { checked: dom.contrast.length, below: dom.contrast.filter((c) => c.ratio < c.required) };
    for (const c of measures['web.contrast'].below) fault('web.contrast', 'low-contrast-text', c.selector, `"${c.text}" ${c.fg} on ${c.bg} = ${c.ratio}:1, needs ${c.required}:1`);

    const unnamed = tree.filter((n) => FORM_ROLES.has(n.role) && !n.name);
    const images0 = tree.filter((n) => (n.role === 'image' || n.role === 'img') && !n.name);
    const landmarks = tree.filter((n) => ['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'region', 'form', 'search'].includes(n.role)).map((n) => n.role);
    measures['web.a11y-tree'] = { nodes: tree.length, landmarks, unnamed_controls: unnamed, unnamed_images: images0, lang: dom.lang };
    for (const n of unnamed) fault('web.a11y-tree', `unnamed-${n.role}`, n.where, `a ${n.role} with no accessible name`);
    for (const n of images0) fault('web.a11y-tree', 'unnamed-image', n.where, 'an image with no accessible name');
    if (!landmarks.includes('main')) fault('web.a11y-tree', 'no-main-landmark', dom.url, 'the page has no main landmark');
    if (!dom.lang) fault('web.a11y-tree', 'no-page-language', dom.url, 'the html element has no lang attribute');

    measures['web.target-size'] = { focusables: dom.focusables };
    for (const f of dom.focusables) {
      if (f.width < 1 || f.height < 1) fault('web.target-size', 'zero-size-focusable', f.selector, `${f.tag} is focusable at ${Math.round(f.width)}x${Math.round(f.height)} px`);
      else if (f.width < 44 || f.height < 44) fault('web.target-size', 'target-below-44', f.selector, `${Math.round(f.width)}x${Math.round(f.height)} px`);
    }

    const walk = await keyboardWalk(cdp, dom.focusables);
    const reached = new Set(walk.stops.map((s) => s.selector));
    measures['web.keyboard-walk'] = walk;
    for (const s of walk.stops) {
      if (s.width < 1 || s.height < 1) fault('web.keyboard-walk', 'focus-on-invisible', s.selector, 'Tab lands on an element with no visible size');
      else if (!s.ring) fault('web.keyboard-walk', 'no-visible-focus', s.selector, 'focused with no outline or shadow');
      if (s.href !== walk.start) fault('web.keyboard-walk', 'change-on-focus', s.selector, `focus moved the page to ${s.href}`);
    }
    const n = walk.stops.length;
    if (n > 1 && walk.stops[n - 1].selector === walk.stops[n - 2].selector) fault('web.keyboard-walk', 'focus-trap', walk.stops[n - 1].selector, 'Tab does not leave this element');
    for (const f of dom.focusables) {
      if (f.visible && f.width > 0 && f.height > 0 && !reached.has(f.selector) && !walk.stops.some((s) => f.selector.endsWith(s.selector))) {
        fault('web.keyboard-walk', 'unreachable', f.selector, 'focusable but never reached by Tab');
      }
    }

    const axe = await axeRun(cdp, a.noAxe);
    if (axe.unavailable) unavailable.push({ what: 'web.axe', why: axe.unavailable });
    else {
      fs.writeFileSync(path.join(out, 'detector', 'axe.json'), JSON.stringify(axe, null, 1));
      measures['web.axe'] = { version: axe.version, violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) };
      for (const v of axe.violations) for (const node of v.nodes) fault('web.axe', v.id, node, `${v.impact}: ${v.help}`);
    }

    // The same page under reduced motion, forced colours and offline.
    const animations = 'document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running").length : 0';
    const before = await evaluate(cdp, animations);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await navigate(cdp, url);
    const reduced = await evaluate(cdp, animations);
    await screenshot(cdp, path.join(out, 'evidence/images/reduced-motion.png'));
    images.push({ path: 'evidence/images/reduced-motion.png', label: 'prefers-reduced-motion: reduce' });
    measures['web.reduced-motion'] = { running_animations: before, under_reduce: reduced };
    if (reduced > 0) fault('web.reduced-motion', 'motion-under-reduce', dom.url, `${reduced} animations still run with reduced motion requested`);

    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await navigate(cdp, url);
    await screenshot(cdp, path.join(out, 'evidence/images/forced-colors.png'));
    images.push({ path: 'evidence/images/forced-colors.png', label: 'forced-colors: active' });
    measures['web.forced-colors'] = { image: 'evidence/images/forced-colors.png' };
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const offErr = await navigate(cdp, url);
    await screenshot(cdp, path.join(out, 'evidence/images/offline.png'));
    images.push({ path: 'evidence/images/offline.png', label: 'offline' });
    const offText = await evaluate(cdp, 'document.body ? document.body.innerText.slice(0, 2000) : ""');
    measures['web.offline'] = { navigation_error: offErr, text: offText };
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    fs.writeFileSync(path.join(out, 'detector', 'measures.json'), JSON.stringify(measures, null, 1));
    const stamp_key = isUrl
      ? { kind: 'url', url: a.target, commit: a.commit || dom.commit || null }
      : { kind: 'file', path: abs, sha256: crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex') };
    const bundle = {
      schema: 'aac-design-evidence/1', surface: 'web', catalog_surface: 'web', target: isUrl ? a.target : abs,
      adapter: 'web_adapter.js', browser: path.basename(bin), stamp_key,
      evidence: { images, structure: 'evidence/structure.json', text: 'evidence/text.txt' },
      detector: { measures: 'detector/measures.json', axe: fs.existsSync(path.join(out, 'detector', 'axe.json')) ? 'detector/axe.json' : null },
      measures: Object.keys(measures).sort(), faults, unavailable,
    };
    fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
    process.stdout.write(`${path.join(out, 'bundle.json')}\n`);
  } finally {
    close();
  }
}

main().then(() => process.exit(0), (e) => die(e.message));
