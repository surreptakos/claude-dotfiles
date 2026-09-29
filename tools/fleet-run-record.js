#!/usr/bin/env node
/**
 * fleet-run-record.js — persist one ticket-fleet run's history before the container takes it
 * (aac-routines issue 269; ported here by issue 1010, so the post-wave step the ticket-fleet
 * skill names finds its tool in this repo too).
 *
 * The orchestrating session runs this ITSELF, from its own shell, the moment the ticket-fleet
 * Workflow returns (aac-skills/ticket-fleet/SKILL.md step 4, orchestrator/RUNBOOK.md). It is
 * deliberately not a sub-agent step: a sub-session composing the record would re-derive the run's
 * history from its own context, which is the hallucination surface the record exists to remove.
 * All this does is read the harness journal the run already wrote and distil it mechanically:
 * labels are parsed, values copied, long strings clipped, secret-shaped substrings redacted.
 *
 * JOURNAL FORMAT (the Workflow tool writes one JSON object per line, under
 * `~/.claude/projects/<project>/<session>/subagents/workflows/wf_<id>/journal.jsonl`):
 *   {"type":"started","key":"v2:<hash>","agentId":"a…","label":"impl:#269.1","phase":"Implement"}
 *   {"type":"result","key":"v2:<hash>","agentId":"a…","result":{…}}
 *   {"type":"failed","key":"v2:<hash>","agentId":""}
 * `result` and `failed` lines carry NO label: they are correlated to their `started` line by
 * `key` (and `agentId` as a fallback).
 *
 * USAGE:
 *   node tools/fleet-run-record.js --latest            # newest wf_* journal of THIS repo's sessions
 *   node tools/fleet-run-record.js <journal.jsonl>
 *   node tools/fleet-run-record.js <…/wf_xxxx/>        # directory containing journal.jsonl
 *
 *   --out-dir <dir>   where the record lands (default: state/fleet-runs, gitignored here)
 *   --run-id <id>     override the run id inferred from the journal's directory name
 *   --digest <path>   also write the Markdown digest (for a tracker comment)
 *   --print           print the Markdown digest on stdout
 *   --stdout          print the JSON record on stdout and write no file
 *
 * `--latest` looks first under the Claude project directories of the current checkout (the one
 * named after the cwd, and the `.claude/worktrees/*` ones beside it), so a desktop that runs
 * fleets for several repos records this repo's newest run, not whichever repo finished last. It
 * falls back to every project, saying so on stderr, only when this checkout has no journal.
 *
 * EXIT CODES (2 is never a pass):
 *   0  record written and its shape validated
 *   1  record written but validation found problems (printed on stderr)
 *   2  could not produce a record at all: no journal found, unreadable, or empty
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCHEMA = 'fleet-run-record/v1';
const DEFAULT_OUT_DIR = path.join('state', 'fleet-runs');

// Per-field clip lengths: decisive lines survive, essays do not.
const LIMITS = { title: 200, branch: 200, evidence: 1200, testTail: 400, failure: 400 };

// ---- secret redaction ----
// Matches credential VALUES and value-carrying assignments, never the bare words: a guard that
// fires on the prose "refresh_token" gets disabled by the first person it inconveniences.
const SECRET_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const SECRET_KEY = '(?:access_token|refresh_token|client_secret|api[_-]?key|password|passwd|secret|[A-Z0-9_]*TOKEN)';
const SECRET_ASSIGNMENTS = [
  new RegExp(`("${SECRET_KEY}"\\s*:\\s*")[^"]{8,}(")`, 'gi'),
  new RegExp(`(\\b${SECRET_KEY}\\s*[=:]\\s*)(?!\\[redacted\\])[^\\s"',;]{8,}`, 'gi'),
];
const REDACTED = '[redacted]';

/** Replace credential values inside one string; the key that names a secret stays readable. */
function redactSecrets(value) {
  let out = String(value);
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  for (const re of SECRET_ASSIGNMENTS) {
    out = out.replace(re, (...m) => (m.length > 4 ? `${m[1]}${REDACTED}${m[2]}` : `${m[1]}${REDACTED}`));
  }
  return out;
}

/** Clip a string to `max`, saying how much was dropped so a truncation is never silent. */
function clip(value, max) {
  const s = redactSecrets(value == null ? '' : String(value)).trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max)} …[+${s.length - max} chars truncated]`;
}

// ---- journal parsing ----

/**
 * Malformed lines are counted, not thrown on: a journal cut off mid-write when the container died
 * is exactly the case this record is for.
 */
function parseJournal(text) {
  const entries = [];
  let malformed = 0;
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') entries.push(parsed);
      else malformed += 1;
    } catch (e) {
      malformed += 1;
    }
  }
  return { entries, malformed };
}

/**
 * `impl:#269.2` → {kind:'impl', ticket:269, attempt:2}; `verify:#269.2-rerun` → the same attempt;
 * `deliver:#269` → attempt null. Any other label keeps its raw text as the kind.
 */
function parseLabel(label) {
  const raw = String(label || '');
  const m = raw.match(/^([a-z-]+):#(\d+)(?:\.(\d+))?(-rerun)?$/i);
  if (!m) return { kind: raw, ticket: null, attempt: null, rerun: false };
  return { kind: m[1], ticket: Number(m[2]), attempt: m[3] ? Number(m[3]) : null, rerun: Boolean(m[4]) };
}

function prNumberFrom(url) {
  const m = String(url || '').match(/\/pull\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Correlate `started` lines with their `result` / `failed` lines, in journal order. */
function agentCalls(entries) {
  const byKey = new Map();
  const byAgent = new Map();
  const calls = [];
  for (const e of entries) {
    if (e.type === 'started') {
      const call = { label: String(e.label || ''), phase: String(e.phase || ''), ...parseLabel(e.label), status: 'no-result', result: null };
      calls.push(call);
      if (e.key) byKey.set(e.key, call);
      if (e.agentId) byAgent.set(e.agentId, call);
    } else if (e.type === 'result' || e.type === 'failed') {
      const call = (e.key && byKey.get(e.key)) || (e.agentId && byAgent.get(e.agentId)) || null;
      if (!call) continue;
      call.status = e.type;
      if (e.type === 'result') call.result = e.result === undefined ? null : e.result;
    }
  }
  return calls;
}

// ---- record construction ----

function hasResult(call) {
  return Boolean(call && call.status === 'result' && call.result && typeof call.result === 'object');
}

function verdictFrom(call) {
  if (!hasResult(call)) {
    return {
      pass: false,
      failures: [call.status === 'failed'
        ? 'verify agent failed: no verdict recorded in the journal'
        : 'verify agent produced no result in the journal'],
      evidence: '',
    };
  }
  const r = call.result;
  const listed = (Array.isArray(r.failures) ? r.failures : []).map((f) => clip(f, LIMITS.failure)).filter(Boolean);
  const pass = r.pass === true;
  // A failure always carries a reason, even when the verifier gave none (issue 191's silence).
  const failures = listed.length ? listed : (pass ? [] : ['verifier returned pass=false with no failures listed']);
  return { pass, failures, evidence: clip(r.evidence, LIMITS.evidence) };
}

/** Build the record from parsed journal entries. No field is inferred from outside the journal. */
function buildRecord({ runId, journalPath, entries, malformed = 0, generatedAt } = {}) {
  const calls = agentCalls(entries || []);
  const tickets = new Map();
  const ticketFor = (n) => {
    if (!tickets.has(n)) {
      tickets.set(n, {
        ticket: n, title: null, attempts: [], branch: null, pr: null, prUrl: null, commentUrl: null,
        merged: null, prState: null, outcome: 'not-attempted', discoveries: 0,
      });
    }
    return tickets.get(n);
  };
  const attemptFor = (ticket, attempt) => {
    const entry = ticketFor(ticket);
    let a = entry.attempts.find((x) => x.attempt === attempt);
    if (!a) {
      a = { attempt, branch: null, committed: false, testExitCode: null, testTail: '', verdict: null };
      entry.attempts.push(a);
    }
    return a;
  };

  // Scout names the wave and carries each ticket's title.
  const scout = calls.find((c) => c.label === 'scout');
  if (hasResult(scout) && Array.isArray(scout.result.tickets)) {
    for (const t of scout.result.tickets) {
      if (Number.isInteger(t && t.number)) ticketFor(t.number).title = clip(t.title, LIMITS.title);
    }
  }

  for (const call of calls) {
    if (call.ticket == null) continue;
    const entry = ticketFor(call.ticket);
    if ((call.kind === 'impl' || call.kind === 'probe') && call.attempt != null) {
      const a = attemptFor(call.ticket, call.attempt);
      if (hasResult(call)) {
        const r = call.result;
        a.branch = r.branch ? clip(r.branch, LIMITS.branch) : null;
        a.committed = r.committed === true;
        a.testExitCode = Number.isInteger(r.testExitCode) ? r.testExitCode : null;
        a.testTail = clip(r.testTail, LIMITS.testTail);
        entry.discoveries += Array.isArray(r.discoveries) ? r.discoveries.length : 0;
        if (a.branch) entry.branch = a.branch;
      } else {
        a.verdict = a.verdict || { pass: false, failures: ['implement agent produced no result in the journal'], evidence: '' };
      }
    } else if (call.kind === 'verify' && call.attempt != null) {
      // A `-rerun` verdict comes later in the journal and supersedes the first pass's.
      attemptFor(call.ticket, call.attempt).verdict = verdictFrom(call);
    } else if (call.kind === 'deliver' && hasResult(call)) {
      const r = call.result;
      if (r.prUrl) { entry.prUrl = clip(r.prUrl, LIMITS.branch); entry.pr = prNumberFrom(r.prUrl); }
      if (r.commentUrl) entry.commentUrl = clip(r.commentUrl, LIMITS.branch);
      if (typeof r.merged === 'boolean') entry.merged = r.merged;
      if (r.prState) entry.prState = clip(r.prState, LIMITS.branch);
    }
  }

  for (const entry of tickets.values()) {
    entry.attempts.sort((a, b) => a.attempt - b.attempt);
    const last = entry.attempts[entry.attempts.length - 1] || null;
    if (entry.pr || entry.prUrl || entry.commentUrl) entry.outcome = 'delivered';
    else if (last && last.verdict && last.verdict.pass) entry.outcome = 'verified-not-delivered';
    else if (entry.attempts.length) entry.outcome = 'failed';
    // Scout lists every eligible ticket; one with no attempt was dropped by a blocker or the cap.
    else entry.outcome = 'not-attempted';
  }

  const ordered = [...tickets.values()].sort((a, b) => a.ticket - b.ticket);
  return {
    schema: SCHEMA,
    runId: String(runId || ''),
    journalPath: String(journalPath || ''),
    generatedAt: generatedAt || new Date().toISOString(),
    tickets: ordered,
    counts: {
      tickets: ordered.length,
      attempts: ordered.reduce((n, t) => n + t.attempts.length, 0),
      delivered: ordered.filter((t) => t.outcome === 'delivered').length,
      merged: ordered.filter((t) => t.merged === true).length,
      failed: ordered.filter((t) => t.outcome === 'failed').length,
      notAttempted: ordered.filter((t) => t.outcome === 'not-attempted').length,
      discoveries: ordered.reduce((n, t) => n + t.discoveries, 0),
      agentCalls: calls.length,
      isolationCheckpoints: calls.filter((c) => c.label.startsWith('tree-guard:')).length,
      malformedJournalLines: malformed,
    },
    agentFailures: calls.filter((c) => c.status !== 'result').map((c) => ({ label: c.label, phase: c.phase, status: c.status })),
  };
}

/** Walk every string in the record and report any that still matches a credential pattern. */
function findSecrets(value, at = '$', found = []) {
  if (typeof value === 'string') {
    if (redactSecrets(value) !== value) found.push(at);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findSecrets(v, `${at}[${i}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findSecrets(v, `${at}.${k}`, found);
  }
  return found;
}

/** Shape check: a list of human-readable problems, empty when the record is usable. */
function validateRecord(record) {
  const problems = [];
  if (!record || typeof record !== 'object') return ['record is not an object'];
  if (record.schema !== SCHEMA) problems.push(`schema must be "${SCHEMA}", got ${JSON.stringify(record.schema)}`);
  if (!record.runId) problems.push('runId is empty - the record cannot be tied to a run');
  if (!record.generatedAt) problems.push('generatedAt is empty');
  if (!Array.isArray(record.tickets)) return problems.concat('tickets must be an array');
  for (const t of record.tickets) {
    const at = `ticket ${t && t.ticket}`;
    if (!Number.isInteger(t.ticket)) problems.push(`${at}: ticket number is not an integer`);
    if (!Array.isArray(t.attempts)) { problems.push(`${at}: attempts must be an array`); continue; }
    for (const a of t.attempts) {
      if (!Number.isInteger(a.attempt)) problems.push(`${at}: attempt number is not an integer`);
      if (a.verdict && !Array.isArray(a.verdict.failures)) problems.push(`${at} attempt ${a.attempt}: verdict.failures must be an array`);
      else if (a.verdict && a.verdict.pass !== true && !a.verdict.failures.length) {
        problems.push(`${at} attempt ${a.attempt}: a failed verdict must carry at least one reason (issue 191)`);
      }
    }
    if (t.outcome === 'delivered' && !t.pr && !t.prUrl && !t.commentUrl) problems.push(`${at}: outcome "delivered" without a PR or comment URL`);
  }
  const secrets = findSecrets(record);
  if (secrets.length) problems.push(`record still carries ${secrets.length} secret-shaped value(s) after redaction`);
  return problems;
}

/** Markdown digest: what gets posted on the tracking issue when `state/` will not survive. */
function renderDigest(record) {
  const c = record.counts;
  const lines = [
    `## ticket-fleet run \`${record.runId}\``,
    '',
    `Record: \`state/fleet-runs/${record.runId}.json\` (schema \`${record.schema}\`, generated ${record.generatedAt}).`,
    `Journal: \`${record.journalPath}\``,
    '',
    `${c.tickets} ticket(s), ${c.attempts} attempt(s), ${c.delivered} delivered (${c.merged} merged), `
      + `${c.failed} failed, ${c.notAttempted} not attempted, ${c.discoveries} discovery string(s).`,
    '',
  ];
  for (const t of record.tickets) {
    const where = t.pr ? `PR #${t.pr}` : (t.prUrl || t.commentUrl || 'no PR');
    const merge = t.merged === true ? ', merged' : (t.prState ? `, ${t.prState}` : '');
    lines.push(`### #${t.ticket}${t.title ? ` - ${t.title}` : ''}`);
    lines.push(`- outcome: **${t.outcome}** (${where}${merge})`);
    for (const a of t.attempts) {
      const v = a.verdict;
      const verdict = !v ? 'no verdict' : (v.pass ? 'pass' : `fail - ${v.failures.join('; ')}`);
      lines.push(`- attempt ${a.attempt}: branch \`${a.branch || 'none'}\`, test exit ${a.testExitCode == null ? 'n/a' : a.testExitCode}, ${verdict}`);
    }
    lines.push('');
  }
  if (record.agentFailures.length) {
    lines.push('### Agent calls with no result');
    for (const f of record.agentFailures) lines.push(`- \`${f.label}\` (${f.phase}): ${f.status}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ---- CLI ----

function parseArgs(argv) {
  const opts = { source: null, outDir: DEFAULT_OUT_DIR, runId: null, digest: null, print: false, stdout: false, latest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--latest') opts.latest = true;
    else if (a === '--print') opts.print = true;
    else if (a === '--stdout') opts.stdout = true;
    else if (a === '--out-dir') opts.outDir = argv[++i];
    else if (a === '--run-id') opts.runId = argv[++i];
    else if (a === '--digest') opts.digest = argv[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else opts.source = a;
  }
  return opts;
}

/** Roots under which the Workflow tool keeps its journals on this machine. */
function journalRoots(env = process.env) {
  const roots = [];
  if (env.CLAUDE_CONFIG_DIR) roots.push(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (home) roots.push(path.join(home, '.claude', 'projects'));
  return [...new Set(roots)].filter((r) => { try { return fs.statSync(r).isDirectory(); } catch (e) { return false; } });
}

/** Claude Code names a project directory after its cwd, every non-alphanumeric turned to '-'. */
function projectKey(dir) {
  return path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
}

/** Every `wf_<id>/journal.jsonl` under `roots`, newest first, with the project directory it is in. */
function findJournals(roots) {
  const found = [];
  const walk = (dir, depth, project) => {
    if (depth > 6) return;
    let names = [];
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of names) {
      if (!ent.isDirectory()) continue;
      const full = path.join(dir, ent.name);
      if (ent.name.startsWith('wf_')) {
        const journal = path.join(full, 'journal.jsonl');
        try { found.push({ journal, project, mtime: fs.statSync(journal).mtimeMs }); } catch (e) { /* no journal here */ }
        continue;
      }
      walk(full, depth + 1, project == null ? ent.name : project);
    }
  };
  for (const root of roots) walk(root, 0, null);
  return found.sort((a, b) => b.mtime - a.mtime);
}

/** Resolve `source` (file, directory, or --latest) to a journal path and the scope it came from. */
function resolveJournal(opts, { cwd = process.cwd(), env = process.env } = {}) {
  if (opts.source) {
    let stat = null;
    try { stat = fs.statSync(opts.source); } catch (e) { throw new Error(`no such journal path: ${opts.source}`); }
    const journal = stat.isDirectory() ? path.join(opts.source, 'journal.jsonl') : opts.source;
    if (!fs.existsSync(journal)) throw new Error(`no journal.jsonl at ${journal}`);
    return { journal, scope: 'explicit' };
  }
  const roots = journalRoots(env);
  const all = findJournals(roots);
  if (!all.length) {
    throw new Error(`no wf_*/journal.jsonl found under ${roots.join(', ') || '(no Claude projects directory)'} - pass the journal path explicitly`);
  }
  const key = projectKey(cwd);
  const own = all.filter((j) => j.project === key || String(j.project).startsWith(`${key}--claude-worktrees-`));
  if (own.length) return { journal: own[0].journal, scope: 'repo' };
  return { journal: all[0].journal, scope: 'machine' };
}

/** `…/wf_8866c2ea-3af/journal.jsonl` → `wf_8866c2ea-3af`. */
function runIdFor(journal) {
  const dir = path.basename(path.dirname(path.resolve(journal)));
  return dir.startsWith('wf_') ? dir : `run-${dir}`;
}

function main(argv, { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), env = process.env } = {}) {
  let opts;
  try { opts = parseArgs(argv); } catch (e) { stderr.write(`${e.message}\n`); return 2; }
  if (!opts.source && !opts.latest) {
    stderr.write('usage: node tools/fleet-run-record.js (--latest | <journal.jsonl | wf_dir>) [--out-dir d] [--run-id id] [--digest f] [--print] [--stdout]\n');
    return 2;
  }

  let resolved;
  try { resolved = resolveJournal(opts, { cwd, env }); } catch (e) { stderr.write(`${e.message}\n`); return 2; }
  const { journal, scope } = resolved;
  if (scope === 'machine') stderr.write(`fleet-run-record: no journal under this checkout's Claude project directory; recording the machine's newest, ${journal}\n`);

  let text;
  try { text = fs.readFileSync(journal, 'utf8'); } catch (e) { stderr.write(`cannot read ${journal}: ${e.message}\n`); return 2; }

  const { entries, malformed } = parseJournal(text);
  if (!entries.length) {
    stderr.write(`${journal} holds no readable journal entries (${malformed} malformed line(s)) - nothing to record\n`);
    return 2;
  }

  const runId = opts.runId || runIdFor(journal);
  const record = buildRecord({ runId, journalPath: journal, entries, malformed });
  const problems = validateRecord(record);
  const json = `${JSON.stringify(record, null, 2)}\n`;

  if (opts.stdout) {
    stdout.write(json);
  } else {
    const outDir = path.resolve(cwd, opts.outDir);
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${runId}.json`);
    fs.writeFileSync(out, json, 'utf8');
    stdout.write(`${path.relative(cwd, out) || out}\n`);
  }
  if (opts.digest) {
    const digest = path.resolve(cwd, opts.digest);
    fs.mkdirSync(path.dirname(digest), { recursive: true });
    fs.writeFileSync(digest, `${renderDigest(record)}\n`, 'utf8');
  }
  if (opts.print) stdout.write(`${renderDigest(record)}\n`);

  if (problems.length) {
    stderr.write(`fleet-run-record: ${problems.length} shape problem(s) in ${runId}:\n`);
    for (const p of problems) stderr.write(`  - ${p}\n`);
    return 1;
  }
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
} else {
  module.exports = {
    SCHEMA, DEFAULT_OUT_DIR, redactSecrets, clip, parseJournal, parseLabel, prNumberFrom, agentCalls,
    buildRecord, validateRecord, findSecrets, renderDigest, parseArgs, journalRoots, projectKey,
    findJournals, resolveJournal, runIdFor, main,
  };
}
