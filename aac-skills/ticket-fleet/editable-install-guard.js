#!/usr/bin/env node
/**
 * Editable-install guard for fleeted Python repos (claude-dotfiles issue 413).
 *
 * A container runs ONE interpreter with ONE set of site-packages. An editable
 * install ("pip install -e .") is just a pointer file in there naming a project
 * directory - `__editable__.<dist>-<ver>.pth`, its `__editable___<dist>_<ver>_finder.py`
 * sidecar, or the older `<dist>.pth`. Last writer wins.
 *
 * So when anything runs `pip install -e` from a ticket-fleet worktree - an
 * implementer, a verifier's scratch checkout, or the served repo's SessionStart
 * hook firing inside one - the pointer stops naming the main checkout and names
 * the worktree. Removing the worktree at the end of the wave then orphans it, and
 * every later `python -c 'import <pkg>'` in a fresh subprocess dies with
 * ModuleNotFoundError while the code on disk is perfectly fine. That is exactly
 * what the 2026-09-16 aac-routines waves left behind (`Editable project location:
 * /tmp/verify-306`), and it reads as three broken tests rather than a broken
 * environment, which is why it has to be detected rather than debugged.
 *
 * `check` reports whether the pointers for THIS project still name the main
 * checkout; `--repair` rewrites the ones that do not. Only pointer files whose
 * dist name matches the main checkout's `[project].name` are ever read or
 * touched: another package's editable install is none of this tool's business.
 *
 * Repair rewrites the pointer text in place, which is deliberate - it needs no
 * network, no index and no build backend, so it works in a sealed container. It
 * does not refresh the matching `.dist-info/RECORD` hashes, so the durable fix
 * stays what the JSON prints as `repair`: re-run pip's editable install from the
 * main checkout. Legacy `setup.py develop` installs (`<dist>.egg-link` plus
 * `easy-install.pth`) are out of scope; pip has not written those since 21.3.
 *
 * Usage:
 *   node editable-install-guard.js check [--main <dir>] [--python <exe>]
 *                                        [--site-packages <dir>]... [--repair]
 *
 * Exit codes (the ticket-fleet guard-agent convention):
 *   0  clean - the pointers name the main checkout, or this repo has no editable
 *      install to protect (no pyproject.toml, or the package is not installed)
 *   1  a pointer names something else: an orphaned or a live scratch checkout
 *   2  could not audit - never a pass
 *   (3 is reserved for the caller's "the guard tool is not here" probe.)
 *
 * stdout is always ONE line of JSON, so a guard agent can hand it back verbatim.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** PEP 503-ish normalization: the spelling pip uses inside pointer file names. */
function normalizeDist(name) {
  return String(name).trim().toLowerCase().replace(/[-_.]+/g, '_');
}

/**
 * The distribution name of the project in `mainCheckout`, or null when there is
 * none to read. Deliberately a small regex rather than a TOML parser: the only
 * key that matters is `name` in `[project]`, and a fleeted repo cannot be asked
 * to carry a TOML dependency for a guard.
 */
function projectDist(mainCheckout) {
  const file = path.join(mainCheckout, 'pyproject.toml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return null; }
  const section = text.split(/^\s*\[/m).find((s) => /^project\]/.test(s));
  if (!section) return null;
  const m = section.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
  return m ? normalizeDist(m[1]) : null;
}

/** True when `file` is a pointer file belonging to distribution `dist`. */
function isPointerFor(fileName, dist) {
  if (!/\.(pth|py)$/.test(fileName)) return false;
  if (!/^__editable__/.test(fileName) && !/\.pth$/.test(fileName)) return false;
  const token = fileName.toLowerCase().replace(/[-.]+/g, '_');
  return new RegExp(`(^|_)${dist}(_|$)`).test(token);
}

/**
 * Every absolute POSIX path mentioned in a pointer file's text. The lookbehind keeps URLs out of
 * it - a finder sidecar's comments can carry `https://github.com/pypa/...`, and rewriting the
 * middle of one as if it were a stale project directory would corrupt the file it is repairing.
 */
function extractPaths(text) {
  const found = new Set();
  for (const m of String(text).matchAll(/(?<![:\w\/])\/[^\s'"`,;)\]}]*\/[^\s'"`,;)\]}]*/g)) {
    found.add(m[0].replace(/[.,;)]+$/, ''));
  }
  // The Windows spelling pip writes on a PC (C:\Users\...\src): without it the guard saw no
  // targets there at all and reported a healthy-looking empty audit (found 2026-09-16, when the
  // repo's own test command ran this on the desktop).
  for (const m of String(text).matchAll(/(?<![\w\\\/])[A-Za-z]:[\\\/][^\s'"`,;)\]}]*/g)) {
    found.add(m[0].replace(/[.,;)]+$/, ''));
  }
  return [...found];
}

/** True when `child` is `parent` or lives under it. */
function isInside(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p + path.sep);
}

/**
 * Where a stale pointer target belongs in the main checkout: the longest trailing
 * run of its components that exists there, falling back to the checkout root.
 * `/tmp/verify-306/src/pkg` against `/repo` becomes `/repo/src/pkg` when that
 * exists, so both the `.pth` (a `src` dir) and the finder MAPPING (a package dir)
 * land on the right thing without knowing which layout the project uses.
 */
function repairTarget(mainCheckout, stale) {
  const parts = path.resolve(stale).split(path.sep).filter(Boolean);
  for (let k = parts.length - 1; k >= 1; k--) {
    const candidate = path.join(mainCheckout, ...parts.slice(parts.length - k));
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.resolve(mainCheckout);
}

/** The interpreter's site directories, or null when it cannot be asked. */
function sitePackagesOf(pythonExe) {
  const code = 'import json,site,sysconfig\n'
    + 'd=[sysconfig.get_paths().get("purelib")]\n'
    + 'd+=list(getattr(site,"getsitepackages",lambda:[])() or [])\n'
    + 'try: d.append(site.getusersitepackages())\n'
    + 'except Exception: pass\n'
    + 'print(json.dumps([x for x in d if x]))';
  for (const exe of [pythonExe, 'python3', 'python'].filter(Boolean)) {
    const r = spawnSync(exe, ['-c', code], { encoding: 'utf8' });
    if (r.status === 0) {
      try { return JSON.parse(r.stdout.trim()); } catch (e) { /* fall through */ }
    }
  }
  return null;
}

/**
 * Inspect (and optionally repair) the editable pointers for the project in
 * `main`.
 *
 * @param {{main: string, sitePackages: string[], repair?: boolean}} opts
 * @returns {{code: number, report: object}} `code` is the process exit code.
 */
function inspect(opts) {
  const main = path.resolve(opts.main);
  if (!fs.existsSync(main)) {
    return { code: 2, report: { ok: false, error: `main checkout ${main} does not exist` } };
  }
  const dist = projectDist(main);
  if (!dist) {
    return { code: 0, report: { ok: true, main, project: null, pointers: [], repaired: [], note: 'no [project].name in a pyproject.toml here - nothing is installed editable from this checkout, so there is nothing to guard' } };
  }
  const dirs = (opts.sitePackages || []).filter((d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } });
  if (!dirs.length) {
    return { code: 2, report: { ok: false, main, project: dist, error: 'no readable site-packages directory - could not audit' } };
  }

  const pointers = [];
  const repaired = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names.filter((n) => isPointerFor(n, dist))) {
      const file = path.join(dir, name);
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { continue; }
      for (const target of extractPaths(text)) {
        const exists = fs.existsSync(target);
        const inside = isInside(main, target);
        const state = inside ? 'main' : (exists ? 'scratch' : 'orphaned');
        const entry = { file, target, state };
        if (state !== 'main' && opts.repair) {
          const to = repairTarget(main, target);
          text = text.split(target).join(to);
          fs.writeFileSync(file, text);
          repaired.push({ file, from: target, to });
          entry.repairedTo = to;
          entry.state = 'repaired';
        }
        pointers.push(entry);
      }
    }
  }

  const bad = pointers.filter((p) => p.state === 'scratch' || p.state === 'orphaned');
  const report = {
    ok: bad.length === 0,
    main,
    project: dist,
    sitePackages: dirs,
    pointers,
    repaired,
    repair: `python -m pip install -e '.[dev]'   # run from ${main}`,
  };
  if (!pointers.length) report.note = `${dist} is not installed editable in these site directories - nothing to guard`;
  else if (repaired.length) report.note = `${repaired.length} editable pointer(s) repointed at ${main} (claude-dotfiles issue 413); re-run the pip command in "repair" to refresh the install metadata as well`;
  else if (bad.length) report.note = `${bad.length} editable pointer(s) name a checkout that is not ${main} - a fleet worktree captured this container's editable install (claude-dotfiles issue 413)`;
  return { code: report.ok ? 0 : 1, report };
}

function parseArgs(argv) {
  const opts = { main: process.cwd(), python: null, sitePackages: [], repair: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'check') continue;
    else if (a === '--main') opts.main = argv[++i];
    else if (a === '--python') opts.python = argv[++i];
    else if (a === '--site-packages') opts.sitePackages.push(argv[++i]);
    else if (a === '--repair') opts.repair = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

function main(argv) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message }) + '\n');
    return 2;
  }
  if (opts.help) {
    process.stdout.write('usage: editable-install-guard.js check [--main <dir>] [--python <exe>] [--site-packages <dir>]... [--repair]\n');
    return 0;
  }
  if (!opts.sitePackages.length) {
    const dirs = sitePackagesOf(opts.python);
    if (!dirs) {
      process.stdout.write(JSON.stringify({ ok: false, error: 'no Python interpreter answered for its site directories - could not audit' }) + '\n');
      return 2;
    }
    opts.sitePackages = dirs;
  }
  const { code, report } = inspect(opts);
  process.stdout.write(JSON.stringify(report) + '\n');
  return code;
}

module.exports = { normalizeDist, projectDist, isPointerFor, extractPaths, isInside, repairTarget, sitePackagesOf, inspect, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
