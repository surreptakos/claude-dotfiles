#!/usr/bin/env node
// project-harness step 16: make <repo>/.claude/settings.json declare the aac-skills plugin so a
// cloud session (claude.ai/code) installs it at startup. MERGES the two keys into whatever the
// file already holds (permissions, hooks, ...) and leaves everything else byte-for-byte; creates
// the file when absent. Idempotent: a second run changes nothing.
//
//   node add-cloud-plugin.js <repo-root>
//
// Why project settings and not the account or the environment: see templates/claude-settings.json.
'use strict';
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
if (!root) { console.error('usage: node add-cloud-plugin.js <repo-root>'); process.exit(2); }
const file = path.join(root, '.claude', 'settings.json');

const MARKETPLACE = 'claude-dotfiles';
const SOURCE = { source: 'github', repo: 'surreptakos/claude-dotfiles' };
const PLUGIN = 'aac-skills@claude-dotfiles';

let settings = {};
if (fs.existsSync(file)) {
  settings = JSON.parse(fs.readFileSync(file, 'utf8')); // throws on a broken file: never overwrite one
}
const before = JSON.stringify(settings);

settings.extraKnownMarketplaces = Object.assign({}, settings.extraKnownMarketplaces);
settings.extraKnownMarketplaces[MARKETPLACE] = Object.assign(
  {}, settings.extraKnownMarketplaces[MARKETPLACE], { source: SOURCE });
settings.enabledPlugins = Object.assign({}, settings.enabledPlugins, { [PLUGIN]: true });

if (JSON.stringify(settings) === before) { console.log('already declared:', file); process.exit(0); }
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
console.log('declared', PLUGIN, 'in', file);
