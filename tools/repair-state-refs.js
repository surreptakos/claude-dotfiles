#!/usr/bin/env node
/**
 * node tools/repair-state-refs.js [--dry-run] [--only <slug>]
 *
 * Rewrites the master orchestrator state issues (the rows of lib/repos.json that name one) so that a
 * bare `#N` reference to work in the OWNING repo becomes `owner/repo#N`. Issue 92: masters
 * were writing bare `#N` for cross-repo work, which the tracker audit then flagged as
 * `dangling-reference` — the state issues live in claude-dotfiles, so a bare `#N` resolves
 * against dotfiles and reads as pointing to a dotfiles number that may not exist.
 *
 * The prose rule alone (boot prompt + LOCAL-RUNBOOK + RUNBOOK) is the weaker half — the
 * identical prose rule already existed in RUNBOOK.md and was ignored on 2026-09-03, which is
 * what filed this ticket. This script is the deterministic backstop, invoked from:
 *   * `orchestrator/master-watchdog.ps1` on every tick and again after a master closes.
 *   * `.github/workflows/repair-state-refs.yml` on `issues:edited` for a state issue and on cron —
 *     the cloud-master path never touches the local watchdog.
 *   * A human running `node tools/repair-state-refs.js --dry-run` at any time.
 *
 * Every dotfiles issue number below the highest aac-contract-builder number ALSO exists in
 * aac-contract-builder — the two number spaces overlap 1:1 for their common range — so a
 * bare `#N` cannot be disambiguated by number alone. The rewrite is CONTEXT-AWARE: it looks
 * at the closest preceding `surreptakos/<repo>` mention within `CONTEXT_WINDOW` bytes of the
 * bare ref. If the nearest such mention is the owning repo (and `N` is a real owning-repo
 * issue/PR number), the ref is qualified. If the nearest mention is `claude-dotfiles`, or
 * there is no nearby mention at all, the ref is left bare — a state issue's masthead phrases
 * like "the registry lives in #44" and orphan self-references stay untouched.
 *
 * Failure modes this leaves alone (documented, not bugs):
 *   * A bare `#N` whose closest preceding repo mention is `claude-dotfiles` but whose intent
 *     was owning-repo — leaves bare. Rare in practice: the master already qualifies dotfiles
 *     refs (`surreptakos/claude-dotfiles#125`), so a nearby `claude-dotfiles` mention only
 *     appears when the whole paragraph is about dotfiles.
 *   * A bare `#N` with no preceding repo mention in the window — leaves bare.
 * These cases still trip the tracker audit's `dangling-reference` check when `N` is not a
 * valid dotfiles number, which is the human's cue to fix the state issue by hand.
 *
 * The network-touching functions (`knownNumbers`, `repair`) accept an injectable `runGh` so
 * the whole flow — read body, list issue+PR numbers, and the write path via
 * `gh issue edit --body-file -` — is unit-testable in-process. See
 * tools/repair-state-refs.test.js.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOTFILES = 'surreptakos/claude-dotfiles';

// The rows come from lib/repos.json (issue 1067): every row that names a master and a state
// issue, served or not (an unserved row's state issue can still carry a bare ref from an
// earlier pass), in file order. The claude-dotfiles row is left out: its state issue lives in
// the repo it serves, so a bare `#N` there already points at the right number. The registry in
// claude-dotfiles issue #44 repeats the same rows; keep it in step by hand.
const REPOS = readRepoRows();

function readRepoRows() {
  const listPath = path.join(__dirname, '..', 'lib', 'repos.json');
  const data = JSON.parse(fs.readFileSync(listPath, 'utf8'));
  return data.repos
    .filter((r) => r.master && r.stateIssue && r.repo !== DOTFILES)
    .map((r) => ({ slug: r.master, repo: r.repo, stateIssue: r.stateIssue }));
}

// How far back to look for the disambiguating owner/repo mention. A tight window (120 chars,
// about one clause of prose) matches the observed pattern: a slip like
// "surreptakos/aac-contract-builder#216 at 17:31Z and closed #123" keeps the qualifier ~40
// chars from the bare ref, well inside the window. Widening it to sentence-scale silently
// pulls in the "state for `surreptakos/<owner-repo>`" intro line at the top of every state
// issue, so a bare `#N` anywhere in the first paragraph would be misread as owning-repo — the
// intro's "the registry lives in #44" is precisely the case that must stay bare. A narrower
// window prefers safe (leave-bare) over aggressive (misqualify).
const CONTEXT_WINDOW = 120;

/**
 * Default `gh` runner. `args` is the argv array; `input`, when set, is piped to stdin (used
 * only by `gh issue edit --body-file -`). Returns stdout. Throws on non-zero exit.
 * Overridden in tests to a pure in-process fake — never a global; injected per call.
 */
function defaultRunGh(args, input) {
  const opts = { encoding: 'utf8', stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'] };
  if (input !== undefined) opts.input = input;
  return execFileSync('gh', args, opts);
}

/** Every issue AND pull-request number in `repo`, as one Set<number>. */
function knownNumbers(repo, runGh) {
  const gh = runGh || defaultRunGh;
  const out = new Set();
  for (const kind of ['issue', 'pr']) {
    const raw = gh([kind, 'list', '-R', repo, '--state', 'all', '--limit', '1000', '--json', 'number']);
    for (const row of JSON.parse(raw)) out.add(row.number);
  }
  return out;
}

/**
 * Given the offset of a bare `#N` in `body`, decide which repo the surrounding text points
 * at. Scans backwards up to `CONTEXT_WINDOW` bytes for the last `surreptakos/<name>` mention
 * (bare owner/name OR `owner/name#M`). Returns 'repo' when the nearest match is `ownerRepo`,
 * 'dotfiles' when it is `surreptakos/claude-dotfiles`, and null when there is no nearby
 * mention. `null` and `'dotfiles'` both mean "do not rewrite"; only `'repo'` triggers a
 * qualification.
 */
function contextFor(body, offset, ownerRepo) {
  const start = Math.max(0, offset - CONTEXT_WINDOW);
  const window = body.slice(start, offset);
  const rx = /surreptakos\/([A-Za-z0-9._-]+)/g;
  let last = null;
  let m;
  while ((m = rx.exec(window)) !== null) last = m[1];
  if (last === null) return null;
  const ownerName = ownerRepo.split('/')[1];
  if (last === ownerName) return 'repo';
  if (last === 'claude-dotfiles') return 'dotfiles';
  // Some other repo mentioned nearby (e.g. a state issue for one master referencing another
  // master's repo). Refuse to guess: leave bare.
  return null;
}

/**
 * Rewrite bare `#N` refs to `ownerRepo#N` when both:
 *   1. `N` is a real issue/PR number in the owning repo (`knownRepo`), AND
 *   2. the closest preceding `surreptakos/<name>` mention within `CONTEXT_WINDOW` bytes
 *      names the owning repo.
 * The regex mirrors tools/tracker-audit.js's dangling-reference matcher exactly, so the audit
 * and the repair see the same bare refs.
 *
 * `knownDotfiles` is accepted for signature symmetry with the invocation but is not consulted
 * for the rewrite decision — the disambiguation is context-based, not number-set-based (see
 * the file header for why: every low dotfiles number also exists in aac-contract-builder).
 *
 * Returns [newBody, changedCount].
 */
function rewrite(body, knownDotfiles, knownRepo, ownerRepo) {
  let changed = 0;
  const rx = /(^|[^A-Za-z0-9_/-])#(\d+)\b/g;
  const out = body.replace(rx, (m, pre, digits, offset) => {
    const n = Number(digits);
    if (!knownRepo.has(n)) return m;                  // not an owning-repo number
    // `offset` here is the index of the whole match; the `#` sits at offset + pre.length.
    const hashAt = offset + pre.length;
    if (contextFor(body, hashAt, ownerRepo) !== 'repo') return m;
    changed++;
    return pre + ownerRepo + '#' + digits;
  });
  return [out, changed];
}

/**
 * Repair one state issue.
 *   opts.dryRun         - do not call `gh issue edit`.
 *   opts.knownDotfiles  - pre-fetched Set for claude-dotfiles (avoid one API call per row).
 *   opts.knownRepo      - pre-fetched Set for row.repo.
 *   opts.runGh          - injectable gh runner (default `defaultRunGh`); tests pass a fake.
 * Returns { row, changed, wrote, dryRun, newBody }.
 */
function repair(row, opts) {
  opts = opts || {};
  const gh = opts.runGh || defaultRunGh;
  const bodyRaw = gh(['issue', 'view', String(row.stateIssue), '-R', DOTFILES, '--json', 'body', '-q', '.body']);
  const body = String(bodyRaw).replace(/\r\n/g, '\n');
  const knownDotfiles = opts.knownDotfiles || knownNumbers(DOTFILES, gh);
  const knownRepo     = opts.knownRepo     || knownNumbers(row.repo, gh);
  const [newBody, changed] = rewrite(body, knownDotfiles, knownRepo, row.repo);
  if (changed === 0) return { row, changed, wrote: false, newBody };
  if (opts.dryRun)   return { row, changed, wrote: false, dryRun: true, newBody };
  gh(['issue', 'edit', String(row.stateIssue), '-R', DOTFILES, '--body-file', '-'], newBody);
  return { row, changed, wrote: true, newBody };
}

/**
 * Issue 930: the Actions GITHUB_TOKEN is scoped to claude-dotfiles, so `gh issue list` against
 * a sibling repo fails with GraphQL "Could not resolve to a Repository". Without the sibling's
 * number set nothing can be rewritten, so that one error means "nothing to repair" and the row
 * is skipped. Every other error still fails the run. The local watchdog runs under the owner's
 * gh login, which reads all four repos, so there the repair still happens.
 */
function isUnreadableRepo(err) {
  return /Could not resolve to a Repository/.test(String(err && err.message));
}

/**
 * The CLI. Returns the exit code: 0 when every row was rewritten, clean, or skipped as
 * unreadable; 2 on a usage error or any other failure. `io.runGh`, `io.log` and `io.error`
 * are injectable for tests.
 */
function main(argv, io) {
  io = io || {};
  const gh = io.runGh || defaultRunGh;
  const log = io.log || console.log;
  const error = io.error || console.error;
  const dryRun = argv.includes('--dry-run');
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  const rows = only ? REPOS.filter((r) => r.slug === only) : REPOS;
  if (rows.length === 0) {
    error('no matching repo for --only ' + only + ' (known: ' + REPOS.map((r) => r.slug).join(', ') + ')');
    return 2;
  }
  let knownDotfiles;
  try { knownDotfiles = knownNumbers(DOTFILES, gh); }
  catch (e) { error('cannot list ' + DOTFILES + ' numbers: ' + e.message); return 2; }
  let total = 0;
  let failures = 0;
  for (const row of rows) {
    try {
      let knownRepo;
      try { knownRepo = knownNumbers(row.repo, gh); }
      catch (e) {
        if (!isUnreadableRepo(e)) throw e;
        log('[' + row.slug + '] #' + row.stateIssue + ': skipped, ' + row.repo + ' is not readable with this token (nothing to repair)');
        continue;
      }
      const res = repair(row, { dryRun, knownDotfiles, knownRepo, runGh: gh });
      total += res.changed;
      const verb = res.wrote ? 'rewrote' : (res.dryRun ? 'would rewrite' : 'clean');
      log('[' + row.slug + '] #' + row.stateIssue + ': ' + verb + ' ' + res.changed + ' bare cross-repo #N');
    } catch (e) {
      error('[' + row.slug + '] #' + row.stateIssue + ': FAILED (' + e.message + ')');
      failures++;
    }
  }
  log((dryRun ? 'DRY RUN — ' : '') + 'total bare cross-repo refs ' + (dryRun ? 'that would be ' : '') + 'rewritten: ' + total);
  return failures > 0 ? 2 : 0;
}

module.exports = { REPOS, DOTFILES, CONTEXT_WINDOW, rewrite, repair, knownNumbers, contextFor, defaultRunGh, isUnreadableRepo, main };

if (require.main === module) process.exit(main(process.argv.slice(2)));
