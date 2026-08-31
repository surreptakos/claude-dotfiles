#!/usr/bin/env node
/**
 * Move CLOSED GitHub issues/PRs to the Done column on every project board linked to this repo.
 *
 *   node ~/.claude/skills/session-end/sweep-closed-to-done.js            # dry-run
 *   node ~/.claude/skills/session-end/sweep-closed-to-done.js --apply    # write
 *
 * Zero configuration. Reads the git remote for the repo, asks GitHub which ProjectsV2 boards
 * are linked to it, and sweeps each. No `.claude/session.json` block required.
 *
 * A board is included when it has a single-select field named "Status" with an option named
 * "Done" (case-insensitive). Boards without that shape are skipped with a one-line reason.
 *
 * Exit 0: nothing to do or all writes ok. Exit 1: at least one write failed. Exit 2: hard
 * failure (not a git repo, no GitHub remote, gh missing).
 *
 * Uses `gh`. Requires project scope: `gh auth refresh -s project,read:project`.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');

function run(cmd, args, opts = {}) {
  // 50MB: a 350+-item board's item-list JSON overflows the 1MB default (ENOBUFS, 2026-08-18)
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024, ...opts });
}
function gh(args) { return run('gh', args); }
function ghJson(args) { return JSON.parse(gh(args)); }

function findRepoRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const repoRoot = findRepoRoot(process.cwd());
if (!repoRoot) { console.error('not in a git repo'); process.exit(2); }

let remote;
try {
  remote = run('git', ['-C', repoRoot, 'remote', 'get-url', 'origin']).trim();
} catch { console.error('no origin remote'); process.exit(2); }
const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/);
if (!m) { console.error(`origin is not a GitHub remote: ${remote}`); process.exit(2); }
const REPO = `${m[1]}/${m[2]}`;

let repoInfo;
try {
  repoInfo = ghJson(['repo', 'view', REPO, '--json', 'projectsV2']);
} catch (e) {
  console.error(`gh repo view failed: ${e.message.split('\n')[0]}`);
  process.exit(2);
}
const linked = (repoInfo.projectsV2 && (repoInfo.projectsV2.Nodes || repoInfo.projectsV2.nodes)) || [];
const openBoards = linked.filter(p => !p.closed);
if (!openBoards.length) { console.log(`no open ProjectsV2 boards linked to ${REPO}`); process.exit(0); }

const closedIssues = ghJson(['issue', 'list', '-R', REPO, '--state', 'closed', '--limit', '1000', '--json', 'number']);
const closedPrs = ghJson(['pr', 'list', '-R', REPO, '--state', 'closed', '--limit', '1000', '--json', 'number']);
const closedNums = new Set([...closedIssues, ...closedPrs].map(r => r.number));

let totalFails = 0;
let totalMoved = 0;

for (const board of openBoards) {
  const pathMatch = (board.resourcePath || '').match(/^\/(users|orgs)\/([^/]+)\/projects\/(\d+)$/);
  if (!pathMatch) { console.log(`skip ${board.title}: cannot parse ${board.resourcePath}`); continue; }
  const ownerType = pathMatch[1] === 'orgs' ? 'organization' : 'user';
  const OWNER = pathMatch[2];
  const NUMBER = Number(pathMatch[3]);
  const label = `${OWNER}/#${NUMBER} "${board.title}"`;

  const fieldQuery = ownerType === 'organization'
    ? `query($o:String!,$n:Int!){organization(login:$o){projectV2(number:$n){id fields(first:50){nodes{__typename ... on ProjectV2SingleSelectField{id name options{id name}}}}}}}`
    : `query($o:String!,$n:Int!){user(login:$o){projectV2(number:$n){id fields(first:50){nodes{__typename ... on ProjectV2SingleSelectField{id name options{id name}}}}}}}`;
  let projRoot;
  try {
    const res = JSON.parse(gh(['api', 'graphql', '-f', `query=${fieldQuery}`, '-f', `o=${OWNER}`, '-F', `n=${NUMBER}`]));
    projRoot = res.data[ownerType === 'organization' ? 'organization' : 'user'].projectV2;
  } catch (e) {
    console.log(`skip ${label}: ${e.message.split('\n')[0]}`);
    continue;
  }
  const statusField = projRoot.fields.nodes.find(f => f.name === 'Status' && f.__typename === 'ProjectV2SingleSelectField');
  if (!statusField) { console.log(`skip ${label}: no Status single-select`); continue; }
  const doneOpt = statusField.options.find(o => o.name.toLowerCase() === 'done');
  if (!doneOpt) { console.log(`skip ${label}: no "Done" option`); continue; }

  let items;
  try {
    items = ghJson(['project', 'item-list', String(NUMBER), '--owner', OWNER, '--format', 'json', '--limit', '500']).items || [];
  } catch (e) {
    console.log(`skip ${label}: item-list failed: ${e.message.split('\n')[0]}`);
    continue;
  }

  const stale = [];
  for (const it of items) {
    const c = it.content;
    if (!c || !c.url) continue;
    const im = c.url.match(new RegExp(`github\\.com/${REPO.replace('/', '\\/')}/(?:issues|pull)/(\\d+)`));
    if (!im) continue;
    const num = Number(im[1]);
    if (closedNums.has(num) && it.status !== doneOpt.name) {
      stale.push({ id: it.id, num, title: (c.title || '').slice(0, 60), current: it.status || '(none)' });
    }
  }
  if (!stale.length) { console.log(`${label}: 0 stale`); continue; }
  console.log(`${label}: ${stale.length} stale`);
  for (const s of stale) console.log(`  #${s.num} ${s.current.padEnd(12)} ${s.title}`);
  if (!APPLY) continue;

  for (let i = 0; i < stale.length; i++) {
    const s = stale[i];
    try {
      execFileSync('gh', ['project', 'item-edit', '--project-id', projRoot.id, '--id', s.id, '--field-id', statusField.id, '--single-select-option-id', doneOpt.id], { stdio: 'ignore' });
      totalMoved++;
    } catch {
      totalFails++;
      console.log(`  #${s.num} FAIL`);
    }
  }
  console.log(`${label}: moved ${stale.length - totalFails}, fails ${totalFails}`);
}

if (!APPLY) console.log('re-run with --apply to move them');
else console.log(`total moved ${totalMoved}, fails ${totalFails}`);
process.exit(totalFails ? 1 : 0);
