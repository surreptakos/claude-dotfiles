#!/usr/bin/env node
/**
 * resolve-rules.js - the deterministic half of code-review step 3 (issue 625).
 *
 * Usage (from the reviewed repo's root):
 *   node resolve-rules.js <fixed-point>          changed files from `git diff --name-only <fp>...HEAD`
 *   node resolve-rules.js --files <path>...      an explicit file list instead of git
 *   node resolve-rules.js ... --rules <file>     a rule file other than .code-review/rules.json
 *
 * The rule file is optional. Node built-ins only - the skill stays dependency-free.
 *
 * Rule file shape (.code-review/rules.json):
 *   {
 *     "ignore": ["dist/**", "**\/*.lock"],
 *     "rules": [
 *       { "paths": ["src/**\/*.ts"], "exclude": ["**\/*.test.ts"],
 *         "standards": ["docs/ts-style.md"], "rules": ["No default exports."] }
 *     ]
 *   }
 * Globs match the whole repo-relative path: `*` and `?` stay inside one segment, `**` spans any
 * number of segments (`**\/` may match none). A changed file takes every rule whose `paths` match
 * and whose `exclude` does not, in file order; `ignore` drops it from review altogether.
 *
 * Output: JSON on stdout -
 *   { ruleFile, files: [{ path, standards, rules }], unmatched, ignored, missingStandards }
 * `ruleFile` is null when none exists; every file then lands in `unmatched`.
 *
 * Exit codes: 0 resolved (with or without a rule file); 2 the rule file is not valid JSON or not
 * the shape above, or git could not list the diff.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_RULE_FILE = path.join('.code-review', 'rules.json');

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(file, globs) {
  return (globs || []).some((g) => globToRegExp(g).test(file));
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((s) => typeof s === 'string');
}

// Throws on a malformed config; the CLI turns that into exit 2.
function validate(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('rule file must be a JSON object');
  if (config.ignore !== undefined && !isStringArray(config.ignore)) throw new Error('"ignore" must be an array of globs');
  if (!Array.isArray(config.rules)) throw new Error('"rules" must be an array');
  config.rules.forEach((r, i) => {
    if (!r || typeof r !== 'object') throw new Error(`rules[${i}] must be an object`);
    if (!isStringArray(r.paths) || r.paths.length === 0) throw new Error(`rules[${i}].paths must be a non-empty array of globs`);
    for (const k of ['exclude', 'standards', 'rules']) {
      if (r[k] !== undefined && !isStringArray(r[k])) throw new Error(`rules[${i}].${k} must be an array of strings`);
    }
  });
}

function pushUnique(list, items) {
  for (const it of items || []) if (!list.includes(it)) list.push(it);
}

// Pure resolution: config (or null) + changed files -> per-file standards. `root` only serves the
// existence check on named standards files.
function resolveRules(config, changedFiles, root = '.') {
  const out = { files: [], unmatched: [], ignored: [], missingStandards: [] };
  const files = changedFiles.map((f) => f.replace(/\\/g, '/'));
  if (!config) { out.unmatched = files; return out; }
  validate(config);
  for (const file of files) {
    if (matchesAny(file, config.ignore)) { out.ignored.push(file); continue; }
    const entry = { path: file, standards: [], rules: [] };
    for (const r of config.rules) {
      if (!matchesAny(file, r.paths) || matchesAny(file, r.exclude)) continue;
      pushUnique(entry.standards, r.standards);
      pushUnique(entry.rules, r.rules);
    }
    if (entry.standards.length || entry.rules.length) out.files.push(entry);
    else out.unmatched.push(file);
  }
  for (const e of out.files) {
    for (const s of e.standards) {
      if (!out.missingStandards.includes(s) && !fs.existsSync(path.join(root, s))) out.missingStandards.push(s);
    }
  }
  return out;
}

function loadRuleFile(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main(argv) {
  let ruleFile = DEFAULT_RULE_FILE;
  let files = null;
  let fixedPoint = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rules') ruleFile = argv[++i];
    else if (argv[i] === '--files') { files = argv.slice(i + 1); break; }
    else fixedPoint = argv[i];
  }
  try {
    if (!files) {
      if (!fixedPoint) throw new Error('usage: resolve-rules.js <fixed-point> | --files <path>...');
      files = execFileSync('git', ['diff', '--name-only', `${fixedPoint}...HEAD`], { encoding: 'utf8' })
        .split('\n').filter(Boolean);
    }
    const config = loadRuleFile(ruleFile);
    const result = resolveRules(config, files, '.');
    process.stdout.write(`${JSON.stringify({ ruleFile: config ? ruleFile.replace(/\\/g, '/') : null, ...result }, null, 2)}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`resolve-rules: ${err.message}\n`);
    return 2;
  }
}

module.exports = { resolveRules, globToRegExp, validate };

if (require.main === module) process.exit(main(process.argv.slice(2)));
