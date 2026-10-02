#!/usr/bin/env node
// Web adapter for aac-design audit mode (issue 1084): one run, one evidence bundle.
//
//   node web_audit.js <url | page.html> --out DIR [--signin steps.json] [--commit SHA]
//                     [--chrome PATH] [--axe axe.min.js] [--wait-for SELECTOR]
//
// A local harness is just its address (http://localhost:PORT/...). --signin names a JSON list of
// steps run in the same browser before the audit: {"goto": url}, {"fill": selector, "value": text
// | {"env": NAME}}, {"click": selector}, {"waitFor": selector}. Secrets come from the environment,
// never from the steps file.
//
// No dependencies: the browser is driven over the DevTools protocol with Node's own WebSocket.
// The browser is the preinstalled one (CHROME_PATH, the Playwright Chromium under
// PLAYWRIGHT_BROWSERS_PATH or /opt/pw-browsers, then Chrome, Chromium or Edge); nothing is
// downloaded. axe-core is fetched once at the pinned version and refused unless its sha256 matches.
//
// The bundle (DIR):
//   bundle.json        target, subject (file sha256, or URL plus deployed commit), measures,
//                      and which files reviewers may see before their ledger rows are in; the
//                      shape every adapter writes, checked by evidence.py validate DIR
//   shot-*.png         1440, 768 and 390 px, 200% zoom, reduced motion, forced colours, offline
//   dom.json           every element with its computed styles and box
//   styles.json        every CSS rule with its @media / @supports conditions, the stylesheets and fonts
//   source.json        the page's own code: each script's size and the user-text fragments it joins with +,
//                      raw values against tokens in every stylesheet and style attribute, bytes per resource
//   probes.json        the painted palette by hue family, hidden text hovered against tapped, and each
//                      in-place view switch, online (transitions started) and with the network cut
//   shot-failed-switch-N.png  the page after view switch N failed offline
//   a11y-tree.json     the browser accessibility tree
//   keyboard-walk.json the scripted Tab walk, one entry per stop
//   text.txt           the page's plain text
//   axe.json           axe-core violations          (detector: withheld until rows are in)
//   findings.json      every fault the probes found (detector: withheld until rows are in)
//
// Exit 0 = bundle written (faults or not), 2 = usage, 3 = no browser or the page did not load.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const AXE = {
  version: '4.10.2',
  url: 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js',
  sha256: 'b511cd9dec01c76f4b2ad1723b66b6db37d4c2eb4ed199076e1829d9ee7b75e3',
};
const WIDTHS = [1440, 768, 390];
const HEIGHT = 900;
const CATALOG = path.join(__dirname, '..', 'catalog', 'CATALOG.json');
const REVIEW_SET = ['shot-1440.png', 'shot-768.png', 'shot-390.png', 'shot-zoom200.png', 'shot-reduced-motion.png',
  'shot-forced-colors.png', 'shot-offline.png', 'dom.json', 'styles.json', 'source.json', 'probes.json', 'a11y-tree.json',
  'keyboard-walk.json', 'text.txt'];
const DETECTOR_SET = ['axe.json', 'findings.json'];
const CONTROL_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'slider',
  'spinbutton', 'switch', 'button', 'link', 'menuitem', 'tab', 'option']);

function usage(msg) {
  if (msg) console.error(`web_audit: ${msg}`);
  console.error('usage: node web_audit.js <url | page.html> --out DIR [--signin steps.json] [--commit SHA] '
    + '[--chrome PATH] [--axe FILE] [--wait-for SELECTOR]');
  process.exit(2);
}

function parseArgs(argv) {
  const a = { target: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const val = () => { if (i + 1 >= argv.length) usage(`${k} needs a value`); return argv[++i]; };
    if (k === '--out') a.out = val();
    else if (k === '--signin') a.signin = val();
    else if (k === '--commit') a.commit = val();
    else if (k === '--chrome') a.chrome = val();
    else if (k === '--axe') a.axe = val();
    else if (k === '--wait-for') a.waitFor = val();
    else if (k.startsWith('--')) usage(`unknown option ${k}`);
    else if (!a.target) a.target = k;
    else usage(`unexpected argument ${k}`);
  }
  if (!a.target || !a.out) usage();
  return a;
}

// ------------------------------------------------------------------ browser discovery
function findChrome(explicit) {
  const tries = [];
  if (explicit) tries.push(explicit);
  if (process.env.CHROME_PATH) tries.push(process.env.CHROME_PATH);
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers',
    path.join(os.homedir(), '.cache', 'ms-playwright')].filter(Boolean)) {
    let dirs = [];
    try { dirs = fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { /* none */ }
    for (const d of dirs) {
      tries.push(path.join(root, d, 'chrome-linux', 'chrome'), path.join(root, d, 'chrome-win', 'chrome.exe'),
        path.join(root, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
    }
  }
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      tries.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    tries.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) tries.push(r.stdout.trim());
    }
  }
  return tries.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

// ------------------------------------------------------------------ DevTools protocol
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject, method } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result);
      } else if (m.method) {
        for (const l of this.listeners) l(m);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(msg));
    });
  }
  waitFor(method, sessionId, ms) {
    return new Promise((resolve) => {
      const l = (m) => {
        if (m.method === method && (!sessionId || m.sessionId === sessionId)) done(true);
      };
      const t = setTimeout(() => done(false), ms);
      const done = (ok) => { clearTimeout(t); this.listeners = this.listeners.filter((x) => x !== l); resolve(ok); };
      this.listeners.push(l);
    });
  }
}

async function launch(chrome) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-web-audit-profile-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    '--force-color-profile=srgb',
    // Headless reports no pointer and no hover, so (hover: hover) rules never apply; a desktop reader has a
    // mouse. The phone width turns touch emulation on, which reports a coarse pointer and no hover.
    '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4',
    'about:blank'];
  // Linux containers and GitHub runners refuse Chrome's user-namespace sandbox.
  if (process.platform === 'linux') args.unshift('--no-sandbox');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error(`browser did not start: ${buf.slice(-400)}`)), 30000);
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(t); resolve(m[1]); }
    });
    proc.on('exit', (code) => { clearTimeout(t); reject(new Error(`browser exited ${code}: ${buf.slice(-400)}`)); });
  });
  proc.stderr.removeAllListeners('data');
  proc.stderr.resume();
  if (typeof WebSocket === 'undefined') throw new Error('this Node has no global WebSocket (needs Node 22 or later)');
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('cannot reach the DevTools socket')); });
  const close = () => {
    try { ws.close(); } catch { /* gone */ }
    try { proc.kill('SIGKILL'); } catch { /* gone */ }
    // The profile is scratch; a locked file on Windows must not fail the audit.
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* left */ } }, 300);
  };
  return { cdp: new CDP(ws), close };
}

// ------------------------------------------------------------------ axe-core, pinned and hash-checked
async function loadAxe(explicit) {
  const check = (buf, where) => {
    const got = crypto.createHash('sha256').update(buf).digest('hex');
    if (got !== AXE.sha256) throw new Error(`axe-core at ${where} has sha256 ${got}, expected ${AXE.sha256}`);
    return buf.toString('utf8');
  };
  if (explicit) return check(fs.readFileSync(explicit), explicit);
  const cacheDir = process.env.AAC_DESIGN_ENGINE_CACHE || path.join(os.tmpdir(), 'aac-design-engines');
  const cached = path.join(cacheDir, `axe-core-${AXE.version}.min.js`);
  try { return check(fs.readFileSync(cached), cached); } catch { /* fetch it */ }
  const res = await fetch(AXE.url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${AXE.url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const src = check(buf, AXE.url);
  try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cached, buf); } catch { /* cache is optional */ }
  return src;
}

// ------------------------------------------------------------------ in-page probes
// Runs in the page. Returns the DOM with computed styles, contrast, target sizes and landmarks.
const PAGE_HELPERS = `(() => {
  window.__aacPath = function (el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      let s = el.localName;
      const p = el.parentElement;
      if (p) {
        const same = Array.from(p.children).filter((c) => c.localName === el.localName);
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(s);
      if (el.id) { parts[0] = '#' + CSS.escape(el.id); break; }
      el = p;
    }
    return parts.join(' > ');
  };
  window.__aacFocusable = function () {
    const q = 'a[href], area[href], button, input:not([type=hidden]), select, textarea, iframe, summary, [tabindex], [contenteditable=""], [contenteditable=true]';
    return Array.from(document.querySelectorAll(q)).filter((el) => !el.disabled && el.tabIndex >= 0
      && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0);
  };
  return true;
})()`;

const DOM_PROBE = `(() => {
  const PROPS = ['display', 'visibility', 'opacity', 'color', 'background-color', 'font-family', 'font-size',
    'font-weight', 'line-height', 'outline-style', 'outline-width', 'box-shadow', 'position', 'overflow',
    'forced-color-adjust', 'animation-name', 'transition-property',
    // Spacing, shape and case, so a reviewer can measure a spacing scale, radii and all-caps labels (issue 1087).
    'margin', 'padding', 'gap', 'border-width', 'border-style', 'border-color', 'border-radius', 'letter-spacing',
    'text-transform', 'text-align', 'font-style', 'text-decoration-line', 'max-width',
    // Timing, numerals, wrapping, touch, stacking and pointer, so motion and craft rules have a measure.
    'transition-duration', 'transition-timing-function', 'animation-duration', 'font-variant-numeric', 'text-wrap',
    'touch-action', 'z-index', 'cursor'];
  const parse = (c) => {
    const m = c && c.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const background = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const elements = [];
  const contrast = [];
  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const style = {};
    for (const p of PROPS) style[p] = cs.getPropertyValue(p);
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    elements.push({ path: __aacPath(el), tag: el.localName, box: [r.x, r.y, r.width, r.height].map(Math.round), style,
      ...(own && !/^(script|style)$/.test(el.localName) ? { text: own.slice(0, 80) } : {}) });
    if (!own || cs.visibility === 'hidden' || cs.display === 'none' || r.width === 0 || r.height === 0) continue;
    const fg0 = parse(cs.color);
    const bg = background(el);
    if (!fg0 || !bg) continue;
    const fg = over({ ...fg0, a: fg0.a * Number(cs.opacity || 1) }, bg);
    const L1 = lum(fg), L2 = lum(bg);
    const ratio = Math.round(100 * (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) / 100;
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && Number(cs.fontWeight) >= 700);
    contrast.push({ path: __aacPath(el), text: own.slice(0, 80), fg: hex(fg), bg: hex(bg), ratio, large,
      required: large ? 3 : 4.5, pass: ratio >= (large ? 3 : 4.5) });
  }
  const targets = __aacFocusable().map((el) => {
    const r = el.getBoundingClientRect();
    return { path: __aacPath(el), tag: el.localName, width: Math.round(r.width), height: Math.round(r.height) };
  });
  const landmarks = Array.from(document.querySelectorAll('main, nav, header, footer, aside, [role=main], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search]'))
    .map((el) => el.getAttribute('role') || el.localName);
  const motion = document.getAnimations ? document.getAnimations().filter((a) => a.playState === 'running').length : 0;
  return JSON.stringify({ elements, contrast, targets, landmarks, runningAnimations: motion,
    title: document.title, lang: document.documentElement.lang || '',
    commit: (document.querySelector('meta[name="deployed-commit"]') || {}).content || null });
})()`;

// Every CSS rule the page carries, with the @media / @supports conditions it sits under, plus the
// stylesheets and fonts it loads. The computed styles in dom.json show one resting state; rules for
// :active, :hover, :focus-visible, ::selection, prefers-reduced-motion and width breakpoints only show
// here (issue 1087: the rep-board rerun could not judge press feedback or reduced motion without them).
const STYLE_PROBE = `(() => {
  const rules = [];
  const sheets = [];
  const walk = (list, cond, sheet) => {
    for (const r of Array.from(list || [])) {
      if (r.cssRules && !r.selectorText) {
        walk(r.cssRules, cond.concat(r.cssText.split('{')[0].trim()), sheet); // "@media (max-width: 640px)"
      } else {
        rules.push({ sheet, ...(cond.length ? { cond } : {}), css: r.cssText.length > 600 ? r.cssText.slice(0, 600) + '…' : r.cssText });
      }
    }
  };
  Array.from(document.styleSheets).forEach((s, i) => {
    const name = s.href || ('inline#' + i);
    try { walk(s.cssRules, [], name); sheets.push({ sheet: name, rules: s.cssRules.length }); }
    catch (e) { sheets.push({ sheet: name, unreadable: true }); }
  });
  const links = Array.from(document.querySelectorAll('link[href]')).map((l) => ({ rel: l.rel, href: l.href }));
  const fonts = document.fonts ? Array.from(document.fonts).map((f) => ({ family: f.family, weight: f.weight, style: f.style, status: f.status })) : [];
  return JSON.stringify({ sheets, links, fonts, rules, htmlBytes: document.documentElement.outerHTML.length,
    scripts: document.scripts.length });
})()`;

// The page's own code, for rules a rendered page cannot show (issue 1087: the rep-board rerun could not
// see strings concatenated in the board's logic, raw px one-offs or the weight of one inlined document).
// Every script with its size and the user-text fragments it joins with +, every declaration in a
// stylesheet or a style attribute, and the bytes each resource cost.
const SOURCE_PROBE = `(async () => {
  const scripts = [];
  for (const [i, s] of Array.from(document.scripts).entries()) {
    let text = s.src ? null : s.textContent;
    if (s.src) { try { const r = await fetch(s.src); text = r.ok ? await r.text() : null; } catch (e) { text = null; } }
    scripts.push({ index: i, src: s.src || null, type: s.type || '', text });
  }
  const inline = Array.from(document.querySelectorAll('[style]')).map((el) => el.getAttribute('style'));
  return JSON.stringify({ htmlChars: document.documentElement.outerHTML.length, scripts, inline,
    styleTags: Array.from(document.querySelectorAll('style')).reduce((n, s) => n + s.textContent.length, 0) });
})()`;

// A quoted fragment of words joined to an expression with +: 'Due on ' + date, n + ' deals'.
const CONCAT = /(["'])((?:\\.|(?!\1)[^\\\n]){2,120}?)\1\s*\+\s*[\w$.([]|[\w$)\]]\s*\+\s*(["'])((?:\\.|(?!\3)[^\\\n]){2,120}?)\3/g;
const userText = (s) => /[A-Za-z]{2,}/.test(s) && /\s/.test(s) && !/[<>{};=#]|https?:/.test(s);

function sourceMeasures(src, styleRules) {
  const scripts = src.scripts.map((s) => {
    const text = s.text || '';
    const found = [];
    for (const m of text.matchAll(CONCAT)) {
      if (userText(m[2] || m[4] || '')) found.push(m[0].slice(0, 160));
    }
    return { index: s.index, src: s.src, type: s.type, chars: text.length, head: text.trim().slice(0, 120),
      uiConcatenations: found.length, examples: found.slice(0, 12) };
  });
  // Declarations from the stylesheets and the style attributes, split into token use and raw values.
  const decls = [];
  for (const r of styleRules) {
    const body = r.css.slice(r.css.indexOf('{') + 1, r.css.lastIndexOf('}'));
    for (const d of body.split(';')) decls.push({ from: 'stylesheet', d });
  }
  for (const s of src.inline) for (const d of String(s).split(';')) decls.push({ from: 'style attribute', d });
  const groups = { spacing: /^(margin|padding|gap|row-gap|column-gap)(-|$)/, fontSize: /^font-size$/,
    radius: /^border(-[a-z]+)*-radius$/, color: /^(color|background(-color)?|border(-[a-z]+)*-color|fill|stroke)$/ };
  const cssValues = {};
  for (const [g, re] of Object.entries(groups)) {
    const v = { declarations: 0, usingTokens: 0, raw: {}, fromStyleAttributes: 0 };
    for (const { from, d } of decls) {
      const i = d.indexOf(':');
      if (i < 0 || !re.test(d.slice(0, i).trim().toLowerCase())) continue;
      const val = d.slice(i + 1).trim();
      v.declarations++;
      if (from === 'style attribute') v.fromStyleAttributes++;
      if (/var\(--/.test(val)) v.usingTokens++;
      const bare = val.replace(/var\([^)]*\)/g, '');
      const raws = g === 'color' ? bare.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi)
        : bare.match(/-?\d*\.?\d+(px|rem|em)\b/g);
      for (const x of raws || []) if (!/^-?0(px|rem|em)?$/.test(x)) v.raw[x.toLowerCase()] = (v.raw[x.toLowerCase()] || 0) + 1;
    }
    v.distinctRaw = Object.keys(v.raw).length;
    if (g === 'spacing') v.offFourPxScale = Object.keys(v.raw).filter((x) => /px$/.test(x) && parseFloat(x) % 4 !== 0);
    cssValues[g] = v;
  }
  return { htmlChars: src.htmlChars, styleTagChars: src.styleTags,
    scriptChars: scripts.reduce((n, s) => n + s.chars, 0), scripts, cssValues };
}

// The colours the page paints, by hue family, so a palette rule ("one accent") has a measure.
function palette(elements) {
  const fams = {};
  const rgb = (c) => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const hsl = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2; const d = mx - mn; if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1)); let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360; return { h, s, l }; };
  const family = (h) => (h < 15 || h >= 345 ? 'red' : h < 50 ? 'orange-amber' : h < 70 ? 'yellow' : h < 170 ? 'green'
    : h < 200 ? 'cyan' : h < 260 ? 'blue' : 'purple-pink');
  for (const el of elements) {
    if (el.style.display === 'none' || el.style.visibility === 'hidden' || !el.box[2] || !el.box[3]) continue;
    const uses = [['text', el.text ? el.style.color : null], ['background', el.style['background-color']],
      ['border', parseFloat(el.style['border-width']) > 0 && el.style['border-style'] !== 'none' ? el.style['border-color'] : null]];
    for (const [use, c] of uses) {
      const x = rgb(c);
      if (!x || x.a < 0.1) continue;
      const { h, s, l } = hsl(x);
      if (s < 0.25 || l < 0.12 || l > 0.93) continue; // neutrals, near-black and near-white
      const f = (fams[family(h)] = fams[family(h)] || { elements: 0, uses: {}, colors: {} });
      f.elements++; f.uses[use] = (f.uses[use] || 0) + 1;
      const hex = '#' + [x.r, x.g, x.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
      f.colors[hex] = (f.colors[hex] || 0) + 1;
    }
  }
  return { chromaticFamilies: Object.keys(fams).length, families: fams,
    rule: 'saturation 0.25 or more and lightness 0.12 to 0.93; text colour counted only on elements with their own text' };
}

// Text that is painted invisible (opacity 0 or visibility hidden) inside a laid-out box: the usual shape of
// a value shown only on hover. The candidates are kept on window so a later step can hover or tap them.
const HIDDEN_TEXT_PROBE = `(() => {
  window.__aacHidden = Array.from(document.body ? document.body.querySelectorAll('*') : []).filter((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return (el.innerText || '').trim() && cs.display !== 'none' && r.width > 0 && r.height > 0
      && (Number(cs.opacity) < 0.1 || cs.visibility === 'hidden')
      && !(el.parentElement && Number(getComputedStyle(el.parentElement).opacity) < 0.1);
  }).slice(0, 40);
  return window.__aacHidden.length;
})()`;
const HIDDEN_POINT = (i, which) => `(() => {
  const el = window.__aacHidden[${i}];
  const t = ${JSON.stringify(which)} === 'parent' ? el.parentElement : el.previousElementSibling;
  if (!t) return 'null';
  t.scrollIntoView({ block: 'center' });
  const r = t.getBoundingClientRect();
  return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2, trigger: __aacPath(t), focusable: t.tabIndex >= 0 });
})()`;
const HIDDEN_SHOWN = (i) => `(() => { const cs = getComputedStyle(window.__aacHidden[${i}]);
  return Number(cs.opacity) > 0.5 && cs.visibility !== 'hidden'; })()`;

// A view switch: records the transitions and animations that start, and which elements the swap touched.
const SWITCH_ARM = `(() => {
  const w = window.__aacSwitch = { events: [], mutated: [], maxRunning: 0, t0: performance.now(), firstChange: null };
  const on = (type) => (e) => w.events.push({ type, prop: e.propertyName || e.animationName || '', target: e.target,
    ms: Math.round(performance.now() - w.t0) });
  w.off = [['transitionrun', on('transition')], ['animationstart', on('animation')]];
  for (const [t, f] of w.off) document.addEventListener(t, f, true);
  w.mo = new MutationObserver((list) => { if (w.firstChange === null) w.firstChange = Math.round(performance.now() - w.t0);
    for (const m of list) if (w.mutated.length < 300) w.mutated.push(m.target.nodeType === 1 ? m.target : m.target.parentElement); });
  w.mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  w.poll = setInterval(() => { w.maxRunning = Math.max(w.maxRunning, document.getAnimations ? document.getAnimations().length : 0); }, 25);
  w.before = document.body.innerText;
  return true;
})()`;
const SWITCH_READ = `(() => {
  const w = window.__aacSwitch;
  clearInterval(w.poll); w.mo.disconnect();
  for (const [t, f] of w.off) document.removeEventListener(t, f, true);
  const touched = (el) => el && w.mutated.some((m) => m && (m === el || m.contains(el) || el.contains(m)));
  const ev = w.events.map((e) => ({ type: e.type, prop: e.prop, ms: e.ms, target: __aacPath(e.target), onSwappedContent: touched(e.target) }));
  const after = document.body.innerText;
  const lines = new Set(w.before.split('\\n').map((s) => s.trim()));
  const added = Array.from(new Set(after.split('\\n').map((s) => s.trim()).filter((s) => s && !lines.has(s)))).slice(0, 20);
  const retry = Array.from(document.querySelectorAll('button, a[href], [role=button], input[type=button], input[type=submit]'))
    .filter((el) => el.getClientRects().length && /try again|retry|reload|refresh/i.test(el.innerText || el.value || el.getAttribute('aria-label') || ''))
    .map((el) => __aacPath(el));
  const alerts = Array.from(document.querySelectorAll('[role=alert], [role=status], [aria-live]'))
    .map((el) => (el.innerText || '').trim()).filter(Boolean).slice(0, 10);
  return JSON.stringify({ textChanged: after !== w.before, firstChangeMs: w.firstChange, events: ev.slice(0, 40),
    maxRunningAnimations: w.maxRunning, addedLines: added, retryControls: retry, liveRegions: alerts, url: location.href });
})()`;
// The controls that replace the page's content in place: selects with a choice to make, unselected tabs.
const SWITCH_CONTROLS = `JSON.stringify(Array.from(document.querySelectorAll('select, [role=tab]')).filter((el) =>
  !el.disabled && el.getClientRects().length && (el.localName !== 'select' || el.options.length > 1)
  && (el.localName === 'select' || el.getAttribute('aria-selected') !== 'true')).slice(0, 3).map((el) => __aacPath(el)))`;
const SWITCH_DO = (sel, restore) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return 'null';
  if (el.localName !== 'select') { el.click(); return JSON.stringify({ to: (el.innerText || '').trim().slice(0, 60) }); }
  const from = el.selectedIndex;
  const to = ${restore === undefined ? '(from + 1) % el.options.length' : Number(restore)};
  el.selectedIndex = to;
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  return JSON.stringify({ from, to, fromText: el.options[from].text.slice(0, 60), toText: el.options[to].text.slice(0, 60) });
})()`;

const OVERFLOW_PROBE = `JSON.stringify({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  clipped: Array.from(document.body ? document.body.querySelectorAll('*') : []).filter((el) => {
    const cs = getComputedStyle(el);
    return /hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
  }).slice(0, 50).map((el) => __aacPath(el)) })`;

const ACTIVE_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return JSON.stringify({ path: null, url: location.href });
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
  const ring = outline || (cs.boxShadow && cs.boxShadow !== 'none');
  return JSON.stringify({ path: __aacPath(el), tag: el.localName, name: el.getAttribute('aria-label') || (el.innerText || '').trim().slice(0, 60),
    box: [r.x, r.y, r.width, r.height].map(Math.round), visibleFocus: !!ring, url: location.href });
})()`;

// ------------------------------------------------------------------ the run
async function audit(a) {
  const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(a.target);
  let subject;
  let url;
  if (isUrl) {
    url = a.target;
    subject = { kind: 'url', url, commit: a.commit || null };
  } else {
    const file = path.resolve(a.target);
    if (!fs.existsSync(file)) usage(`no such file: ${a.target}`);
    url = pathToFileURL(file).href;
    subject = { kind: 'file', path: file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  }
  const chrome = findChrome(a.chrome);
  if (!chrome) {
    console.error('web_audit: no Chromium, Chrome or Edge found (set CHROME_PATH); nothing is downloaded');
    process.exit(3);
  }
  const out = path.resolve(a.out);
  fs.mkdirSync(out, { recursive: true });
  const measures = {};
  const faults = [];
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const idsFor = (measure) => catalog.rows.filter((r) => r.checks.some((c) => c.adapter === measure)).map((r) => r.id);
  const fault = (measure, kind, what, where, extra = {}) =>
    faults.push({ measure, catalog_ids: idsFor(measure), kind, what, where, ...extra });

  const { cdp, close } = await launch(chrome);
  try {
    const version = await cdp.send('Browser.getVersion');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: s } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const send = (m, p) => cdp.send(m, p, s);
    await Promise.all(['Page.enable', 'Runtime.enable', 'Network.enable', 'DOM.enable', 'Accessibility.enable'].map((m) => send(m)));
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const evaluate = async (expression, awaitPromise = false) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) throw new Error(`page script failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));
    const waitSelector = async (sel, ms = 15000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) return;
        await settle(200);
      }
      throw new Error(`timed out waiting for ${sel}`);
    };
    const navigate = async (to) => {
      const loaded = cdp.waitFor('Page.loadEventFired', s, 30000);
      const r = await send('Page.navigate', { url: to });
      if (r.errorText && !/ERR_INTERNET_DISCONNECTED/.test(r.errorText)) throw new Error(`${to}: ${r.errorText}`);
      await loaded;
      await settle();
      await evaluate(PAGE_HELPERS);
    };
    const viewport = (width, scale = 1, height = HEIGHT) => send('Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: scale, mobile: width <= 390 });
    const shoot = async (name) => {
      const m = await send('Page.getLayoutMetrics');
      const size = m.cssContentSize || m.contentSize;
      const h = Math.min(Math.ceil(size.height), 6000);
      const w = Math.ceil(Math.max(size.width, 1));
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: w, height: Math.max(h, 1), scale: 1 } });
      fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'));
      return name;
    };
    const write = (name, obj) => fs.writeFileSync(path.join(out, name), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n');

    // Sign-in, in the same browser, before the page under audit.
    if (a.signin) {
      const steps = JSON.parse(fs.readFileSync(a.signin, 'utf8'));
      for (const st of steps) {
        if (st.goto) await navigate(st.goto);
        else if (st.fill) {
          const v = typeof st.value === 'object' && st.value && st.value.env ? process.env[st.value.env] : st.value;
          if (v === undefined) throw new Error(`sign-in: ${st.fill} has no value (environment variable unset?)`);
          await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(st.fill)}); el.focus(); el.value = ${JSON.stringify(String(v))};
            el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        } else if (st.click) {
          const nav = cdp.waitFor('Page.loadEventFired', s, 5000);
          await evaluate(`document.querySelector(${JSON.stringify(st.click)}).click()`);
          await nav; await settle();
        } else if (st.waitFor) await waitSelector(st.waitFor);
      }
      measures['sign-in'] = { status: 'ok', steps: steps.length };
    }

    // What the page load cost, resource by resource.
    const resources = new Map();
    const netListener = (m) => {
      if (m.sessionId !== s) return;
      if (m.method === 'Network.responseReceived') {
        resources.set(m.params.requestId, { url: m.params.response.url.slice(0, 200), type: m.params.type, mime: m.params.response.mimeType });
      } else if (m.method === 'Network.loadingFinished' && resources.has(m.params.requestId)) {
        resources.get(m.params.requestId).bytes = m.params.encodedDataLength;
      }
    };
    cdp.listeners.push(netListener);
    const reload = async () => { await navigate(url); if (a.waitFor) await waitSelector(a.waitFor); };
    await viewport(1440);
    await reload();
    await settle(500);
    cdp.listeners = cdp.listeners.filter((l) => l !== netListener);

    // Viewports.
    const viewports = [];
    for (const w of WIDTHS) {
      await send('Emulation.setTouchEmulationEnabled', w <= 390 ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
      await viewport(w); await settle(150);
      const o = JSON.parse(await evaluate(OVERFLOW_PROBE));
      viewports.push({ width: w, shot: await shoot(`shot-${w}.png`), horizontalScroll: o.scrollWidth > o.innerWidth, ...o });
      if (o.scrollWidth > o.innerWidth) fault('web.zoom-200', 'horizontal-scroll', `page scrolls sideways at ${w} px`, `${o.scrollWidth} px wide`);
    }
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    measures['web.viewports'] = { status: 'ok', viewports };

    // 200% zoom: a 1440 px window at 200% lays the page out in 720 CSS px at scale 2.
    await viewport(720, 2); await settle(150);
    const z = JSON.parse(await evaluate(OVERFLOW_PROBE));
    measures['web.zoom-200'] = { status: 'ok', shot: await shoot('shot-zoom200.png'), horizontalScroll: z.scrollWidth > z.innerWidth, ...z };
    if (z.scrollWidth > z.innerWidth) fault('web.zoom-200', 'horizontal-scroll', 'page scrolls sideways at 200% zoom', `${z.scrollWidth} CSS px wide`);
    for (const c of z.clipped) fault('web.zoom-200', 'clipped', 'content clipped at 200% zoom', c);

    // DOM with computed styles, contrast, target sizes, landmarks.
    await viewport(1440); await settle(150);
    const dom = JSON.parse(await evaluate(DOM_PROBE));
    if (subject.kind === 'url' && !subject.commit && dom.commit) subject.commit = dom.commit;
    write('dom.json', { title: dom.title, lang: dom.lang, elements: dom.elements });
    const styles = JSON.parse(await evaluate(STYLE_PROBE));
    write('styles.json', styles);
    const loaded = Array.from(resources.values());
    const source = { ...sourceMeasures(JSON.parse(await evaluate(SOURCE_PROBE, true)), styles.rules),
      transfer: { requests: loaded.length, bytes: loaded.reduce((n, r) => n + (r.bytes || 0), 0),
        resources: loaded.sort((x, y) => (y.bytes || 0) - (x.bytes || 0)).slice(0, 50) } };
    write('source.json', source);
    measures.source = { status: 'ok', htmlChars: source.htmlChars, scriptChars: source.scriptChars,
      transferBytes: source.transfer.bytes, uiConcatenations: source.scripts.reduce((n, x) => n + x.uiConcatenations, 0) };
    measures['web.contrast'] = { status: 'ok', checked: dom.contrast.length, failing: dom.contrast.filter((c) => !c.pass).length };
    for (const c of dom.contrast.filter((x) => !x.pass)) {
      fault('web.contrast', 'low-contrast', `text contrast ${c.ratio}:1 is below ${c.required}:1 (${c.fg} on ${c.bg})`, c.path, { text: c.text, wcag: '1.4.3' });
    }
    measures['web.target-size'] = { status: 'ok', targets: dom.targets };
    for (const t of dom.targets) {
      if (t.width === 0 || t.height === 0) fault('web.target-size', 'zero-size-focusable', `focusable element renders ${t.width}x${t.height} px`, t.path, { wcag: '2.5.5' });
      else if (t.width < 44 || t.height < 44) fault('web.target-size', 'small-target', `target ${t.width}x${t.height} px is under 44x44`, t.path, { wcag: '2.5.5' });
    }

    // The browser accessibility tree.
    const { nodes } = await send('Accessibility.getFullAXTree');
    const tree = [];
    for (const n of nodes) {
      const role = n.role?.value || '';
      const name = n.name?.value || '';
      const props = Object.fromEntries((n.properties || []).map((p) => [p.name, p.value?.value]));
      const row = { role, name, ignored: !!n.ignored, focusable: !!props.focusable, backendDOMNodeId: n.backendDOMNodeId };
      if (!n.ignored && CONTROL_ROLES.has(role) && !name.trim() && n.backendDOMNodeId) {
        let where = `backend node ${n.backendDOMNodeId}`;
        try {
          const { object } = await send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId });
          const r = await send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { return __aacPath(this); }', returnByValue: true });
          where = r.result.value || where;
        } catch { /* keep the node id */ }
        row.path = where;
        fault('web.a11y-tree', 'unnamed-control', `${role} has no accessible name`, where, { role, wcag: '4.1.2' });
      }
      if (!n.ignored && role !== 'none' && role !== 'generic' && role !== 'InlineTextBox') tree.push(row);
    }
    write('a11y-tree.json', tree);
    const landmarks = tree.filter((n) => ['main', 'navigation', 'banner', 'contentinfo', 'complementary', 'search', 'region', 'form'].includes(n.role)).map((n) => n.role);
    measures['web.a11y-tree'] = { status: 'ok', nodes: tree.length, landmarks };
    if (!landmarks.includes('main')) fault('web.a11y-tree', 'no-main-landmark', 'page has no main landmark', 'document');

    // Scripted keyboard walk.
    const focusables = JSON.parse(await evaluate('JSON.stringify(__aacFocusable().map((el) => __aacPath(el)))'));
    await evaluate('document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); true');
    await send('Page.bringToFront');
    const startUrl = await evaluate('location.href');
    const walk = [];
    const reached = new Set();
    let repeats = 0;
    for (let i = 0; i < Math.min(focusables.length + 3, 200); i++) {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      }
      await settle(60);
      const st = JSON.parse(await evaluate(ACTIVE_PROBE));
      walk.push({ step: i + 1, ...st });
      if (!st.path) { if (reached.size) break; continue; }
      const prev = walk.length > 1 ? walk[walk.length - 2].path : null;
      repeats = prev === st.path ? repeats + 1 : 0;
      if (repeats === 2) fault('web.keyboard-walk', 'focus-trap', 'Tab does not move focus off this element', st.path);
      if (reached.has(st.path) && repeats === 0) break;
      reached.add(st.path);
      if (st.box[2] === 0 || st.box[3] === 0) fault('web.keyboard-walk', 'zero-size-focus', `focus lands on an element ${st.box[2]}x${st.box[3]} px, so the focus is invisible`, st.path, { wcag: '2.4.7' });
      else if (!st.visibleFocus) fault('web.keyboard-walk', 'no-visible-focus', 'focused element shows no outline or ring', st.path, { wcag: '2.4.7' });
      if (st.url !== startUrl) fault('web.keyboard-walk', 'change-on-focus', `focus changed the page to ${st.url}`, st.path, { wcag: '3.2.1' });
    }
    const unreachable = focusables.filter((p) => !reached.has(p));
    for (const p of unreachable) fault('web.keyboard-walk', 'unreachable', 'focusable element never reached by Tab', p, { wcag: '2.1.1' });
    write('keyboard-walk.json', { focusables, walk, unreachable });
    measures['web.keyboard-walk'] = { status: 'ok', stops: walk.filter((w) => w.path).length, focusables: focusables.length, unreachable: unreachable.length };
    if (await evaluate('location.href') !== startUrl) await navigate(url);

    // axe-core.
    try {
      const src = await loadAxe(a.axe);
      await evaluate(src);
      const r = JSON.parse(await evaluate(`axe.run(document, { resultTypes: ['violations'] }).then((r) => JSON.stringify({
        version: axe.version, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags,
          nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })) })) }))`, true));
      write('axe.json', r);
      measures['web.axe'] = { status: 'ok', version: r.version, violations: r.violations.length };
      for (const v of r.violations) {
        for (const n of v.nodes) fault('web.axe', `axe:${v.id}`, v.help, n.target.join(' '), { impact: v.impact });
      }
    } catch (e) {
      write('axe.json', { status: 'unavailable', reason: e.message });
      measures['web.axe'] = { status: 'unavailable', reason: e.message };
    }

    // Plain text.
    write('text.txt', await evaluate('document.body ? document.body.innerText : ""'));

    // Reduced motion.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await settle(200);
    const moving = await evaluate('document.getAnimations ? document.getAnimations().filter((a) => a.playState === "running").length : 0');
    measures['reduced-motion'] = { status: 'ok', shot: await shoot('shot-reduced-motion.png'), runningAnimations: moving };
    if (moving > 0) fault('reduced-motion', 'motion-under-reduce', `${moving} animation(s) still run under prefers-reduced-motion: reduce`, 'document');

    // Forced colours.
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await settle(200);
    const optedOut = await evaluate(`Array.from(document.querySelectorAll('*')).filter((el) => getComputedStyle(el).forcedColorAdjust === 'none').map((el) => __aacPath(el))`);
    measures['forced-colors'] = { status: 'ok', shot: await shoot('shot-forced-colors.png'), forcedColorAdjustNone: optedOut };
    await send('Emulation.setEmulatedMedia', { features: [] });

    // Interactions a still capture cannot show (issue 1087), written to probes.json for the reviewers.
    const probes = { palette: palette(dom.elements) };
    // Hover against tap: hidden text is hovered with a mouse at 1440, then tapped on a 390 px touch screen.
    const hidden = await evaluate(HIDDEN_TEXT_PROBE);
    const reveal = [];
    for (let i = 0; i < hidden; i++) {
      let hit = null;
      for (const which of ['parent', 'previous']) {
        const pt = JSON.parse(await evaluate(HIDDEN_POINT(i, which)));
        if (!pt) continue;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y });
        await settle(450);
        const shown = await evaluate(HIDDEN_SHOWN(i));
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
        await settle(100);
        if (shown) { hit = { ...pt, which }; break; }
      }
      const el = JSON.parse(await evaluate(`JSON.stringify({ path: __aacPath(window.__aacHidden[${i}]), text: (window.__aacHidden[${i}].innerText || '').trim().slice(0, 60) })`));
      reveal.push({ ...el, hover: !!hit, trigger: hit ? hit.trigger : null, triggerFocusable: hit ? hit.focusable : null, which: hit ? hit.which : null });
    }
    if (reveal.some((r) => r.hover)) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await viewport(390); await settle(300);
      for (const [i, r] of reveal.entries()) {
        if (!r.hover) continue;
        const pt = JSON.parse(await evaluate(HIDDEN_POINT(i, r.which)));
        if (!pt) { r.tap = null; continue; }
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(450);
        r.tap = await evaluate(HIDDEN_SHOWN(i));
        await evaluate('document.activeElement && document.activeElement.blur(); true');
      }
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await viewport(1440); await settle(200);
    }
    probes.hoverReveal = { hiddenText: reveal.length, shownOnHover: reveal.filter((r) => r.hover).length,
      shownOnTap: reveal.filter((r) => r.tap).length, items: reveal };
    // View switches: each control that replaces content in place, once online and once with the network cut.
    const switches = [];
    for (const sel of JSON.parse(await evaluate(SWITCH_CONTROLS))) {
      const run = async (offline) => {
        if (offline) await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        await evaluate(SWITCH_ARM);
        const did = JSON.parse(await evaluate(SWITCH_DO(sel)));
        await settle(offline ? 4000 : 2500);
        const r = did ? { ...did, ...JSON.parse(await evaluate(SWITCH_READ)) } : null;
        if (offline) {
          if (r) r.shot = await shoot(`shot-failed-switch-${switches.length + 1}.png`);
          await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        }
        return r;
      };
      const online = await run(false);
      await reload();
      const failed = await run(true);
      switches.push({ control: sel, online, failed });
      await reload();
    }
    probes.viewSwitch = switches;
    probes.notes = 'hoverReveal: hidden text hovered at 1440 px, then tapped on a 390 px touch screen. viewSwitch: '
      + '"online" changes each control and records the transitions and animations that start (onSwappedContent: on '
      + 'the elements the swap replaced); "failed" does the same with the network cut, after 4 s, with its screenshot.';
    write('probes.json', probes);
    const failedShots = switches.map((x) => x.failed && x.failed.shot).filter(Boolean);
    measures['web.probes'] = { status: 'ok', hiddenText: reveal.length, switches: switches.length,
      chromaticFamilies: probes.palette.chromaticFamilies };

    // Offline: reload with the network cut and keep what the reader would see.
    await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const reloaded = cdp.waitFor('Page.loadEventFired', s, 15000);
    await send('Page.reload', { ignoreCache: true });
    await reloaded; await settle();
    const off = JSON.parse(await evaluate('JSON.stringify({ url: location.href, text: document.body ? document.body.innerText.slice(0, 2000) : "" })'));
    measures.offline = { status: 'ok', shot: await shoot('shot-offline.png'), browserErrorPage: off.url.startsWith('chrome-error://'), text: off.text };
    await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

    write('findings.json', { target: a.target, faults });
    const bundle = {
      schema: 'aac-design/evidence@1', // the shape every adapter writes: scripts/evidence.py
      adapter: 'web',
      surface: 'web',
      target: a.target,
      subject,
      captured: new Date().toISOString(),
      browser: version.product,
      images: [...REVIEW_SET.filter((f) => f.endsWith('.png')), ...failedShots],
      structure: ['dom.json', 'styles.json', 'source.json', 'probes.json', 'a11y-tree.json', 'keyboard-walk.json'],
      text: 'text.txt',
      review_set: [...REVIEW_SET, ...failedShots],
      detector_set: DETECTOR_SET,
      measures,
      fault_count: faults.length,
    };
    write('bundle.json', bundle);
    return { bundle, faults, out };
  } finally {
    close();
  }
}

if (require.main === module) {
  audit(parseArgs(process.argv.slice(2))).then(({ faults, out }) => {
    for (const f of faults) console.log(`${f.measure}  ${f.kind}  ${f.where}  ${f.what}`);
    console.log(`web_audit: ${faults.length} fault(s); bundle ${path.join(out, 'bundle.json')}`);
    process.exit(0);
  }, (e) => {
    console.error(`web_audit: ${e.message}`);
    process.exit(3);
  });
}

module.exports = { findChrome, launch, AXE };
