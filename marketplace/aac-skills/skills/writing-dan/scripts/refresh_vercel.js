#!/usr/bin/env node
// Refresh the Vercel writing-guidelines cache.
//
// Poll GitHub for the latest commit that touched each file, compare against the
// SHA manifest, download only when the SHA moved, print a diff summary.
//
// Offline / no gh / rate-limited: exit 0 without touching cache. The skill's
// derived files stay authoritative from the last known good copy.
//
// Usage: node scripts/refresh_vercel.js [--force] [--verbose]
//
// --force: re-download even when the SHA matches. Use after a manual edit to
//   the cache you want to overwrite.
// --verbose: print each API call and the file byte counts.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const https = require('https');

const REPO = 'vercel-labs/writing-guidelines';
const FILES = ['command.md', 'AGENTS.md'];

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');
const VERBOSE = args.has('--verbose');

const CACHE_DIR = path.resolve(__dirname, '..', 'references', 'vercel-cache');
const MANIFEST = path.join(CACHE_DIR, 'sha.txt');

function log(msg) {
  if (VERBOSE) console.error(`[refresh_vercel] ${msg}`);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST)) return {};
  const out = {};
  for (const line of fs.readFileSync(MANIFEST, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)(?:\s+(\S+))?/);
    if (m) out[m[1]] = { sha: m[2], date: m[3] || '' };
  }
  return out;
}

function writeManifest(map) {
  const lines = FILES.map((f) => {
    const e = map[f];
    if (!e) return null;
    return `${f} ${e.sha} ${e.date || ''}`.trimEnd();
  }).filter(Boolean);
  fs.writeFileSync(MANIFEST, lines.join('\n') + '\n');
}

function tryGh(argv) {
  try {
    return execFileSync('gh', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    log(`gh failed: ${e.message.split('\n')[0]}`);
    return null;
  }
}

function fetchHttps(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'writing-skill-refresh' } }, (res) => {
      if (res.statusCode !== 200) {
        log(`https ${url} -> ${res.statusCode}`);
        res.resume();
        resolve(null);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.on('error', (e) => { log(`https error: ${e.message}`); resolve(null); });
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function latestCommit(file) {
  const ghOut = tryGh(['api', `repos/${REPO}/commits?path=${encodeURIComponent(file)}&per_page=1`,
                       '--jq', '.[0] | {sha:.sha, date:.commit.author.date}']);
  if (ghOut) {
    try {
      const j = JSON.parse(ghOut);
      if (j && j.sha) return { sha: j.sha, date: j.date || '' };
    } catch (_) { /* fall through */ }
  }
  const body = await fetchHttps(`https://api.github.com/repos/${REPO}/commits?path=${encodeURIComponent(file)}&per_page=1`);
  if (!body) return null;
  try {
    const j = JSON.parse(body);
    if (Array.isArray(j) && j[0] && j[0].sha) {
      return { sha: j[0].sha, date: j[0].commit && j[0].commit.author && j[0].commit.author.date || '' };
    }
  } catch (_) { /* ignore */ }
  return null;
}

async function fetchFile(file) {
  const ghOut = tryGh(['api', `repos/${REPO}/contents/${file}`, '-H', 'Accept: application/vnd.github.raw']);
  if (ghOut && ghOut.length > 0) return ghOut;
  const body = await fetchHttps(`https://raw.githubusercontent.com/${REPO}/main/${file}`);
  return body;
}

async function main() {
  if (!fs.existsSync(CACHE_DIR)) {
    console.error(`refresh_vercel: cache dir missing: ${CACHE_DIR}`);
    process.exit(0);
  }
  const manifest = readManifest();
  const next = { ...manifest };
  const report = [];
  let anyNetworkOk = false;

  for (const file of FILES) {
    const latest = await latestCommit(file);
    if (!latest) {
      report.push(`${file}: offline (kept ${manifest[file] ? manifest[file].sha.slice(0, 7) : 'unknown'})`);
      continue;
    }
    anyNetworkOk = true;
    const cachedSha = manifest[file] && manifest[file].sha;
    if (!FORCE && cachedSha === latest.sha) {
      report.push(`${file}: up to date (${latest.sha.slice(0, 7)})`);
      continue;
    }
    const body = await fetchFile(file);
    if (!body) {
      report.push(`${file}: SHA moved to ${latest.sha.slice(0, 7)} but download failed; kept ${cachedSha ? cachedSha.slice(0, 7) : 'unknown'}`);
      continue;
    }
    const target = path.join(CACHE_DIR, file);
    const prevBytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
    fs.writeFileSync(target, body);
    const newBytes = Buffer.byteLength(body, 'utf8');
    next[file] = latest;
    report.push(`${file}: ${cachedSha ? cachedSha.slice(0, 7) : 'new'} -> ${latest.sha.slice(0, 7)} (${prevBytes} -> ${newBytes} bytes)`);
  }

  if (anyNetworkOk) writeManifest(next);

  console.log(report.join('\n'));
  process.exit(0);
}

main().catch((e) => {
  console.error(`refresh_vercel: unexpected error, cache untouched: ${e.message}`);
  process.exit(0);
});
