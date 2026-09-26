#!/usr/bin/env node
// Merges the committed profile settings.json into the live one on pull, keeping caveman's own
// wiring (issue 826).
//
// WHY: profile/claude/settings.json no longer carries caveman's hook entries or its model route -
// those name one machine's install paths (an nvm Node 24.18.0 adapter from the owner's other PC
// reached a machine with neither nvm nor the caveman CLI). Only `caveman enable claude` on the
// machine writes them. So a pull must not overwrite them either: copying the slimmer profile over
// a live file would unhook a working proxy.
//
//   - every key comes from the committed file, exactly as before (permissions, statusLine, the
//     other env keys, the other hooks),
//   - then the live file's caveman-owned parts are carried over unchanged: each hook naming a
//     caveman binary (its group kept whole when every hook in it is caveman's), and the model
//     route - ANTHROPIC_BASE_URL at the proxy port, with _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL.
//
// Usage: node tools/settings-caveman-merge.js <committed.json> <live.json>
//   Writes the merge to <live.json>. A live file that is missing or does not parse is replaced by
//   the committed one (sync.ps1 has already backed it up). Exit 2 when the committed file does not
//   parse: the caller leaves the live file alone.
'use strict';

const fs = require('fs');

// The same pattern tools/caveman-desktop-install.ps1 strips by.
const CAVEMAN_HOOK = /caveman-proxy|caveman\.cmd|shrink-hook|@caveman-ai/i;
const CAVEMAN_ROUTE = /127\.0\.0\.1:8787/;
const ROUTE_KEY = 'ANTHROPIC_BASE_URL';
const FIRST_PARTY_KEY = '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL';

const isCavemanHook = (hook) => !!hook && typeof hook.command === 'string' && CAVEMAN_HOOK.test(hook.command);

// The live groups (or the caveman part of a mixed group) caveman owns, per hook event.
function cavemanGroups(live) {
  const out = {};
  const hooks = live && live.hooks && typeof live.hooks === 'object' ? live.hooks : {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const list = group && Array.isArray(group.hooks) ? group.hooks : [];
      const own = list.filter(isCavemanHook);
      if (own.length === 0) continue;
      (out[event] = out[event] || []).push(own.length === list.length ? group : Object.assign({}, group, { hooks: own }));
    }
  }
  return out;
}

function mergeSettings(committed, live) {
  const out = JSON.parse(JSON.stringify(committed));
  const liveEnv = live && live.env && typeof live.env === 'object' ? live.env : {};
  if (typeof liveEnv[ROUTE_KEY] === 'string' && CAVEMAN_ROUTE.test(liveEnv[ROUTE_KEY])) {
    out.env = out.env || {};
    out.env[ROUTE_KEY] = liveEnv[ROUTE_KEY];
    if (FIRST_PARTY_KEY in liveEnv) out.env[FIRST_PARTY_KEY] = liveEnv[FIRST_PARTY_KEY];
  }
  const carried = cavemanGroups(live);
  if (Object.keys(carried).length > 0) {
    out.hooks = out.hooks || {};
    for (const [event, groups] of Object.entries(carried)) {
      const kept = (out.hooks[event] || []).filter(
        (g) => !(g && Array.isArray(g.hooks) && g.hooks.some(isCavemanHook)));
      out.hooks[event] = kept.concat(groups);
    }
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function main(argv) {
  const [committedPath, livePath] = argv;
  if (!committedPath || !livePath) {
    console.error('usage: settings-caveman-merge.js <committed.json> <live.json>');
    return 2;
  }
  let committed;
  try { committed = readJson(committedPath); } catch (e) {
    console.error(`committed ${committedPath} does not parse (${e.message}); live file left alone`);
    return 2;
  }
  let live = null;
  try { live = readJson(livePath); } catch (e) { live = null; }
  const merged = live === null ? committed : mergeSettings(committed, live);
  fs.writeFileSync(livePath, JSON.stringify(merged, null, 2) + '\n');
  console.log(live === null ? 'merged: no live settings, committed copy written'
                            : 'merged: caveman hooks and route kept from the live settings');
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { mergeSettings, cavemanGroups, main };
