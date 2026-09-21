'use strict';

/**
 * The mechanical half of `check.js --end` (issue 622).
 *
 * Every other gate in this flow is judgment an agent can talk past, and the stop-slop gate proved
 * what that costs: it sat dead for weeks — named by nothing, its linter module absent — and no
 * review noticed, because no check ran that could fail. These three can fail, and nothing in them
 * reads prose to decide:
 *
 *   1. skill stamps   `tools/skill-stamps.py check aac-skills` — its non-zero exit is the gate's
 *                     failure, verbatim. A skill edited without a re-stamp never reaches CI green.
 *   2. secret guard   the files this branch touched, against the SAME pattern list
 *                     `Assert-NoSecrets` uses — parsed out of `lib/manifest.ps1` rather than
 *                     restated here, so the two cannot drift apart.
 *   3. hook scripts   every hook command in `profile/claude/settings.json` that names a script
 *                     this repo carries: the file exists, and a Python one imports cleanly.
 *
 * Each check is gated on the file it reads, so a repo without these paths gets nothing — check.js
 * is the engine for every repo, not this one.
 *
 * This module is the pure half: parsing, resolving, classifying. Spawning processes and asking git
 * what moved stay in check.js, where those already live.
 *
 * Exports:
 *   parseSecretPatterns(text)              -> { patterns: [string] } | { error }
 *   compileSecretPatterns(strings)         -> { compiled: [{source, re}], uncompilable: [...] }
 *   secretHits(files, compiled, readFile)  -> [{ file, pattern }]
 *   hookCommands(settings)                 -> [{ event, command }]
 *   scriptPathsIn(command)                 -> [string]
 *   resolveHookScript(raw)                 -> { kind: 'repo', rel, raw } | { kind: 'external', raw }
 *   hookScriptTargets(settings)            -> { carried: [...], external: [...] }
 */

const path = require('node:path');

/* ------------------------------------------------------------- secret patterns --------------- */

/** The `$script:SecretPatterns` array out of `lib/manifest.ps1`'s text. Reading the list rather
 *  than restating it is the point (issue 622): a pattern added to the guard is a pattern this
 *  gate enforces, with no second copy to forget. PowerShell single-quoted strings escape a quote
 *  by doubling it, which is the only unescaping needed — those literals are regex sources, not
 *  strings with backslash escapes. */
function parseSecretPatterns(text) {
  const block = /\$script:SecretPatterns\s*=\s*@\(([\s\S]*?)^\s*\)/m.exec(String(text || ''));
  if (!block) return { error: 'no $script:SecretPatterns = @( ... ) block found' };
  const patterns = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(block[1])) !== null) patterns.push(m[1].replace(/''/g, "'"));
  if (!patterns.length) return { error: 'the $script:SecretPatterns block holds no patterns' };
  return { patterns };
}

/** .NET regex that JavaScript cannot compile is reported, never dropped in silence: a pattern
 *  this gate skipped without saying so is a credential shape nothing checks. */
function compileSecretPatterns(strings) {
  const compiled = [];
  const uncompilable = [];
  for (const source of strings || []) {
    try { compiled.push({ source, re: new RegExp(source) }); }
    catch (e) { uncompilable.push({ source, reason: e.message }); }
  }
  return { compiled, uncompilable };
}

/** Which of `files` hold a credential VALUE. `readFile(file)` returns the text, or null when the
 *  file is gone, unreadable or binary — a deleted path is in every `git diff --name-only` and is
 *  not a finding. */
function secretHits(files, compiled, readFile) {
  const hits = [];
  for (const file of files || []) {
    let text;
    try { text = readFile(file); } catch (e) { text = null; }
    if (text === null || text === undefined) continue;
    for (const p of compiled || []) {
      if (p.re.test(text)) hits.push({ file, pattern: p.source });
    }
  }
  return hits;
}

/* ------------------------------------------------------------- hook scripts ------------------ */

/** Every `command` under a settings file's `hooks`, with the event that dispatches it. */
function hookCommands(settings) {
  const rows = [];
  const hooks = settings && settings.hooks;
  if (!hooks || typeof hooks !== 'object') return rows;
  for (const [event, matchers] of Object.entries(hooks)) {
    for (const matcher of (Array.isArray(matchers) ? matchers : [])) {
      for (const h of ((matcher && Array.isArray(matcher.hooks)) ? matcher.hooks : [])) {
        for (const key of ['command', 'commandWindows']) {
          if (h && typeof h[key] === 'string' && h[key].trim()) rows.push({ event, command: h[key] });
        }
      }
    }
  }
  return rows;
}

const SCRIPT_EXT = /\.(js|cjs|mjs|py|sh|bash|ps1)$/i;

/** The script-looking paths a shell command names. Quoted chunks first, because every path in
 *  this settings file that carries a space is quoted; bare tokens after, for the ones that do
 *  not. A leading PowerShell call operator (`& '...'`) is not part of the path. */
function scriptPathsIn(command) {
  const found = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(command || ''))) !== null) {
    const tok = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
    if (!tok) continue;
    const clean = tok.replace(/^[&(]+/, '').replace(/[),;]+$/, '');
    if (SCRIPT_EXT.test(clean)) found.push(clean);
  }
  return found;
}

/** Directories of `~/.claude` this repo actually carries, and where they live in the tree. The
 *  mapping is `lib/manifest.ps1`'s (`Get-DotfileItems`), narrowed to the ones holding runnable
 *  scripts — a hook naming `~/.claude/plugins/cache/...` names something a marketplace install
 *  wrote, which is not this repo's to verify. Add a directory here when the whitelist gains one
 *  that holds scripts. */
const CARRIED = [{ home: '.claude/hooks/', repo: 'profile/claude/hooks/' }];

/** Where in this tree a hook command's script path lives, or that it points outside it. Handles
 *  every spelling the settings file uses: the `__USERHOME*__` sync tokens, a literal Windows
 *  home, `$HOME`, backslashes and forward ones alike. A path this repo does not carry is
 *  `external` — reported, and never passed off as checked. */
function resolveHookScript(raw) {
  const norm = String(raw || '').replace(/\\/g, '/');
  const lower = norm.toLowerCase();
  for (const c of CARRIED) {
    const i = lower.indexOf(c.home);
    // Anchored: `/.claude/hooks/` or a path starting there, never `mine.claude/hooks/`.
    if (i === 0 || (i > 0 && norm[i - 1] === '/')) {
      return { kind: 'repo', rel: path.posix.join(c.repo, norm.slice(i + c.home.length)), raw };
    }
  }
  return { kind: 'external', raw };
}

/** Both halves of check 3's input: the scripts in this tree to verify, and the commands that
 *  named something outside it. Deduplicated by path, because one script is dispatched from
 *  several events and one finding per script is the useful shape. */
function hookScriptTargets(settings) {
  const carried = new Map();
  const external = [];
  for (const { event, command } of hookCommands(settings)) {
    const paths = scriptPathsIn(command);
    if (!paths.length) { external.push({ event, raw: command, kind: 'no-script-path' }); continue; }
    for (const raw of paths) {
      const r = resolveHookScript(raw);
      if (r.kind !== 'repo') { external.push({ event, raw, kind: 'outside-tree' }); continue; }
      if (!carried.has(r.rel)) carried.set(r.rel, { rel: r.rel, raw, events: [] });
      carried.get(r.rel).events.push(event);
    }
  }
  return { carried: [...carried.values()], external };
}

module.exports = {
  CARRIED,
  compileSecretPatterns,
  hookCommands,
  hookScriptTargets,
  parseSecretPatterns,
  resolveHookScript,
  scriptPathsIn,
  secretHits,
};
