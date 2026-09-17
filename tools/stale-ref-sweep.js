#!/usr/bin/env node
/**
 * Runner for .github/workflows/stale-ref-sweep.yml (issue 474).
 *
 *   node tools/stale-ref-sweep.js            # dry run — prints the verdict for every candidate
 *   node tools/stale-ref-sweep.js --apply    # delete landed refs, close superseded PRs, file/close the issue
 *
 * WHY A WORKFLOW. `/session-end` step 11 used to sweep the WHOLE repo — every foreign worktree,
 * every merged and squash-landed branch, every superseded fleet PR — from inside whichever session
 * happened to be wrapping up. Three things were wrong with that. A session runs in a worktree, and
 * a worktree cannot delete its own branch or read `git branch --merged` honestly. A cloud
 * container's auto-mode classifier refuses `git push origin --delete` and `git branch -D` mid-sweep,
 * so the cleanup landed as prose in a reply nobody reads. And a sweep that only runs when a session
 * ends is a sweep that does not run: 40 `agent/*` refs from four fleet waves were standing on the
 * remote when this ticket was written. A runner has no worktree, no classifier, and a cron. Step 11
 * now limits itself to the session's own branch and worktree; this job owns the repo-wide half.
 *
 * WHITELIST, NOT BLOCKLIST (the repo's own invariant, CLAUDE.md). Only refs in the namespaces the
 * harness GENERATES are candidates — `agent/*` (fleet attempts), `worktree-*` / `wf_*` (the refs a
 * worktree leaves behind), `claude/*` (cloud sessions). Everything else is untouchable by
 * construction, and that is not a nicety: `deploy/run`, `deploy/test`, `deploy/prod` are the gas
 * package's live deploy channel (gas/README.md) and `gas-canary`, `dashboard`, `research/*` are
 * standing refs. A pattern-based "delete what looks merged" sweep would eventually take one of
 * them, and the cost of that is a production script deploying from a ref that no longer exists.
 *
 * NEVER FORCE-DELETE. A ref is deleted only on PATCH-ID EVIDENCE that its content is already on the
 * default branch — either the ref is an ancestor of it, or `git cherry` finds an equivalent commit
 * upstream for every commit, or the whole branch diff has the same patch-id as one commit there (the
 * `gh pr merge --squash` case, which rewrites the SHA and the subject). A branch that only MATCHES
 * BY SUBJECT is `probably-landed` and is never deleted — a subject is not evidence, and the sweep's
 * job is to be boring. Stranded work is named on the sweep's issue instead, by branch name, with
 * its unique commits. `assertNoForce` refuses every force spelling before a git command runs, so
 * "never force-delete" is a gate in the code and not a paragraph in this comment.
 *
 * ONE ISSUE, UPDATED. The findings land on a single `ready-for-human` issue carrying MARKER in its
 * body: the sweep rewrites that issue's body every run, and CLOSES it when a run finds nothing.
 * A weekly cron that filed a fresh issue would bury the tracker in near-identical tickets, and the
 * owner's queue is a label query — 20 of them read as 20 problems.
 *
 * Exit codes: 0 swept (findings or not), 1 a write failed or `--apply` has no token, 2 the repo
 * could not be read at all.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

/** The namespaces the harness generates, and the only refs this sweep may ever delete. */
const SWEEPABLE = [
  { kind: 'fleet attempt', re: /^agent\// },
  { kind: 'worktree ref', re: /^(?:worktree-|wf_)/ },
  { kind: 'cloud session', re: /^claude\// },
];

/** Verdicts that are deletion-eligible. Nothing else is, ever. */
const DELETABLE = new Set(['merged', 'squash-landed']);

/** How many commits of the default branch the squash/subject search reaches back over. */
const DEFAULT_DEPTH = 300;

const MARKER = '<!-- stale-ref-sweep -->';
const ISSUE_TITLE = 'Stale ref sweep: branches and PRs needing a human ruling';
const ISSUE_LABEL = 'ready-for-human';

const MISSING_TOKEN = '::error::--apply needs a GitHub token (GH_TOKEN or GITHUB_TOKEN) to close '
  + 'superseded PRs and file the sweep issue. In Actions grant the job `contents: write`, '
  + '`issues: write` and `pull-requests: write` and pass `GH_TOKEN: ${{ github.token }}`. Refusing '
  + 'to run: a token-less sweep deletes refs and then loses every finding, which looks exactly '
  + 'like a clean repo.';

// A force spelling can only ever turn "delete what is proven landed" into "delete whatever is
// there". Checked on the argv of every git command the sweep runs, not just the delete.
const FORCE_SPELLINGS = ['-D', '--force', '-f', '--force-with-lease'];

function assertNoForce(args) {
  for (const a of args) {
    if (FORCE_SPELLINGS.includes(a)) {
      throw new Error(`stale-ref-sweep refuses a force spelling: ${a}`);
    }
    // `git push origin +refs/heads/x` is a force push by refspec, with no flag to spot.
    if (/^\+/.test(a) && /:|refs\//.test(a)) {
      throw new Error(`stale-ref-sweep refuses a force refspec: ${a}`);
    }
  }
  return args;
}

// The variables git exports into a hook. `cwd` does not override any of them, so an inherited
// GIT_DIR would point every command below at whatever repo invoked this script (issue 433).
const GIT_ENV_NAMES = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_COMMON_DIR',
                       'GIT_OBJECT_DIRECTORY'];

function childEnv(env) {
  const out = { ...env };
  for (const k of GIT_ENV_NAMES) delete out[k];
  return out;
}

function defaultGit(args, input, cwd, env) {
  return execFileSync('git', assertNoForce(args), {
    cwd,
    env: childEnv(env || process.env),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

function defaultGh(args, input, cwd, env) {
  return execFileSync('gh', args, {
    cwd,
    env: env || process.env,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
    input,
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });
}

/** The namespace entry a branch belongs to, or null when it is out of bounds for the sweep. */
function sweepableKind(name) {
  for (const entry of SWEEPABLE) if (entry.re.test(name)) return entry.kind;
  return null;
}

/**
 * `facts` is everything git can say about one branch, gathered by `gatherFacts`:
 *   { name, isAncestor, commits: [{sha, subject}], unique: [{sha, subject}],
 *     equivalents: [sha…]  — upstream twins git cherry found,
 *     squashSha            — a default-branch commit with the branch's whole-diff patch-id,
 *     subjectMatches: [sha…] — default-branch commits whose subject matches, one per commit }
 *
 * Returned verdicts, strongest evidence first:
 *   merged          — the ref is already an ancestor, or adds no diff at all
 *   squash-landed   — patch-id proof: every commit has an upstream twin, or the squash commit is named
 *   probably-landed — subjects match and nothing else does. NOT deleted; a human rules on it
 *   stranded        — unique work with no counterpart on the default branch
 */
function classifyBranch(facts) {
  if (facts.isAncestor) {
    return { verdict: 'merged', evidence: 'already an ancestor of the default branch' };
  }
  if (facts.commits.length === 0) {
    return { verdict: 'merged', evidence: 'no commits of its own' };
  }
  if (facts.emptyDiff) {
    return { verdict: 'merged', evidence: 'its whole diff against the merge base is empty' };
  }
  if (facts.unique.length === 0) {
    return {
      verdict: 'squash-landed',
      evidence: `git cherry finds an upstream twin for all ${facts.commits.length} commit(s): `
        + facts.equivalents.map(s => s.slice(0, 12)).join(', '),
    };
  }
  if (facts.squashSha) {
    return {
      verdict: 'squash-landed',
      evidence: `its whole diff has the same patch-id as ${facts.squashSha.slice(0, 12)} on the default branch`,
    };
  }
  if (facts.subjectMatches.length === facts.commits.length && facts.commits.length > 0) {
    return {
      verdict: 'probably-landed',
      evidence: 'every commit subject appears on the default branch, but no patch-id matches — '
        + 'content may have been amended. A subject is not evidence, so this ref is not deleted: '
        + `compare ${facts.subjectMatches.map(s => s.slice(0, 12)).join(', ')} by hand`,
    };
  }
  return {
    verdict: 'stranded',
    evidence: `${facts.unique.length} commit(s) with no counterpart on the default branch: `
      + facts.unique.map(c => `${c.sha.slice(0, 12)} ${c.subject}`).join('; '),
  };
}

/** Map<patchId, sha> over the last `depth` commits of `ref`. One git pipeline, not one per commit. */
function landedPatchIndex(git, ref, depth) {
  const log = git(['log', '--format=%H', '-p', '--full-index', '-n', String(depth), ref]);
  const index = new Map();
  if (!log.trim()) return index;
  for (const line of git(['patch-id', '--stable'], log).split('\n')) {
    const [patchId, sha] = line.trim().split(/\s+/);
    if (patchId && sha && !/^0+$/.test(sha)) index.set(patchId, sha);
  }
  return index;
}

/** A squash merge rewrites the subject to `<PR title> (#N)`; compare without that suffix. */
function normalizeSubject(subject) {
  return subject.replace(/\s*\(#\d+\)\s*$/, '').trim().toLowerCase();
}

function landedSubjectIndex(git, ref, depth) {
  const index = new Map();
  const out = git(['log', `--format=%H%x1f%s`, '-n', String(depth), ref]);
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [sha, subject] = line.split('\x1f');
    if (sha && subject !== undefined) {
      const key = normalizeSubject(subject);
      if (key && !index.has(key)) index.set(key, sha);
    }
  }
  return index;
}

/**
 * The default branch, from the env the workflow sets, else the remote HEAD alias, else whichever of
 * `master`/`main` exists. The fallback chain matters: `refs/remotes/origin/HEAD` is NOT set by
 * `actions/checkout` or by a plain `git fetch`, so on a runner the env var is what usually answers —
 * but a desktop run has neither, and guessing `main` in a `master` repo would read every branch as
 * stranded and file a 50-line issue.
 */
function resolveDefaultBranch(git, env = {}) {
  const fromEnv = (env.STALE_REF_SWEEP_DEFAULT_BRANCH || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim();
    if (head) return head.replace(/^origin\//, '');
  } catch { /* not set in this clone — fall through */ }
  for (const name of ['master', 'main']) {
    try {
      git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`]);
      return name;
    } catch { /* try the next one */ }
  }
  throw new Error('no default branch: set STALE_REF_SWEEP_DEFAULT_BRANCH');
}

/** Everything git can say about one branch. `patchIndex` is a thunk; see the call below it. */
function gatherFacts(git, defaultRef, ref, name, patchIndex, subjectIndex) {
  let isAncestor = false;
  try {
    git(['merge-base', '--is-ancestor', ref, defaultRef]);
    isAncestor = true;
  } catch { /* non-zero exit means "not an ancestor", which is the common case */ }
  if (isAncestor) return { name, isAncestor, commits: [], unique: [], equivalents: [], subjectMatches: [] };

  const base = git(['merge-base', defaultRef, ref]).trim();
  const commits = [];
  for (const line of git(['log', '--format=%H%x1f%s', `${base}..${ref}`]).split('\n')) {
    if (!line.trim()) continue;
    const [sha, subject] = line.split('\x1f');
    commits.push({ sha, subject: subject === undefined ? '' : subject });
  }

  // git cherry: `-` is "an equivalent patch is already upstream", `+` is "not upstream". This is
  // per-commit patch-id equality, so it covers rebases and cherry-picks and — because a squash of
  // ONE commit produces the identical diff — the commonest squash-merge shape too.
  const unique = [];
  const equivalents = [];
  for (const line of git(['cherry', '-v', defaultRef, ref]).split('\n')) {
    const m = /^([+-])\s+([0-9a-f]+)\s?(.*)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === '+') unique.push({ sha: m[2], subject: m[3] });
    else equivalents.push(m[2]);
  }

  // The multi-commit squash: no single commit matches, but the branch's whole diff does.
  const diff = git(['diff', '--full-index', base, ref]);
  const emptyDiff = diff.trim() === '';
  let squashSha = null;
  if (!emptyDiff && unique.length > 0) {
    const [patchId] = git(['patch-id', '--stable'], diff).trim().split(/\s+/);
    // `patchIndex` is a THUNK: the index behind it is a whole `git log -p` of the default branch,
    // so it is built only when a branch actually needs it. An ancestor or a cherry-clean branch
    // never pays for it, and a repo whose candidates are all clean never reads that history at all.
    const index = patchIndex();
    if (patchId && index.has(patchId)) squashSha = index.get(patchId);
  }

  const subjectMatches = [];
  for (const c of commits) {
    const hit = subjectIndex.get(normalizeSubject(c.subject));
    if (hit) subjectMatches.push(hit);
  }

  return { name, isAncestor, commits, unique, equivalents, squashSha, emptyDiff, subjectMatches };
}

/**
 * What the sweep will do, given classified branches and the open PRs. Pure: the deletion gate and
 * the superseded-PR pairing are decided here and nowhere else, so a test can hold the whole rule.
 */
function plan(branches, prs) {
  const byBranch = new Map(branches.map(b => [b.name, b]));
  const closures = [];
  const undecidedPrs = [];
  for (const pr of prs) {
    const b = byBranch.get(pr.headRefName);
    if (pr.isCrossRepository) {
      undecidedPrs.push({ ...pr, why: 'opened from a fork — this sweep cannot judge or delete a fork ref' });
      continue;
    }
    if (!b) continue; // a PR on a branch outside the sweepable namespaces is none of our business
    if (DELETABLE.has(b.verdict)) closures.push({ pr, branch: b });
    else if (b.verdict === 'probably-landed') {
      undecidedPrs.push({ ...pr, why: `its branch \`${b.name}\` is ${b.verdict}: ${b.evidence}` });
    }
  }
  // A branch carrying an open PR is deleted only after that PR is closed, so the deletion order
  // below is closures-first. Nothing deletable is skipped: closing the PR is part of the delete.
  const deletions = branches.filter(b => DELETABLE.has(b.verdict));
  const stranded = branches.filter(b => b.verdict === 'stranded');
  const probably = branches.filter(b => b.verdict === 'probably-landed');
  return { deletions, closures, stranded, probably, undecidedPrs };
}

function hasFindings(p) {
  return p.stranded.length > 0 || p.probably.length > 0 || p.undecidedPrs.length > 0;
}

/** The body of the one `ready-for-human` issue. Carries MARKER so the next run finds it. */
function renderBody(p, meta) {
  const L = [];
  L.push(MARKER);
  L.push('');
  L.push('Filed and rewritten by the **Stale ref sweep** workflow (`.github/workflows/stale-ref-sweep.yml`,');
  L.push('issue 474). It deletes every ref it can prove landed and lists here only what needs a human');
  L.push('ruling. **Do not close this by hand** — the next sweep that finds nothing closes it itself.');
  L.push('');
  L.push(`Last sweep: ${meta.when}${meta.runUrl ? ` ([run](${meta.runUrl}))` : ''}, default branch \`${meta.defaultBranch}\`.`);
  L.push(`Refs deleted this run: ${p.deletions.length}. PRs closed as superseded: ${p.closures.length}.`);
  L.push('');
  if (p.stranded.length) {
    L.push('## Stranded branches — unique work with no counterpart on the default branch');
    L.push('');
    L.push('Never deleted by the sweep. Land the work, or delete the ref yourself once it is dead.');
    L.push('');
    for (const b of p.stranded) L.push(`- \`${b.name}\` (${b.kind}) — ${b.evidence}`);
    L.push('');
  }
  if (p.probably.length) {
    L.push('## Probably landed — subject match only, no patch-id proof');
    L.push('');
    L.push('The commits look like they landed under different content (an amend, a conflict fixup).');
    L.push('Compare the named commits and delete the ref, or say why it stays.');
    L.push('');
    for (const b of p.probably) L.push(`- \`${b.name}\` (${b.kind}) — ${b.evidence}`);
    L.push('');
  }
  if (p.undecidedPrs.length) {
    L.push('## Open PRs the sweep would not close');
    L.push('');
    for (const pr of p.undecidedPrs) L.push(`- ${pr.url || `#${pr.number}`} — ${pr.why}`);
    L.push('');
  }
  L.push('## Done when');
  L.push('');
  L.push('- [ ] Every branch and PR listed above has been landed, deleted or ruled on');
  L.push('- [ ] A later sweep run finds nothing and closes this issue');
  return L.join('\n') + '\n';
}

function findSweepIssue(gh) {
  const raw = gh(['issue', 'list', '--state', 'open', '--limit', '1000', '--json', 'number,title,body']);
  let rows;
  try { rows = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(rows)) return null;
  return rows.find(r => typeof r.body === 'string' && r.body.includes(MARKER)) || null;
}

function staleRefSweep(opts = {}) {
  const env = opts.env || process.env;
  const argv = opts.argv || process.argv.slice(2);
  const cwd = opts.cwd || process.cwd();
  const git = opts.git || ((args, input) => defaultGit(args, input, cwd, env));
  const gh = opts.gh || ((args, input) => defaultGh(args, input, cwd, env));
  const out = [];
  const emit = opts.log || (line => console.log(line));
  const log = line => { out.push(line); emit(line); };
  const finish = code => {
    const summary = env.GITHUB_STEP_SUMMARY;
    if (summary) {
      try {
        fs.appendFileSync(summary, `### Stale ref sweep\n\n\`\`\`\n${out.join('\n')}\n\`\`\`\n`, 'utf8');
      } catch { /* a missing summary file must never decide the verdict */ }
    }
    return { code, output: out.join('\n'), plan: lastPlan };
  };
  let lastPlan = null;

  const apply = argv.includes('--apply');
  const depth = Number(env.STALE_REF_SWEEP_DEPTH || DEFAULT_DEPTH) || DEFAULT_DEPTH;
  if (apply && !(env.GH_TOKEN || env.GITHUB_TOKEN || '').trim()) {
    log(MISSING_TOKEN);
    return finish(1);
  }

  let defaultBranch;
  try {
    git(['fetch', '--prune', 'origin']);
    defaultBranch = resolveDefaultBranch(git, env);
  } catch (e) {
    log(`::error::could not read the remote: ${e.message.split('\n')[0]}`);
    return finish(2);
  }
  const defaultRef = `origin/${defaultBranch}`;
  log(`default branch ${defaultBranch}; ${apply ? 'APPLY' : 'dry run'}; patch search depth ${depth}`);

  // Candidates: remote heads inside the generated namespaces. `for-each-ref` rather than
  // `branch -r` so the output has no `->` HEAD alias line and no leading whitespace to trim.
  const heads = git(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/'])
    .split('\n').map(s => s.trim()).filter(Boolean);
  const skipped = [];
  const candidates = [];
  for (const name of heads) {
    if (name === defaultBranch || name === 'HEAD') continue;
    const kind = sweepableKind(name);
    if (kind) candidates.push({ name, kind });
    else skipped.push(name);
  }
  log(`${candidates.length} candidate ref(s); ${skipped.length} outside the sweepable namespaces`
    + `${skipped.length ? ` (left alone: ${skipped.join(', ')})` : ''}`);

  let memo = null;
  const patchIndex = () => (memo || (memo = landedPatchIndex(git, defaultRef, depth)));
  const subjectIndex = candidates.length ? landedSubjectIndex(git, defaultRef, depth) : new Map();

  const branches = [];
  for (const c of candidates) {
    const facts = gatherFacts(git, defaultRef, `origin/${c.name}`, c.name, patchIndex, subjectIndex);
    const { verdict, evidence } = classifyBranch(facts);
    branches.push({ name: c.name, kind: c.kind, verdict, evidence });
    log(`  ${verdict.padEnd(15)} ${c.name} — ${evidence}`);
  }

  let prs = [];
  try {
    prs = JSON.parse(gh(['pr', 'list', '--state', 'open', '--limit', '100',
      '--json', 'number,title,url,headRefName,isCrossRepository']));
  } catch (e) {
    log(`::warning::could not list open PRs (${e.message.split('\n')[0]}); the superseded-PR half is skipped`);
  }

  const p = plan(branches, Array.isArray(prs) ? prs : []);
  lastPlan = p;
  let fails = 0;

  // A branch whose PR could not be closed is held back from the delete below: deleting the head of
  // an open PR closes it with no comment, which is how a superseded PR loses the record of why.
  const held = new Set();
  for (const { pr, branch } of p.closures) {
    const note = `Superseded: \`${branch.name}\` is ${branch.verdict} — ${branch.evidence}. `
      + 'Closed by the Stale ref sweep (issue 474); reopen if this reading is wrong.';
    log(`  ${apply ? 'close' : 'would close'} PR #${pr.number} (${branch.name})`);
    if (!apply) continue;
    try {
      gh(['pr', 'close', String(pr.number), '--comment', note]);
    } catch (e) {
      fails++;
      held.add(branch.name);
      log(`::error::could not close PR #${pr.number}: ${e.message.split('\n')[0]}`);
    }
  }

  for (const b of p.deletions) {
    if (held.has(b.name)) {
      log(`  skip origin/${b.name} — its PR is still open and could not be closed`);
      continue;
    }
    log(`  ${apply ? 'delete' : 'would delete'} origin/${b.name}`);
    if (!apply) continue;
    try {
      git(['push', 'origin', '--delete', b.name]);
    } catch (e) {
      fails++;
      log(`::error::could not delete origin/${b.name}: ${e.message.split('\n')[0]}`);
    }
  }

  // Stale worktree metadata in THIS checkout. A runner has none; a desktop run of this script
  // clears the admin dirs of worktrees whose directory is already gone.
  try {
    const pruned = git(['worktree', 'prune', '-v']).trim();
    if (pruned) for (const line of pruned.split('\n')) log(`  worktree prune: ${line}`);
  } catch { /* nothing to prune, or no worktrees at all */ }

  const meta = {
    when: (opts.now || (() => new Date()))().toISOString().replace(/\.\d+Z$/, 'Z'),
    defaultBranch,
    runUrl: env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
      ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` : null,
  };

  let existing = null;
  try {
    existing = findSweepIssue(gh);
  } catch (e) {
    fails++;
    log(`::error::could not read the tracker: ${e.message.split('\n')[0]}`);
  }

  if (hasFindings(p)) {
    const body = renderBody(p, meta);
    log(`findings: ${p.stranded.length} stranded, ${p.probably.length} probably-landed, `
      + `${p.undecidedPrs.length} undecided PR(s)`);
    if (!apply) {
      log(existing ? `  would update issue #${existing.number}` : '  would file the sweep issue');
    } else {
      try {
        if (existing) {
          gh(['issue', 'edit', String(existing.number), '--body-file', '-'], body);
          log(`  updated issue #${existing.number}`);
        } else {
          const url = gh(['issue', 'create', '--title', ISSUE_TITLE, '--label', ISSUE_LABEL,
            '--body-file', '-'], body).trim();
          log(`  filed ${url.split('\n').pop()}`);
        }
      } catch (e) {
        fails++;
        log(`::error::could not write the sweep issue: ${e.message.split('\n')[0]}`);
      }
    }
  } else {
    log('findings: none — nothing needs a human');
    if (!existing) log('  no open sweep issue to close');
    else if (!apply) log(`  would close issue #${existing.number}`);
    else {
      try {
        gh(['issue', 'comment', String(existing.number), '--body',
          `Sweep on ${meta.when} found nothing needing a human: every candidate ref was either `
          + 'proven landed and deleted, or outside the sweepable namespaces. Closing; the next '
          + 'sweep with findings reopens the record by filing a fresh issue.']);
        gh(['issue', 'close', String(existing.number), '--reason', 'completed']);
        log(`  closed issue #${existing.number}`);
      } catch (e) {
        fails++;
        log(`::error::could not close issue #${existing.number}: ${e.message.split('\n')[0]}`);
      }
    }
  }

  log(`total: ${p.deletions.length} ref(s) deleted, ${p.closures.length} PR(s) closed, ${fails} failure(s)`);
  if (fails) log(`::error::stale ref sweep had ${fails} failure(s) — see the lines above.`);
  return finish(fails ? 1 : 0);
}

module.exports = {
  staleRefSweep,
  classifyBranch,
  plan,
  renderBody,
  hasFindings,
  sweepableKind,
  resolveDefaultBranch,
  assertNoForce,
  normalizeSubject,
  landedPatchIndex,
  landedSubjectIndex,
  gatherFacts,
  findSweepIssue,
  SWEEPABLE,
  DELETABLE,
  MARKER,
  ISSUE_TITLE,
  ISSUE_LABEL,
  MISSING_TOKEN,
};

if (require.main === module) process.exit(staleRefSweep().code);
