#!/usr/bin/env node
/**
 * owner-account-line — write or check the "Owner account: …" line in a repo's CLAUDE.md,
 * generated from ~/.claude/accounts.json so the two cannot drift (issue 114).
 *
 * The session check (issue 103) tells a desktop or CLI session which Claude account owns
 * the repo, by reading local identity files and cross-referencing the accounts registry.
 * claude.ai/code, mobile and Cowork sessions leave no identity on disk, so nothing on
 * disk can tell them. The only channel that reaches them is prompt text — the repo's
 * always-loaded CLAUDE.md. This tool puts a single line there, generated from the same
 * registry the session check reads, so those sessions know which account they run under
 * (and therefore which credentials, tokens and deploy targets are theirs).
 *
 * Warning-only ruling applies (Dan, 2026-09-09): the line informs; nothing here gates.
 *
 * Usage — one repo at a time (the file is a plain path on disk):
 *   node tools/owner-account-line.js apply     [--repo <path>] [--slug owner/repo] [--registry <path>]
 *   node tools/owner-account-line.js check     [--repo <path>] [--slug owner/repo] [--registry <path>]
 *   node tools/owner-account-line.js render    --slug owner/repo [--registry <path>]
 *
 * Usage — every registered live repo at once. `--via clones` walks local sibling clones under
 * `--clones-root` (default $CLAUDE_CLONES_ROOT, else ~/Claude/Projects); `--via github` reads
 * the default branch's CLAUDE.md through `gh api`, which reaches the eight live repos without a
 * clone on disk. apply-all --via github writes back through `gh api` — that pushes commits to
 * the default branch, so it is an operator command; a check-all --via github is read-only and
 * safe to run from a CI job. The default `--via` is `clones` because that is what a restore
 * suite or a workstation sweep uses:
 *
 *   node tools/owner-account-line.js check-all [--via clones|github] [--clones-root <dir>] [--registry <path>]
 *   node tools/owner-account-line.js apply-all [--via clones|github] [--clones-root <dir>] [--registry <path>]
 *
 *   --repo         path to a local clone (default: process.cwd())
 *   --slug         owner/repo entry in the registry (default: derived from `git remote get-url origin`)
 *   --registry     path to accounts.json (default: $CLAUDE_ACCOUNTS_JSON, else ~/.claude/accounts.json)
 *   --clones-root  parent directory holding sibling clones (default: $CLAUDE_CLONES_ROOT, else ~/Claude/Projects)
 *   --via          clones | github (default: clones)
 *
 * Exit codes: 0 clean / applied / rendered, 1 check drift, 2 usage or read error, 3 registered
 * repo is marked dead (nothing to write; check treats missing line as ok). check-all rolls the
 * per-repo codes up: exit 1 if any repo drifted, 2 if any lookup failed, 0 only when every live
 * repo agrees with the registry.
 *
 * The block is delimited by two HTML comments so it can be replaced idempotently without
 * touching anything else in the file:
 *
 *   <!-- owner-account:begin — managed by claude-dotfiles/tools/owner-account-line.js; do not edit -->
 *   Owner account: <label> (<surface list>)
 *   <!-- owner-account:end -->
 *
 * Placement: immediately below the file's H1 (`# ...` on line 1), separated by one blank line
 * on each side. If the file has no H1 the block is inserted at the very top. Idempotent by
 * marker: a second run with the same registry rewrites the marked region to the same text.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BEGIN_MARK = '<!-- owner-account:begin — managed by claude-dotfiles/tools/owner-account-line.js; do not edit -->';
const END_MARK = '<!-- owner-account:end -->';

// Instructions-file basenames, in preference order. A repo whose default file is CLAUDE.md gets
// its owner block written there; a repo that only carries AGENTS.md (zoho-source-of-truth on
// 2026-09-12, and any future Codex-first repo) gets it written to AGENTS.md instead. The order
// matters: when both files exist, CLAUDE.md wins so a session that reads only one file (Claude
// Code loads CLAUDE.md, not AGENTS.md) still sees the block. When neither file exists on disk
// the tool creates CLAUDE.md — that is the file Claude Code will look for.
const INSTRUCTIONS_CANDIDATES = Object.freeze(['CLAUDE.md', 'AGENTS.md']);

function pickInstructionsFile(repoDir) {
  for (const name of INSTRUCTIONS_CANDIDATES) {
    const p = path.join(repoDir, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(repoDir, INSTRUCTIONS_CANDIDATES[0]);
}

// Friendly names for each surface listed in accounts.json. Unknown surfaces render verbatim,
// so a new one can be added to the registry without needing a code change here first.
const SURFACE_NAMES = Object.freeze({
  desktop: 'desktop app',
  cli: 'CLI',
  mobile: 'mobile app',
  web: 'claude.ai/code',
  'task-scheduler': 'task scheduler',
  cowork: 'Cowork',
  'cloud-routines': 'cloud routines',
});

function renderSurfaces(surfaces) {
  if (!Array.isArray(surfaces) || surfaces.length === 0) return 'no surfaces registered';
  return surfaces.map((s) => SURFACE_NAMES[s] || s).join(', ');
}

function renderLine(label, surfaces) {
  return `Owner account: ${label} (${renderSurfaces(surfaces)})`;
}

function renderBlock(label, surfaces) {
  return `${BEGIN_MARK}\n${renderLine(label, surfaces)}\n${END_MARK}`;
}

function defaultRegistryPath(env = process.env) {
  if (env.CLAUDE_ACCOUNTS_JSON) return env.CLAUDE_ACCOUNTS_JSON;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, '.claude', 'accounts.json');
}

function readRegistry(regPath) {
  const raw = fs.readFileSync(regPath, 'utf8');
  const reg = JSON.parse(raw);
  if (!reg || typeof reg !== 'object') throw new Error(`${regPath} is not a JSON object`);
  reg.accounts = reg.accounts || {};
  reg.repos = reg.repos || {};
  return reg;
}

function slugFromGit(repoPath) {
  try {
    const url = execFileSync('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    // matches https://github.com/owner/repo(.git), git@github.com:owner/repo(.git), ssh://…/owner/repo
    const m = url.match(/[:/]([^:/\s]+)\/([^:/\s]+?)(?:\.git)?\/?$/);
    return m ? `${m[1]}/${m[2]}` : null;
  } catch {
    return null;
  }
}

function findRepoEntry(reg, slug) {
  if (!slug) return null;
  const hit = Object.entries(reg.repos).find(([k]) => k.toLowerCase() === slug.toLowerCase());
  return hit ? { key: hit[0], ...hit[1] } : null;
}

function surfacesFor(reg, ownerLabel) {
  const a = reg.accounts[ownerLabel];
  return a && Array.isArray(a.surfaces) ? a.surfaces : [];
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The permissive regex tolerates minor spacing edits (extra blank line inside the block) so a
// well-meaning hand edit is fixed on the next `apply` rather than left duplicated. It refuses
// to match across a blank line pair, so it never swallows unrelated content.
const BLOCK_RE = new RegExp(
  escapeRe(BEGIN_MARK) + '[\\s\\S]*?' + escapeRe(END_MARK)
);

function extractLine(content) {
  const m = content.match(BLOCK_RE);
  if (!m) return null;
  const inner = m[0].slice(BEGIN_MARK.length, -END_MARK.length);
  const lines = inner.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines[0] || null;
}

function updateContent(content, block) {
  if (BLOCK_RE.test(content)) {
    return content.replace(BLOCK_RE, block);
  }
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  // Insert after the H1 (line 0) and its single trailing blank line, if present. Otherwise
  // prepend. Trailing newline behaviour of the file is preserved.
  let insertAt = 0;
  if (lines.length > 0 && /^# /.test(lines[0])) {
    insertAt = 1;
    if (insertAt < lines.length && lines[insertAt].trim() === '') insertAt++;
  }
  const inserted = block.split('\n');
  const out = lines.slice(0, insertAt).concat(inserted, [''], lines.slice(insertAt));
  return out.join(eol);
}

function usage(code = 2) {
  process.stderr.write(
    'usage: node tools/owner-account-line.js <apply|check|render|apply-all|check-all> [--repo <path>] [--slug owner/repo] [--registry <path>] [--via clones|github] [--clones-root <dir>]\n'
  );
  process.exit(code);
}

const SUBCOMMANDS = new Set(['apply', 'check', 'render', 'apply-all', 'check-all']);

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) usage(2);
  const mode = args[0];
  if (!SUBCOMMANDS.has(mode)) usage(2);
  const opts = { mode, repo: process.cwd(), registry: null, slug: null, via: 'clones', clonesRoot: null };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--repo') opts.repo = args[++i];
    else if (a === '--registry') opts.registry = args[++i];
    else if (a === '--slug') opts.slug = args[++i];
    else if (a === '--via') opts.via = args[++i];
    else if (a === '--clones-root') opts.clonesRoot = args[++i];
    else if (a === '--help' || a === '-h') usage(0);
    else {
      process.stderr.write(`unknown arg: ${a}\n`);
      process.exit(2);
    }
  }
  if (!['clones', 'github'].includes(opts.via)) {
    process.stderr.write(`unknown --via: ${opts.via} (expected clones or github)\n`);
    process.exit(2);
  }
  return opts;
}

/** Default parent directory for sibling clones. The workstation lays them out under
 *  ~/Claude/Projects/<vertical>/<repo>, so we walk that root and match by basename. */
function defaultClonesRoot(env = process.env) {
  if (env.CLAUDE_CLONES_ROOT) return env.CLAUDE_CLONES_ROOT;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  return path.join(home, 'Claude', 'Projects');
}

/** Return every live (non-dead) repo in the registry as { slug, owner, entry }. */
function liveRepos(reg) {
  const out = [];
  for (const [slug, entry] of Object.entries(reg.repos || {})) {
    if (entry.status === 'dead') continue;
    out.push({ slug, owner: entry.owner, entry });
  }
  return out;
}

/** Walk a clones root and index every checkout by GitHub slug, so an operator's layout does not
 *  need to match owner/repo on disk. Reads `git config --get remote.origin.url` on each candidate
 *  directory; skips anything that is not a git checkout. The map is slug (lowercased) -> abs path.
 *
 *  Depth is bounded because the tree contains node_modules, worktrees and generated dirs — we do
 *  not want to walk them. A repository is a directory that contains a `.git` (file or dir).
 *  A worktree's `.git` is a file — we treat both as "this is a checkout" and stop descending. */
function indexClonesUnder(root, opts = {}) {
  const maxDepth = opts.maxDepth != null ? opts.maxDepth : 4;
  const execOrigin = opts.execOrigin || ((p) => {
    try {
      return execFileSync('git', ['-C', p, 'config', '--get', 'remote.origin.url'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch { return ''; }
  });
  const bySlug = new Map();
  if (!fs.existsSync(root)) return bySlug;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    // If this dir is itself a checkout, record it and stop descending.
    if (fs.existsSync(path.join(dir, '.git'))) {
      const url = execOrigin(dir);
      const m = url && url.match(/[:/]([^:/\s]+)\/([^:/\s]+?)(?:\.git)?\/?$/);
      if (m) {
        const slug = `${m[1]}/${m[2]}`.toLowerCase();
        if (!bySlug.has(slug)) bySlug.set(slug, dir);
      }
      continue;
    }
    if (depth >= maxDepth) continue;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      if (e.name === 'node_modules') continue;
      stack.push({ dir: path.join(dir, e.name), depth: depth + 1 });
    }
  }
  return bySlug;
}

/** Read one repo's default-branch instructions file through `gh api`. Tries CLAUDE.md first,
 *  falls back to AGENTS.md so a Codex-first repo audits correctly. Returns
 *  { content, sha, defaultBranch, filename } on success; throws on any failure so the caller
 *  can translate to an exit-2 (could not audit) — a silent 0 would look like "no drift" and
 *  hide the network failure the audit is supposed to notice. When neither file exists the
 *  return is { content: null, sha: null, defaultBranch, filename: 'CLAUDE.md', notFound: true }
 *  — `apply-all` uses that as the signal to create CLAUDE.md.
 *
 *  opts.filename pins the target file (used by the writer so `apply` puts the block in the
 *  same file it read). */
function readViaGithub(slug, opts = {}) {
  const gh = opts.gh || ((args) => execFileSync('gh', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  }));
  const repoInfo = JSON.parse(gh(['api', `repos/${slug}`, '--jq', '{default_branch}']));
  const defaultBranch = repoInfo.default_branch;
  if (!defaultBranch) throw new Error(`no default_branch on repos/${slug}`);
  const candidates = opts.filename ? [opts.filename] : INSTRUCTIONS_CANDIDATES;
  let lastErr;
  for (const filename of candidates) {
    try {
      const raw = gh(['api', `repos/${slug}/contents/${filename}`, '-f', `ref=${defaultBranch}`]);
      const file = JSON.parse(raw);
      const buf = Buffer.from(file.content || '', file.encoding || 'base64');
      return { content: buf.toString('utf8'), sha: file.sha, defaultBranch, filename, notFound: false };
    } catch (e) {
      // gh prints the body of a 404 to stderr; distinguish "no file yet" from "no repo" so
      // the fallback loop can continue on 404 and re-throw on anything else.
      const msg = String(e.stderr || e.message || '');
      if (/HTTP 404/i.test(msg) || /"status":\s*"404"/.test(msg)) { lastErr = e; continue; }
      throw e;
    }
  }
  // Every candidate was a 404 — neither CLAUDE.md nor AGENTS.md on the default branch. Caller
  // treats this as `apply`'s cue to create CLAUDE.md (the primary), so pin the filename to that.
  void lastErr;
  return { content: null, sha: null, defaultBranch, filename: candidates[0], notFound: true };
}

/** Roll-up over every live registered repo. `resolveContent(slug)` returns
 *  { content, mdPath, notFound } — mdPath is a display string (a filesystem path for local
 *  clones, e.g. `repos/OWNER/REPO/CLAUDE.md@<branch>` for gh). checkAll never touches the
 *  filesystem itself. */
function checkAll(reg, resolveContent) {
  const results = [];
  for (const { slug, entry } of liveRepos(reg)) {
    const surfaces = surfacesFor(reg, entry.owner);
    const expectedLine = renderLine(entry.owner, surfaces);
    let resolved;
    try { resolved = resolveContent(slug); }
    catch (e) { results.push({ slug, status: 'error', reason: e.message, expectedLine }); continue; }
    if (!resolved || resolved.missing) {
      results.push({ slug, status: 'skipped', reason: resolved && resolved.reason ? resolved.reason : 'no clone found', expectedLine });
      continue;
    }
    // `resolved` is kept on the result so the apply-all writer sees the resolver's `_filename`
    // (which instructions file to write to — some repos carry AGENTS.md instead of CLAUDE.md).
    // Any other field the resolver adds travels through the same way.
    if (resolved.notFound || resolved.content == null) {
      results.push({ slug, status: 'drift', reason: `no ${INSTRUCTIONS_CANDIDATES.join(' or ')} on default branch`, actualLine: null, expectedLine, mdPath: resolved.mdPath, resolved });
      continue;
    }
    const actualLine = extractLine(resolved.content);
    if (actualLine === expectedLine) {
      results.push({ slug, status: 'ok', actualLine, expectedLine, mdPath: resolved.mdPath, resolved });
    } else {
      results.push({ slug, status: 'drift', actualLine, expectedLine, mdPath: resolved.mdPath, resolved });
    }
  }
  return results;
}

/** Exit code from a checkAll result set. 2 wins over 1 wins over 0 — an audit that could not run
 *  must never look like a pass (same policy as tools/tracker-audit.js). */
function rollup(results) {
  let code = 0;
  for (const r of results) {
    if (r.status === 'error') code = Math.max(code, 2);
    else if (r.status === 'drift') code = Math.max(code, 1);
  }
  return code;
}

function run(argv, env = process.env, io = {}) {
  const opts = parseArgs(argv);
  const regPath = opts.registry || defaultRegistryPath(env);
  let reg;
  try {
    reg = readRegistry(regPath);
  } catch (e) {
    process.stderr.write(`could not read registry ${regPath}: ${e.message}\n`);
    return 2;
  }

  if (opts.mode === 'check-all' || opts.mode === 'apply-all') {
    return runAll(opts, reg, regPath, env, io);
  }

  let slug = opts.slug;
  if (!slug && opts.mode !== 'render') slug = slugFromGit(opts.repo);
  if (!slug) {
    process.stderr.write(`could not determine slug (no --slug, and \`git -C ${opts.repo} remote get-url origin\` failed)\n`);
    return 2;
  }
  const entry = findRepoEntry(reg, slug);
  if (!entry) {
    process.stderr.write(`${slug} is not in the accounts registry (${regPath})\n`);
    return 2;
  }

  if (opts.mode === 'render') {
    const surfaces = surfacesFor(reg, entry.owner);
    process.stdout.write(renderLine(entry.owner, surfaces) + '\n');
    return 0;
  }

  // Dead repos: no line to write. check() treats missing/dead as ok; apply() removes any stale block.
  if (entry.status === 'dead') {
    if (opts.mode === 'apply') {
      // Strip a stale block from every instructions file the repo carries (some repos
      // duplicate the two files; leaving one clean while the other keeps a stale block would
      // still mislead a session).
      let removed = false;
      for (const name of INSTRUCTIONS_CANDIDATES) {
        const mdPath = path.join(opts.repo, name);
        if (!fs.existsSync(mdPath)) continue;
        const content = fs.readFileSync(mdPath, 'utf8');
        if (BLOCK_RE.test(content)) {
          const cleaned = content.replace(new RegExp('\\n?' + BLOCK_RE.source + '\\n?', ''), '\n');
          fs.writeFileSync(mdPath, cleaned);
          process.stdout.write(`removed stale block: ${slug} is marked dead in ${regPath} (${mdPath})\n`);
          removed = true;
        }
      }
      if (!removed) process.stdout.write(`${slug} is marked dead in ${regPath}; no line to write\n`);
      return 0;
    }
    // check
    for (const name of INSTRUCTIONS_CANDIDATES) {
      const mdPath = path.join(opts.repo, name);
      if (!fs.existsSync(mdPath)) continue;
      const content = fs.readFileSync(mdPath, 'utf8');
      if (BLOCK_RE.test(content)) {
        process.stderr.write(`drift: ${slug} is marked dead but ${mdPath} carries an owner-account block\n`);
        return 1;
      }
    }
    return 0;
  }

  const surfaces = surfacesFor(reg, entry.owner);
  const expectedLine = renderLine(entry.owner, surfaces);
  const expectedBlock = renderBlock(entry.owner, surfaces);
  const mdPath = pickInstructionsFile(opts.repo);

  if (!fs.existsSync(mdPath)) {
    if (opts.mode === 'check') {
      process.stderr.write(
        `drift: ${slug}\n  expected: ${expectedLine}\n  actual:   (no ${INSTRUCTIONS_CANDIDATES.join(' or ')})\n  file:     ${mdPath}\n  registry: ${regPath}\n`
      );
      return 1;
    }
    // apply: create a minimal file with an H1 named after the repo, so the block lands under it.
    const repoName = slug.split('/').pop();
    fs.writeFileSync(mdPath, `# ${repoName}\n`);
  }
  const content = fs.readFileSync(mdPath, 'utf8');
  const actualLine = extractLine(content);

  if (opts.mode === 'check') {
    if (actualLine === expectedLine) {
      process.stdout.write(`ok: ${slug} — ${expectedLine}\n`);
      return 0;
    }
    process.stderr.write(
      `drift: ${slug}\n  expected: ${expectedLine}\n  actual:   ${actualLine || '(no owner-account block)'}\n  file:     ${mdPath}\n  registry: ${regPath}\n`
    );
    return 1;
  }

  // apply
  const updated = updateContent(content, expectedBlock);
  if (updated !== content) {
    fs.writeFileSync(mdPath, updated);
    process.stdout.write(`updated ${mdPath}: ${expectedLine}\n`);
  } else {
    process.stdout.write(`unchanged ${mdPath}: ${expectedLine}\n`);
  }
  return 0;
}

/** `check-all` / `apply-all` driver, shared by both --via modes. Split from run() because it
 *  is testable without a filesystem, a `git` binary, or `gh` — the resolver is a pure function
 *  the caller passes in. The CLI wiring below hands it the two concrete resolvers. */
function runAll(opts, reg, regPath, env, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const clonesRoot = opts.clonesRoot || defaultClonesRoot(env);

  // Build the resolver. Both resolvers surface the same shape: { content, mdPath, missing?,
  // notFound?, reason? }, so checkAll and applyAll can iterate without knowing where the file
  // came from.
  let resolveContent;
  let writeContent = null;   // apply-all only
  if (opts.via === 'clones') {
    const index = (io.indexClones || indexClonesUnder)(clonesRoot);
    resolveContent = (slug) => {
      const dir = index.get(slug.toLowerCase());
      if (!dir) return { missing: true, reason: `no clone under ${clonesRoot}` };
      // Prefer CLAUDE.md; fall back to AGENTS.md so a Codex-first repo (zoho-source-of-truth
      // on 2026-09-12) audits correctly instead of tripping notFound.
      const mdPath = pickInstructionsFile(dir);
      if (!fs.existsSync(mdPath)) return { content: null, mdPath, notFound: true };
      return { content: fs.readFileSync(mdPath, 'utf8'), mdPath };
    };
    writeContent = (slug, next) => {
      const dir = index.get(slug.toLowerCase());
      if (!dir) return { missing: true, reason: `no clone under ${clonesRoot}` };
      const mdPath = pickInstructionsFile(dir);
      fs.writeFileSync(mdPath, next);
      return { mdPath };
    };
  } else if (opts.via === 'github') {
    const gh = io.gh;
    resolveContent = (slug) => {
      const r = readViaGithub(slug, { gh });
      // Carry the resolved filename through so apply-all writes the block into the same file
      // it read (a repo whose instructions live in AGENTS.md must not get a stray CLAUDE.md).
      return {
        content: r.content,
        mdPath: `${slug}/${r.filename}@${r.defaultBranch}`,
        notFound: r.notFound,
        _filename: r.filename,
      };
    };
    if (opts.mode === 'apply-all') {
      // Writing back via gh api is a commit against the default branch. The tool exposes the
      // capability, but it is guarded behind an explicit env var so a hook or CI job cannot
      // silently push. Operators set OWNER_ACCOUNT_LINE_PUSH=1; the CI workflow sets the same
      // env only on push to master (see .github/workflows/owner-account-line.yml).
      writeContent = (slug, next, resolved) => {
        if (env.OWNER_ACCOUNT_LINE_PUSH !== '1') {
          return { missing: true, reason: 'refusing to push via gh api without OWNER_ACCOUNT_LINE_PUSH=1' };
        }
        // Read again with the pinned filename so we keep the sha of the file we are updating
        // (a PUT without the matching sha would 409). When resolved says a file existed, its
        // filename wins; otherwise we create the primary (CLAUDE.md).
        const filename = (resolved && resolved._filename) || INSTRUCTIONS_CANDIDATES[0];
        const info = readViaGithub(slug, { gh, filename });
        const b64 = Buffer.from(next, 'utf8').toString('base64');
        const shaArg = info.sha ? ['-f', `sha=${info.sha}`] : [];
        const runGh = gh || ((args) => execFileSync('gh', args, {
          encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
        }));
        runGh(['api', '--method', 'PUT', `repos/${slug}/contents/${filename}`,
          '-f', `message=chore(${filename}): sync owner-account line from claude-dotfiles registry (issue 114)`,
          '-f', `content=${b64}`,
          '-f', `branch=${info.defaultBranch}`,
          ...shaArg,
        ]);
        return { mdPath: `${slug}/${filename}@${info.defaultBranch}` };
      };
    }
  }

  const results = checkAll(reg, resolveContent);
  const code = rollup(results);

  if (opts.mode === 'check-all') {
    for (const r of results) {
      if (r.status === 'ok') stdout.write(`ok      ${r.slug} — ${r.expectedLine}\n`);
      else if (r.status === 'skipped') stdout.write(`skip    ${r.slug} — ${r.reason} (expected: ${r.expectedLine})\n`);
      else if (r.status === 'drift') stderr.write(`drift   ${r.slug}\n  expected: ${r.expectedLine}\n  actual:   ${r.actualLine || '(no owner-account block)'}\n  file:     ${r.mdPath}\n  registry: ${regPath}\n`);
      else if (r.status === 'error') stderr.write(`error   ${r.slug} — ${r.reason}\n`);
    }
    return code;
  }

  // apply-all: for each repo whose check drifted, write the correct block back.
  let applyCode = 0;
  for (const r of results) {
    if (r.status === 'skipped') { stdout.write(`skip    ${r.slug} — ${r.reason}\n`); continue; }
    if (r.status === 'error')   { stderr.write(`error   ${r.slug} — ${r.reason}\n`); applyCode = Math.max(applyCode, 2); continue; }
    if (r.status === 'ok')      { stdout.write(`ok      ${r.slug} — already ${r.expectedLine}\n`); continue; }
    // drift: build the corrected content and write it back.
    const entry = findRepoEntry(reg, r.slug);
    const surfaces = surfacesFor(reg, entry.owner);
    const expectedBlock = renderBlock(entry.owner, surfaces);
    // If the file is missing entirely (notFound) start it with an H1 named after the repo,
    // so `updateContent` inserts the block below the H1 in the same shape as every other repo.
    // notFound is the authoritative signal from the resolver; the reason string is a display
    // aid, not a control flow input.
    const notFound = r.resolved && (r.resolved.notFound || r.resolved.content == null);
    let base;
    if (notFound) {
      base = `# ${r.slug.split('/').pop()}\n`;
    } else if (opts.via === 'clones' && r.resolved && r.resolved.content != null) {
      base = r.resolved.content;
    } else if (opts.via === 'github') {
      base = r.resolved && r.resolved.content != null ? r.resolved.content : `# ${r.slug.split('/').pop()}\n`;
    } else {
      base = `# ${r.slug.split('/').pop()}\n`;
    }
    const next = updateContent(base, expectedBlock);
    if (!writeContent) { stderr.write(`no writer for --via ${opts.via}\n`); return 2; }
    const wr = writeContent(r.slug, next, r.resolved);
    if (wr && wr.missing) { stdout.write(`skip    ${r.slug} — ${wr.reason}\n`); continue; }
    stdout.write(`update  ${r.slug} — ${r.expectedLine}${wr.mdPath ? ` (${wr.mdPath})` : ''}\n`);
  }
  return applyCode;
}

module.exports = {
  BEGIN_MARK,
  END_MARK,
  SURFACE_NAMES,
  INSTRUCTIONS_CANDIDATES,
  pickInstructionsFile,
  renderLine,
  renderBlock,
  renderSurfaces,
  extractLine,
  updateContent,
  findRepoEntry,
  surfacesFor,
  defaultRegistryPath,
  defaultClonesRoot,
  slugFromGit,
  readRegistry,
  liveRepos,
  indexClonesUnder,
  readViaGithub,
  checkAll,
  rollup,
  run,
};

if (require.main === module) {
  process.exit(run(process.argv));
}
