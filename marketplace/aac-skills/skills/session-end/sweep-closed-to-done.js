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
 * "Done" (case-insensitive).
 *
 * A board GitHub reports as linked to this repo that this script cannot sweep — wrong shape, or
 * a `gh` call against it that failed — is a FAILURE, not a skip (issue 409). A rate-limited or
 * under-scoped token makes every board unsweepable, and a run that reports that as a skip goes
 * green having moved nothing, which is exactly what a clean board looks like. Every such line
 * carries gh's full stderr, because the first line of `e.message` is only the command line.
 *
 * Exit 0: nothing to do or all writes ok. Exit 1: at least one write failed, or a linked board
 * could not be swept. Exit 2: hard failure (not a git repo, no GitHub remote, gh missing).
 *
 * Uses `gh`. Requires project scope: `gh auth refresh -s project,read:project`.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const APPLY = process.argv.includes('--apply');

function run(cmd, args, opts = {}) {
  // 50MB: a 350+-item board's item JSON overflowed the 1MB default when it came back in one
  // item-list response (ENOBUFS, 2026-08-18); the paginated items query below is smaller per
  // call, and the headroom stays because a page of 100 cards with long titles is still big.
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024, ...opts });
}
function gh(args) { return run('gh', args); }
function ghJson(args) { return JSON.parse(gh(args)); }

// gh's own stderr is the diagnosis (auth, scope, a GraphQL rate limit, an unknown --json field);
// execFileSync keeps it off e.message, whose first line is only the command that was run, so a
// catch that prints just that line reports a failure it has already thrown the cause of away
// (issue 409).
function ghDetail(e) {
  const first = String(e && e.message || e).split('\n')[0];
  const detail = (e && e.stderr || '').toString().trim();
  return detail ? `${first}\n${detail}` : first;
}

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
  console.error(`gh repo view failed: ${ghDetail(e)}`);
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
let boardFails = 0;

// Every board here came back from `gh repo view --json projectsV2`, so it IS linked to this repo.
// Not sweeping one is a failure of this run, and the reason carries gh's stderr (issue 409).
function boardUnswept(label, reason) {
  boardFails++;
  console.log(`FAIL ${label}: ${reason}`);
}

// One page of a board's items, 100 at a time, until pageInfo says there is no next page.
function listItems(ownerType, owner, number) {
  const root = ownerType === 'organization' ? 'organization' : 'user';
  const query = `query($o:String!,$n:Int!,$after:String){${root}(login:$o){projectV2(number:$n){items(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{... on Issue{title url} ... on PullRequest{title url}}}}}}}`;
  const items = [];
  let after = null;
  for (;;) {
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `o=${owner}`, '-F', `n=${number}`];
    if (after) args.push('-f', `after=${after}`);
    const res = JSON.parse(gh(args));
    if (res.errors && res.errors.length) throw new Error(res.errors.map(e => e.message).join('; '));
    const page = res.data[root].projectV2.items;
    for (const n of page.nodes) {
      items.push({ id: n.id, status: n.fieldValueByName ? n.fieldValueByName.name : undefined, content: n.content });
    }
    if (!page.pageInfo.hasNextPage) return items;
    after = page.pageInfo.endCursor;
  }
}

for (const board of openBoards) {
  const pathMatch = (board.resourcePath || '').match(/^\/(users|orgs)\/([^/]+)\/projects\/(\d+)$/);
  if (!pathMatch) { boardUnswept(board.title, `cannot parse ${board.resourcePath}`); continue; }
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
    boardUnswept(label, `field query failed: ${ghDetail(e)}`);
    continue;
  }
  const statusField = projRoot.fields.nodes.find(f => f.name === 'Status' && f.__typename === 'ProjectV2SingleSelectField');
  if (!statusField) { boardUnswept(label, 'no Status single-select'); continue; }
  const doneOpt = statusField.options.find(o => o.name.toLowerCase() === 'done');
  if (!doneOpt) { boardUnswept(label, 'no "Done" option'); continue; }

  // The items come over GraphQL with the owner type parsed from resourcePath above, never
  // through `gh project item-list`: that command resolves whether --owner is a user or an org
  // through a REST lookup that PROJECT_TOKEN cannot make, and every run since 0b0a993 failed on
  // it with "unknown owner type" (issue 569). Same shape as item-list's JSON so the loop below
  // reads {id, status, content.url} either way.
  let items;
  try {
    items = listItems(ownerType, OWNER, NUMBER);
  } catch (e) {
    boardUnswept(label, `items query failed: ${ghDetail(e)}`);
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
if (boardFails) {
  console.error(`${boardFails} of ${openBoards.length} board(s) linked to ${REPO} could not be swept — see the FAIL lines above.`);
}
process.exit(totalFails || boardFails ? 1 : 0);
