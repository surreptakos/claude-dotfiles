#!/usr/bin/env node
/**
 * The ready-for-human rulings page: one artifact holding every open `ready-for-human` ticket across
 * the owner's repos, each with drafted options. The owner picks, the page stores picks in its db,
 * and Submit records a batch that a desktop run lands on GitHub. See
 * aac-skills/grill-ready-for-human/SKILL.md ("Rulings page") for the runs that drive this file.
 *
 *   node tools/rulings-page.js queue --page <page.html> [--owner surreptakos] > plan.json
 *       Current queue vs. the drafts already on the page: which drafts carry over, which tickets
 *       need drafting (new, or updated on GitHub since they were drafted).
 *   node tools/rulings-page.js build --drafts <dir> --out <page.html>
 *       Merge <dir>/<repo-short>.json drafts into the page template.
 *   node tools/rulings-page.js land --page <page.html> --rulings <dir> --submission <id>
 *       --keys k1,k2 [--execute]
 *       Land each submitted ruling: comment, relabel, close. Without --execute, print the plan only.
 *
 * Drafts never go in the repo (it is public): they live in the published page and in temp files.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TEMPLATE = path.join(__dirname, 'rulings-page-template.html');
const DATA_OPEN = '/*DATA*/', DATA_CLOSE = '/*END*/';
const REPO_ORDER = ['claude-dotfiles', 'zoho-source-of-truth', 'aac-sales-commissions', 'aac-sales-cockpit',
  'aac-bill-intake', 'aac-contract-builder', 'aac-routines'];

const short = repo => repo.split('/')[1];
const keyOf = (repo, n) => `${short(repo)}~${n}`;
const marker = (submission, key) => `<!-- rulings-page:${submission}:${key} -->`;

/** The DATA object embedded in a published page. */
function readPageData(html) {
  const a = html.indexOf(DATA_OPEN), b = html.indexOf(DATA_CLOSE, a);
  if (a < 0 || b < 0) throw new Error('page has no /*DATA*/ block');
  return JSON.parse(html.slice(a + DATA_OPEN.length, b));
}

/** Which drafts carry over and which tickets need drafting. `queue` rows come from gh search. */
function planQueue(data, queue) {
  const drafts = new Map();
  for (const r of (data && data.repos) || []) for (const t of r.tickets) drafts.set(keyOf(r.repo, t.n), { repo: r.repo, t });
  const keep = {}, toDraft = {};
  for (const q of queue) {
    const repo = q.repository.nameWithOwner, k = keyOf(repo, q.number), d = drafts.get(k);
    const fresh = d && d.t.draftedAt && Date.parse(q.updatedAt) <= Date.parse(d.t.draftedAt);
    const bucket = fresh ? keep : toDraft;
    (bucket[repo] = bucket[repo] || []).push(fresh ? d.t : q.number);
  }
  return { total: queue.length, keep, toDraft };
}

/** Merge per-repo draft files into the page HTML. */
function buildPage(draftsDir, template) {
  const repos = [];
  const names = fs.readdirSync(draftsDir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
  names.sort((a, b) => (REPO_ORDER.indexOf(a) + 1 || 99) - (REPO_ORDER.indexOf(b) + 1 || 99));
  for (const name of names) {
    const j = JSON.parse(fs.readFileSync(path.join(draftsDir, name + '.json'), 'utf8'));
    if (!j.tickets || !j.tickets.length) continue;
    for (const t of j.tickets) {
      const recs = t.options.filter(o => o.recommended).length;
      if (recs !== 1) throw new Error(`${name}#${t.n}: ${recs} recommended options, need exactly 1`);
      if (t.options.some(o => o.id === 'other')) throw new Error(`${name}#${t.n}: option id "other" is reserved`);
    }
    j.tickets.sort((a, b) => a.n - b.n);
    repos.push({ repo: j.repo, labels: j.labels || [], tickets: j.tickets });
  }
  const data = { drafted: new Date().toISOString().slice(0, 10), repos };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  if (!template.includes(DATA_OPEN + 'null' + DATA_CLOSE)) throw new Error('template lost its DATA placeholder');
  return { html: template.replace(DATA_OPEN + 'null' + DATA_CLOSE, DATA_OPEN + json + DATA_CLOSE), data };
}

/**
 * One ticket's landing from its draft and the owner's pick. "other" (or a pick with no matching
 * option) is marked needsJudgment: the run reads the note and lands it by hand.
 */
function planLanding(repo, t, answer, submission, date) {
  const key = keyOf(repo, t.n);
  const opt = t.options.find(o => o.id === answer.choice);
  const note = (answer.note || '').trim();
  const head = `${marker(submission, key)}\n**Owner ruling** (rulings page, ${date})`;
  if (!opt) {
    return { key, repo, n: t.n, needsJudgment: true, note,
      comment: `${head}\n\n> ${note.replace(/\n/g, '\n> ')}` };
  }
  const l = opt.landing || {};
  const lines = [head, '', `Picked: **${opt.label}**${opt.recommended ? ' (the recommended option)' : ''}.`, '', l.ruling || opt.detail];
  if (note) lines.push('', `Owner's note: ${note}`);
  const close = l.action === 'close-completed' ? 'completed' : l.action === 'close-wontfix' ? 'not planned' : null;
  const add = [...(l.addLabels || [])], remove = [...(l.removeLabels || [])];
  if (l.action === 'close-wontfix' && !add.includes('wontfix')) add.push('wontfix');
  if (close && !remove.includes('ready-for-human')) remove.push('ready-for-human');
  // Child tickets are agent work the script cannot do (to-tickets): post the ruling, leave the rest.
  return { key, repo, n: t.n, needsJudgment: l.action === 'spawn-children', comment: lines.join('\n'),
    addLabels: add.filter(x => !remove.includes(x)), removeLabels: remove.filter(x => !add.includes(x)),
    close, action: l.action, outcome: opt.label, blocks: t.blocks || [] };
}

function gh(args, input) {
  return execFileSync('gh', args, { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Execute one planned landing. Idempotent: a comment already carrying the marker is not reposted. */
function executeLanding(p, submission, run = gh) {
  const view = JSON.parse(run(['issue', 'view', String(p.n), '--repo', p.repo, '--json', 'comments,labels,state']));
  const m = marker(submission, p.key);
  if (!view.comments.some(c => (c.body || '').includes(m))) {
    const f = path.join(os.tmpdir(), `ruling-${p.key.replace('~', '-')}-${Date.now()}.md`);
    fs.writeFileSync(f, p.comment);
    run(['issue', 'comment', String(p.n), '--repo', p.repo, '--body-file', f]);
    fs.rmSync(f, { force: true });
  }
  if (p.needsJudgment) return { key: p.key, ok: true, outcome: 'note posted; labels left for the run to set', needsJudgment: true };
  const have = new Set(view.labels.map(l => l.name));
  const add = p.addLabels.filter(x => !have.has(x)), remove = p.removeLabels.filter(x => have.has(x));
  if (add.length || remove.length) {
    const args = ['issue', 'edit', String(p.n), '--repo', p.repo];
    if (add.length) args.push('--add-label', add.join(','));
    if (remove.length) args.push('--remove-label', remove.join(','));
    run(args);
  }
  if (p.close && view.state === 'OPEN') run(['issue', 'close', String(p.n), '--repo', p.repo, '--reason', p.close]);
  const after = JSON.parse(run(['issue', 'view', String(p.n), '--repo', p.repo, '--json', 'labels,state']));
  const labels = after.labels.map(l => l.name);
  const ok = p.addLabels.every(x => labels.includes(x)) && p.removeLabels.every(x => !labels.includes(x))
    && (!p.close || after.state === 'CLOSED');
  return { key: p.key, ok, outcome: p.outcome, detail: `${after.state.toLowerCase()} · ${labels.join(', ') || 'no labels'}`,
    closed: after.state === 'CLOSED', blocks: p.blocks };
}

function readRulings(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    if (!String(f).endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, String(f)), 'utf8'));
    const b = raw.data || raw;
    if (b && b.key) out[b.key] = b;
  }
  return out;
}

function arg(argv, name, dflt) {
  const i = argv.indexOf('--' + name);
  return i < 0 ? dflt : argv[i + 1];
}

function main(argv) {
  const cmd = argv[0];
  if (cmd === 'queue') {
    const page = arg(argv, 'page');
    const data = page && fs.existsSync(page) ? readPageData(fs.readFileSync(page, 'utf8')) : null;
    const queue = JSON.parse(gh(['search', 'issues', '--label', 'ready-for-human', '--state', 'open',
      '--owner', arg(argv, 'owner', 'surreptakos'), '--limit', '300', '--json', 'repository,number,title,updatedAt']));
    process.stdout.write(JSON.stringify(planQueue(data, queue), null, 1) + '\n');
  } else if (cmd === 'build') {
    const { html, data } = buildPage(arg(argv, 'drafts'), fs.readFileSync(TEMPLATE, 'utf8'));
    fs.writeFileSync(arg(argv, 'out'), html);
    console.log(data.repos.map(r => `${short(r.repo)} ${r.tickets.length}`).join('\n'));
    console.log('total', data.repos.reduce((a, r) => a + r.tickets.length, 0));
  } else if (cmd === 'land') {
    const data = readPageData(fs.readFileSync(arg(argv, 'page'), 'utf8'));
    const rulings = readRulings(arg(argv, 'rulings'));
    const submission = arg(argv, 'submission');
    const keys = (arg(argv, 'keys') || '').split(',').filter(Boolean);
    const date = new Date().toISOString().slice(0, 10);
    const results = [];
    for (const k of keys) {
      const [s, n] = k.split('~');
      const r = data.repos.find(x => short(x.repo) === s);
      const t = r && r.tickets.find(x => x.n === Number(n));
      if (!t || !rulings[k]) { results.push({ key: k, ok: false, outcome: 'no draft or no ruling found' }); continue; }
      const p = planLanding(r.repo, t, rulings[k], submission, date);
      if (!argv.includes('--execute')) { results.push(p); continue; }
      try { results.push(executeLanding(p, submission)); }
      catch (e) { results.push({ key: k, ok: false, outcome: 'gh failed', detail: String(e.stderr || e.message).trim().slice(0, 300) }); }
    }
    process.stdout.write(JSON.stringify(results, null, 1) + '\n');
    if (results.some(x => x.ok === false)) process.exitCode = 1;
  } else {
    console.error('usage: rulings-page.js queue|build|land (see header)');
    process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { readPageData, planQueue, buildPage, planLanding, executeLanding, readRulings, keyOf, marker };
