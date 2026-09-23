#!/usr/bin/env node
/**
 * Make the repo's milestones match docs/agents/milestones.json.
 *
 *   node tools/ensure-milestones.js            # report what would change
 *   node tools/ensure-milestones.js --apply    # write it
 *
 * WHY A FILE AND A JOB. A cloud container has no GitHub credential for git or curl (issue 483) and
 * the GitHub MCP exposes no milestone tool, so a session there cannot create a milestone at all.
 * The Actions job (.github/workflows/milestones.yml) can: GITHUB_TOKEN with `issues: write` covers
 * milestones. The file is the source of truth, the job is the hand that writes it, and a session on
 * any venue changes milestones by editing the file on a branch.
 *
 * WHAT IT DOES, per wanted milestone, matched by exact title:
 *   - absent            -> create (POST)
 *   - present, closed   -> reopen (PATCH state=open) and refresh the description
 *   - description drift -> refresh (PATCH description)
 *   - same              -> nothing
 * Milestones in the repo that the file does not name are left alone: the file lists what must
 * exist, not everything that may. So a milestone closed by hand leaves the file in the same change,
 * or the next run reopens it (M1 and M2 left on 2026-09-23, ADR 0001).
 *
 * Idempotent: a second run over a matched repo writes nothing. `plan` is pure and under
 * `node --test tools/ensure-milestones.test.js`, which the workflow runs before applying.
 *
 * Exit codes: 0 done (or nothing to do), 1 could not read or write the tracker. A token-less run
 * must fail loudly: without one every `gh api` call 401s.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_FILE = path.join(REPO_ROOT, 'docs', 'agents', 'milestones.json');

const MISSING_TOKEN = '::error::neither GH_TOKEN nor GITHUB_TOKEN is set. Milestones are written '
  + 'through `gh api`, which is unauthenticated without one. Pass the job token — '
  + 'env: GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} — and re-run.';

/** Default `gh` runner: argv array, optional stdin. Returns stdout. Throws on non-zero exit. */
function defaultRunGh(args, input) {
  const opts = { encoding: 'utf8', stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] };
  if (input !== undefined) opts.input = input;
  return execFileSync('gh', args, opts);
}

/** owner/repo for the run: GITHUB_REPOSITORY when a runner set it, else origin's remote. */
function repoSlug(env) {
  const e = env || process.env;
  if (e.GITHUB_REPOSITORY && /\S+\/\S+/.test(e.GITHUB_REPOSITORY)) return e.GITHUB_REPOSITORY;
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error('cannot read owner/repo from `git remote get-url origin`: ' + remote);
  return m[1] + '/' + m[2];
}

/** The wanted list. Throws on a malformed file so a typo never silently plans nothing. */
function readWanted(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(file + ': expected a JSON array of milestones');
  const seen = new Set();
  return raw.map((m, i) => {
    if (!m || typeof m.title !== 'string' || !m.title.trim()) throw new Error(file + ': entry ' + i + ' has no title');
    const title = m.title.trim();
    if (seen.has(title)) throw new Error(file + ': duplicate title "' + title + '"');
    seen.add(title);
    return { title, description: typeof m.description === 'string' ? m.description : '' };
  });
}

/** Every milestone of the repo, open and closed, paged by hand. Throws when unreadable. */
function allMilestones(slug, gh) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const raw = gh(['api', 'repos/' + slug + '/milestones?state=all&per_page=100&page=' + page]);
    const rows = JSON.parse(raw);
    for (const m of rows) out.push({ number: m.number, title: m.title, description: m.description || '', state: m.state });
    if (rows.length < 100) break;
  }
  return out;
}

/**
 * What to write so `existing` carries every milestone in `wanted`. Pure.
 * Returns [{ action: 'create'|'reopen'|'update'|'none', title, number?, description? }].
 */
function plan(wanted, existing) {
  const byTitle = new Map((existing || []).map((m) => [m.title, m]));
  return wanted.map((w) => {
    const have = byTitle.get(w.title);
    if (!have) return { action: 'create', title: w.title, description: w.description };
    if (have.state === 'closed') return { action: 'reopen', title: w.title, number: have.number, description: w.description };
    if ((have.description || '') !== w.description) return { action: 'update', title: w.title, number: have.number, description: w.description };
    return { action: 'none', title: w.title, number: have.number };
  });
}

/** Run one planned step against the tracker. Returns the line to print. */
function execute(step, slug, gh, apply) {
  const base = 'repos/' + slug + '/milestones';
  const would = apply ? '' : 'would ';
  if (step.action === 'create') {
    if (apply) {
      const raw = gh(['api', '--method', 'POST', base, '--input', '-'],
        JSON.stringify({ title: step.title, description: step.description }));
      const made = JSON.parse(raw);
      return 'created "' + step.title + '" (milestone ' + made.number + ')';
    }
    return would + 'create "' + step.title + '"';
  }
  if (step.action === 'reopen' || step.action === 'update') {
    const body = step.action === 'reopen'
      ? { state: 'open', description: step.description }
      : { description: step.description };
    if (apply) gh(['api', '--method', 'PATCH', base + '/' + step.number, '--input', '-'], JSON.stringify(body));
    return would + (step.action === 'reopen' ? 'reopen' : 'update') + ' "' + step.title + '" (milestone ' + step.number + ')';
  }
  return '"' + step.title + '" (milestone ' + step.number + ') already matches';
}

function ensureMilestones(opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || ((l) => console.log(l));
  const apply = !!opts.apply;
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!token && !opts.runGh) { log(MISSING_TOKEN); return 1; }
  const gh = opts.runGh || ((args, input) => defaultRunGh(args, input));
  const slug = opts.slug || repoSlug(env);
  const wanted = readWanted(opts.file || DEFAULT_FILE);
  const existing = allMilestones(slug, gh);
  const steps = plan(wanted, existing);
  let writes = 0;
  for (const step of steps) {
    log(execute(step, slug, gh, apply));
    if (apply && step.action !== 'none') writes++;
  }
  log(apply ? (writes + ' write(s)') : 'Dry run: pass --apply to write.');
  return 0;
}

module.exports = { plan, readWanted, allMilestones, execute, ensureMilestones, MISSING_TOKEN, DEFAULT_FILE };

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  let code;
  try {
    code = ensureMilestones({ apply });
  } catch (e) {
    console.error('::error::' + (e && e.message ? e.message : e));
    code = 1;
  }
  process.exit(code);
}
