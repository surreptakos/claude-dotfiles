#!/usr/bin/env node
/**
 * claims-audit.js - generic prose-vs-reality tripwire for any repo.
 *
 * Usage:
 *   node claims-audit.js [claimsFile]
 *
 * Reads docs/claims.json from the current working directory (the invoking repo's root) unless
 * an explicit path is given. Node built-ins only, so a `node --test` wrapper in any repo can
 * `require()` or shell out to it with no install step.
 *
 * Exit codes:
 *   0  every claim verified clean.
 *   1  one or more findings; one line per finding on stdout, tab-separated:
 *      "<claimId>\t<docPath>:<lineNo>\t<message>". Includes broken claims: an unknown claim
 *      type, a missing doc, a missing source, or a verifier that threw all emerge here as
 *      per-claim findings so that one broken claim never masks the rest of the audit.
 *   2  configuration error at the audit level - the claims file itself is missing, is not valid
 *      JSON, or is not the array shape the engine expects. This is the ONLY class that halts
 *      before any claim runs. Anything scoped to a single claim (unknown type, missing source
 *      or doc, malformed field) becomes a finding, never an exit-2.
 *
 * The four claim types are declarative: adding a new fact to enforce is a JSON edit, never an
 * engine edit. That is the whole point - a per-repo `docs/claims.json` names doc-and-source
 * bindings, this engine reads them and verifies each. See claims-tripwire.md beside this file for
 * the per-repo wiring recipe.
 *
 * Types:
 *   token-subset          every token in a doc matching `pattern` must also appear in `source`
 *                         (docs must not name tokens no code emits).
 *   symbol-exists         a doc-cited `symbol` must be defined in `source` AND still mentioned
 *                         in the doc - both directions, so the registry itself cannot go stale.
 *   expected-text         a named passage in a doc must equal `expected` verbatim - claims.json
 *                         is the single conscious update point.
 *   command-single-source a command literal captured from bindings in each doc must equal the
 *                         value read from `source` at `sourcePath` (dot-path for JSON files, or
 *                         whole-file content for plain text). Claims bind explicit doc positions
 *                         so dated history and unrelated files stay exempt - never a global grep.
 *
 * Every finding names the offending line by number. Callers grep the output; a diff of failure
 * lines between two runs is what closes the loop.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// -------------------------------------------------------- support

function die(exitCode, message) {
  process.stderr.write(message + '\n');
  process.exit(exitCode);
}

// Read a file for AUDIT-LEVEL work (the claims file, its JSON shape). Exits 2 on failure -
// this is the class of error the engine cannot proceed past because there is nothing to iterate.
// NEVER call this from a verifier; verifiers must degrade to a per-claim finding via readForClaim.
function readAuditFileOrDie(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    die(2, `claims-audit: cannot read ${filePath}: ${err.message}`);
  }
}

function readJsonOrDie(filePath) {
  const raw = readAuditFileOrDie(filePath);
  try {
    return JSON.parse(raw);
  } catch (err) {
    die(2, `claims-audit: ${filePath} is not valid JSON: ${err.message}`);
  }
}

// Read a file on behalf of a CLAIM. Never process.exits - returns { ok, text, error } so the
// verifier can synthesize a finding. This is the reviewer's finding-1 fix: previously verifiers
// read via readFileOrDie(..., 2) and one missing source or doc crashed the whole audit before
// any later claim could evaluate. The contract at the top of file (exit 1, one line per finding)
// requires that every claim survive its own broken cite. See tests/claims-audit.test.js -
// "missing source" / "missing doc" cases for the regression guards.
function readForClaim(filePath) {
  try {
    return { ok: true, text: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { ok: false, error: err };
  }
}

// Extract a nested value from a parsed JSON object using a dot-path. Empty path returns whole obj.
function pluck(obj, dotPath) {
  if (!dotPath) return obj;
  let cur = obj;
  for (const seg of dotPath.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(seg in cur)) {
      return undefined;
    }
    cur = cur[seg];
  }
  return cur;
}

// Read a value from a source file, honoring dot-path for JSON, whole-content for anything else.
// Throws instead of exiting - the caller (a verifier) wraps this in try/catch and appends a
// finding, so a bad source path is contained to its own claim.
function readSourceValue(sourcePath, dotPath) {
  const readResult = readForClaim(sourcePath);
  if (!readResult.ok) {
    throw new Error(`cannot read ${sourcePath}: ${readResult.error.message}`);
  }
  const raw = readResult.text;
  if (sourcePath.toLowerCase().endsWith('.json') && dotPath) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`source ${sourcePath} is not valid JSON: ${err.message}`);
    }
    const val = pluck(parsed, dotPath);
    if (val === undefined) {
      throw new Error(`source ${sourcePath} has no path ${dotPath}`);
    }
    return String(val);
  }
  return raw;
}

// Locate the 1-indexed line number of `needle` in `haystack`; -1 if absent. Uses first occurrence.
function findLine(haystack, needle) {
  const idx = haystack.indexOf(needle);
  if (idx < 0) return -1;
  return haystack.slice(0, idx).split('\n').length;
}

// Compile a regex from a JSON string; treat leading '/pat/flags' as a literal, else pattern-only.
function compileRegex(raw, defaultFlags = 'g') {
  if (typeof raw !== 'string') throw new Error(`regex must be a string, got ${typeof raw}`);
  const literal = raw.match(/^\/(.+)\/([gimsuy]*)$/);
  if (literal) return new RegExp(literal[1], literal[2] || defaultFlags);
  return new RegExp(raw, defaultFlags);
}

// Small helper: for a claim whose read of `docPath` or `sourcePath` failed, produce the finding
// shape every downstream test asserts on (claimId, doc, line, message). Line is -1 because a
// missing file has no line to point at; the message names which path failed and why.
function readFailureFinding(claimId, whichLabel, whichPath, readResult) {
  return {
    claimId,
    doc: whichPath,
    line: -1,
    message: `cannot read ${whichLabel} ${whichPath}: ${readResult.error.message}`,
  };
}

// -------------------------------------------------------- claim verifiers
//
// Contract every verifier honours (enforced by tests/claims-audit.test.js):
//   * Returns an array of Finding objects { claimId, doc, line, message }; [] is a pass.
//   * NEVER calls process.exit and NEVER throws for a condition scoped to this claim - a missing
//     doc, missing source, malformed field, or unknown regex all emerge as findings. The audit
//     driver wraps every call in try/catch as a backstop, but the verifiers own the graceful
//     path so tests can assert on the exact per-claim shape.
//   * A genuine engine bug (a JS TypeError) surfaces via the driver's catch as
//     "verifier threw: <message>", still with claimId set so the reader can locate the entry.

function verifyTokenSubset(claim, ctx) {
  const findings = [];
  const doc = ctx.repoPath(claim.doc);
  const source = ctx.repoPath(claim.source);
  const docRead = readForClaim(doc);
  if (!docRead.ok) {
    findings.push(readFailureFinding(claim.id, 'doc', claim.doc, docRead));
    return findings;
  }
  const sourceRead = readForClaim(source);
  if (!sourceRead.ok) {
    findings.push(readFailureFinding(claim.id, 'source', claim.source, sourceRead));
    return findings;
  }
  const docText = docRead.text;
  const sourceText = sourceRead.text;

  let pattern, sourcePattern;
  try {
    pattern = compileRegex(claim.pattern, 'g');
    sourcePattern = claim.sourcePattern ? compileRegex(claim.sourcePattern, 'g') : null;
  } catch (err) {
    findings.push({
      claimId: claim.id, doc: claim.doc, line: -1,
      message: `invalid regex on claim: ${err.message}`,
    });
    return findings;
  }

  // Collect the set the source proves to exist.
  const sourceTokens = new Set();
  if (sourcePattern) {
    let m;
    while ((m = sourcePattern.exec(sourceText)) !== null) {
      sourceTokens.add(m[1] !== undefined ? m[1] : m[0]);
    }
  }
  // For each token the doc names, either it must appear in sourceTokens (if sourcePattern was
  // given) or as a literal substring of the source (the general case).
  const seen = new Set();
  let m;
  while ((m = pattern.exec(docText)) !== null) {
    const token = m[1] !== undefined ? m[1] : m[0];
    if (seen.has(token)) continue;
    seen.add(token);
    const inSource = sourcePattern ? sourceTokens.has(token) : sourceText.includes(token);
    if (!inSource) {
      const lineNo = findLine(docText, token);
      findings.push({
        claimId: claim.id,
        doc: claim.doc,
        line: lineNo,
        message: `token "${token}" named in ${claim.doc} not found in ${claim.source}`,
      });
    }
  }
  return findings;
}

function verifySymbolExists(claim, ctx) {
  const findings = [];
  const symbol = claim.symbol;
  if (!symbol) {
    findings.push({
      claimId: claim.id, doc: claim.doc, line: -1,
      message: `claim missing required field: symbol`,
    });
    return findings;
  }
  const doc = ctx.repoPath(claim.doc);
  const source = ctx.repoPath(claim.source);
  const docRead = readForClaim(doc);
  if (!docRead.ok) {
    findings.push(readFailureFinding(claim.id, 'doc', claim.doc, docRead));
    return findings;
  }
  const sourceRead = readForClaim(source);
  if (!sourceRead.ok) {
    findings.push(readFailureFinding(claim.id, 'source', claim.source, sourceRead));
    return findings;
  }
  const docText = docRead.text;
  const sourceText = sourceRead.text;

  // Direction 1: doc must still mention the symbol. A registry that quietly drops the cite is
  // exactly the drift this catches.
  if (!docText.includes(symbol)) {
    findings.push({
      claimId: claim.id, doc: claim.doc, line: -1,
      message: `symbol "${symbol}" no longer mentioned in ${claim.doc}`,
    });
  }

  // Direction 2: source must still define it. Default sniffer covers JS/TS-shaped defs; a claim
  // can override with `sourcePattern` for other languages (Python `def NAME`, PowerShell function).
  let defPattern;
  try {
    if (claim.sourcePattern) {
      defPattern = compileRegex(claim.sourcePattern, 'm');
    } else {
      const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      defPattern = new RegExp(
        `(?:^|\\s)(?:function|class|const|let|var)\\s+${esc}\\b|` +
        `(?:^|\\s)${esc}\\s*[:=]\\s*(?:function|\\(|async|\\{)|` +
        `(?:^|\\s)def\\s+${esc}\\b|` +
        `(?:^|\\s)function\\s+${esc}\\b`,
        'm'
      );
    }
  } catch (err) {
    findings.push({
      claimId: claim.id, doc: claim.doc, line: -1,
      message: `invalid sourcePattern on claim: ${err.message}`,
    });
    return findings;
  }
  if (!defPattern.test(sourceText)) {
    const lineNo = findLine(docText, symbol);
    findings.push({
      claimId: claim.id, doc: claim.doc, line: lineNo,
      message: `symbol "${symbol}" cited by ${claim.doc} but no definition found in ${claim.source}`,
    });
  }
  return findings;
}

function verifyExpectedText(claim, ctx) {
  const findings = [];
  const expected = claim.expected;
  if (typeof expected !== 'string') {
    findings.push({
      claimId: claim.id, doc: claim.doc, line: -1,
      message: `claim missing required string field: expected`,
    });
    return findings;
  }
  const doc = ctx.repoPath(claim.doc);
  const docRead = readForClaim(doc);
  if (!docRead.ok) {
    findings.push(readFailureFinding(claim.id, 'doc', claim.doc, docRead));
    return findings;
  }
  const docText = docRead.text;
  if (!docText.includes(expected)) {
    // Best-effort locate: point at line 1 - the passage does not exist, so no anchor is honest.
    // The message quotes the expected text verbatim so a reader can grep the doc.
    const preview = expected.length > 80 ? expected.slice(0, 77) + '...' : expected;
    findings.push({
      claimId: claim.id, doc: claim.doc, line: 1,
      message: `expected passage not found: "${preview.replace(/\n/g, '\\n')}"`,
    });
  }
  return findings;
}

function verifyCommandSingleSource(claim, ctx) {
  const findings = [];
  const source = ctx.repoPath(claim.source);
  let sourceValue;
  try {
    sourceValue = readSourceValue(source, claim.sourcePath || '');
  } catch (err) {
    findings.push({
      claimId: claim.id, doc: claim.source, line: -1,
      message: err.message,
    });
    return findings;
  }
  const expected = String(sourceValue).trim();

  const bindings = Array.isArray(claim.bindings) ? claim.bindings : [];
  if (bindings.length === 0) {
    findings.push({
      claimId: claim.id, doc: '(claims.json)', line: -1,
      message: `claim missing required field: bindings (at least one { doc, occurrence } entry)`,
    });
    return findings;
  }

  for (const b of bindings) {
    const doc = ctx.repoPath(b.doc);
    const docRead = readForClaim(doc);
    if (!docRead.ok) {
      findings.push(readFailureFinding(claim.id, 'doc', b.doc, docRead));
      continue;
    }
    const docText = docRead.text;
    // The binding declares an `occurrence` string that must appear verbatim in the doc. The
    // engine extracts the command literal from that string using `extract` (defaults to the
    // Markdown backtick pattern) and asserts equality with the source value. This is the
    // "explicit doc list" rule: the claim points at exact positions rather than scanning.
    const occurrence = b.occurrence || b.line;
    if (typeof occurrence !== 'string') {
      findings.push({
        claimId: claim.id, doc: b.doc, line: -1,
        message: `binding missing required string field: occurrence`,
      });
      continue;
    }
    if (!docText.includes(occurrence)) {
      findings.push({
        claimId: claim.id, doc: b.doc, line: -1,
        message: `bound occurrence not found in ${b.doc}: "${occurrence}"`,
      });
      continue;
    }
    let extractPattern;
    try {
      extractPattern = compileRegex(b.extract || '`([^`]+)`', '');
    } catch (err) {
      findings.push({
        claimId: claim.id, doc: b.doc, line: -1,
        message: `invalid extract regex on binding: ${err.message}`,
      });
      continue;
    }
    const match = occurrence.match(extractPattern);
    if (!match) {
      const lineNo = findLine(docText, occurrence);
      findings.push({
        claimId: claim.id, doc: b.doc, line: lineNo,
        message: `extract pattern ${extractPattern} matched nothing in "${occurrence}"`,
      });
      continue;
    }
    const extracted = (match[1] !== undefined ? match[1] : match[0]).trim();
    if (extracted !== expected) {
      const lineNo = findLine(docText, occurrence);
      findings.push({
        claimId: claim.id, doc: b.doc, line: lineNo,
        message: `command "${extracted}" in ${b.doc} does not match ${claim.source}${claim.sourcePath ? ' at ' + claim.sourcePath : ''}: "${expected}"`,
      });
    }
  }
  return findings;
}

const VERIFIERS = {
  'token-subset': verifyTokenSubset,
  'symbol-exists': verifySymbolExists,
  'expected-text': verifyExpectedText,
  'command-single-source': verifyCommandSingleSource,
};

// -------------------------------------------------------- driver

function auditClaims(claimsFilePath, repoRoot) {
  const parsed = readJsonOrDie(claimsFilePath);
  const claims = Array.isArray(parsed) ? parsed : parsed.claims;
  if (!Array.isArray(claims)) {
    die(2, `claims-audit: ${claimsFilePath} must be an array or {claims: [...]}`);
  }
  const ctx = {
    repoRoot,
    repoPath(rel) {
      if (!rel) return rel;
      if (path.isAbsolute(rel)) return rel;
      return path.join(repoRoot, rel);
    },
  };
  const allFindings = [];
  const ids = new Set();
  claims.forEach((claim, idx) => {
    if (!claim || typeof claim !== 'object') {
      allFindings.push({
        claimId: `claim[${idx}]`, doc: claimsFilePath, line: -1,
        message: `claim entry is not an object`,
      });
      return;
    }
    const id = claim.id || `claim[${idx}]`;
    if (ids.has(id)) {
      allFindings.push({
        claimId: id, doc: claimsFilePath, line: -1,
        message: `duplicate claim id`,
      });
    }
    ids.add(id);
    const verifier = VERIFIERS[claim.type];
    if (!verifier) {
      allFindings.push({
        claimId: id, doc: claim.doc || claimsFilePath, line: -1,
        message: `unknown claim type: ${claim.type} (known: ${Object.keys(VERIFIERS).join(', ')})`,
      });
      return;
    }
    let findings;
    try {
      findings = verifier(claim, ctx);
    } catch (err) {
      // Backstop only. Verifiers own their graceful path; if control reaches here, it is an
      // engine bug and the reader wants to know which claim tripped it.
      allFindings.push({
        claimId: id, doc: claim.doc || claimsFilePath, line: -1,
        message: `verifier threw: ${err.message}`,
      });
      return;
    }
    for (const f of findings) allFindings.push({ ...f, claimId: id });
  });
  return { claims, findings: allFindings };
}

function formatFinding(f) {
  return `${f.claimId}\t${f.doc}:${f.line}\t${f.message}`;
}

// -------------------------------------------------------- CLI

function main(argv) {
  const arg = argv[2];
  const repoRoot = process.cwd();
  const claimsFilePath = arg
    ? (path.isAbsolute(arg) ? arg : path.join(repoRoot, arg))
    : path.join(repoRoot, 'docs', 'claims.json');
  if (!fs.existsSync(claimsFilePath)) {
    die(2, `claims-audit: no claims file at ${claimsFilePath}`);
  }
  const { claims, findings } = auditClaims(claimsFilePath, repoRoot);
  if (findings.length === 0) {
    process.stdout.write(`claims-audit: ${claims.length} claim(s) verified clean\n`);
    process.exit(0);
  }
  for (const f of findings) process.stdout.write(formatFinding(f) + '\n');
  process.stdout.write(`claims-audit: ${findings.length} finding(s) across ${claims.length} claim(s)\n`);
  process.exit(1);
}

// Exported for the test suite; the CLI path only fires when invoked directly.
module.exports = {
  auditClaims,
  formatFinding,
  verifyTokenSubset,
  verifySymbolExists,
  verifyExpectedText,
  verifyCommandSingleSource,
};

if (require.main === module) main(process.argv);
