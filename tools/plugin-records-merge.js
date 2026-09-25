#!/usr/bin/env node
// Merges the committed plugin records into the live ones on pull, never lowering a live
// install (issue 717).
//
// WHY: `~/.claude/plugins/installed_plugins.json` and `known_marketplaces.json` are Claude Code's
// own state. A `claude plugin update` rewrites them; the committed copies under
// profile/claude/plugins/ are a snapshot. Copying the snapshot over the live file on every pull
// rolled each update back to the snapshot's version. The committed copies stay in the whitelist
// because a fresh machine needs them (they register the marketplaces and name what to install),
// so pull merges instead:
//
//   - an entry only one side has is kept (a fresh machine gets every committed entry; a plugin
//     installed only here survives),
//   - an entry both sides have keeps the side with the later `lastUpdated`, the live one on a tie.
//
// An installed_plugins.json entry is identified by plugin key + scope + projectPath; a
// known_marketplaces.json entry by its marketplace name.
//
// Usage: node tools/plugin-records-merge.js <installed|marketplaces|settings> <committed.json> <live.json>
//   Writes the merge to <live.json>. A live file that is missing or does not parse is replaced by
//   the committed one (sync.ps1 has already backed it up). Exit 2 when the committed file does not
//   parse: the caller leaves the live file alone.
'use strict';

const fs = require('fs');

function stamp(entry) {
  const t = entry && typeof entry === 'object' ? Date.parse(entry.lastUpdated) : NaN;
  return Number.isNaN(t) ? -Infinity : t;
}

// The later of two records for one identity; live wins a tie so an unchanged file stays put.
function newer(live, committed) {
  return stamp(committed) > stamp(live) ? committed : live;
}

function entryId(entry) {
  return `${entry && entry.scope}|${(entry && entry.projectPath) || ''}`;
}

function mergeInstalled(committed, live) {
  const out = Object.assign({}, committed, live);
  const livePlugins = (live && live.plugins) || {};
  const committedPlugins = (committed && committed.plugins) || {};
  out.plugins = {};
  for (const key of new Set([...Object.keys(livePlugins), ...Object.keys(committedPlugins)])) {
    const liveList = Array.isArray(livePlugins[key]) ? livePlugins[key] : [];
    const committedList = Array.isArray(committedPlugins[key]) ? committedPlugins[key] : [];
    const merged = liveList.slice();
    for (const entry of committedList) {
      const at = merged.findIndex((e) => entryId(e) === entryId(entry));
      if (at === -1) merged.push(entry);
      else merged[at] = newer(merged[at], entry);
    }
    out.plugins[key] = merged;
  }
  return out;
}

function mergeMarketplaces(committed, live) {
  const out = Object.assign({}, live || {});
  for (const [name, entry] of Object.entries(committed || {})) {
    out[name] = name in out ? newer(out[name], entry) : entry;
  }
  return out;
}

// settings.json (issue 825): `caveman enable claude` is the only writer of the caveman model
// route and its proxy/shrink-hook entries, on the machine that runs the proxy. The committed
// profile carries neither any more, so a plain copy on pull would wipe out a working proxy's own
// entries every time. Keep the committed file as the base (so a real settings.json change in the
// repo still lands) and carry over only what is caveman-owned from the live file: the two env
// keys, and any hook group whose command names the proxy's native-hook or the shrink-hook rewrite.
// De-duped by exact command text so a repeated pull never re-appends the same live group.
const CAVEMAN_ENV_KEYS = ['ANTHROPIC_BASE_URL', '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL'];
const isCavemanCommand = (cmd) => typeof cmd === 'string' && /caveman-proxy|shrink-hook/.test(cmd);

function mergeSettings(committed, live) {
  const out = Object.assign({}, committed || {});

  const liveEnv = (live && live.env) || {};
  const outEnv = Object.assign({}, out.env || {});
  for (const key of CAVEMAN_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(liveEnv, key)) outEnv[key] = liveEnv[key];
  }
  if (Object.keys(outEnv).length > 0) out.env = outEnv;

  const liveHooks = (live && live.hooks) || {};
  const outHooks = Object.assign({}, out.hooks || {});
  for (const [eventName, groups] of Object.entries(liveHooks)) {
    const cavemanGroups = (Array.isArray(groups) ? groups : []).filter((g) =>
      Array.isArray(g && g.hooks) && g.hooks.some((h) => isCavemanCommand(h && h.command)));
    if (cavemanGroups.length === 0) continue;
    const existing = Array.isArray(outHooks[eventName]) ? outHooks[eventName] : [];
    const seen = new Set(existing.flatMap((g) => (g.hooks || []).map((h) => h.command)));
    const toAdd = cavemanGroups.filter((g) => !g.hooks.every((h) => seen.has(h.command)));
    outHooks[eventName] = existing.concat(toAdd);
  }
  if (Object.keys(outHooks).length > 0) out.hooks = outHooks;
  return out;
}

const MERGERS = { installed: mergeInstalled, marketplaces: mergeMarketplaces, settings: mergeSettings };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function main(argv) {
  const [kind, committedPath, livePath] = argv;
  if (!MERGERS[kind] || !committedPath || !livePath) {
    console.error('usage: plugin-records-merge.js <installed|marketplaces|settings> <committed.json> <live.json>');
    return 2;
  }
  let committed;
  try { committed = readJson(committedPath); } catch (e) {
    console.error(`committed ${committedPath} does not parse (${e.message}); live file left alone`);
    return 2;
  }
  let live = null;
  try { live = readJson(livePath); } catch (e) { live = null; }
  const merged = live === null ? committed : MERGERS[kind](committed, live);
  fs.writeFileSync(livePath, JSON.stringify(merged, null, 2));
  console.log(live === null ? 'merged: no live record, committed copy written'
                            : 'merged: newer live entries kept');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { mergeInstalled, mergeMarketplaces, mergeSettings, main };
