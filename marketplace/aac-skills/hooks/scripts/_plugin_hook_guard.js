// Shared dedup guard for governance hooks that ride in both the plugin payload
// and the live-tree ~/.claude/settings.json (issue 208 criterion 4).
//
// On a PC where the user-settings entries still point at the live-tree copy
// (~/.claude/hooks/<name>.js), the plugin's own hook entry would fire the SAME
// event a second time. This guard makes the plugin copy exit 0 silently when a
// live-tree copy is present -- so the hook fires once, from user-settings --
// while a container that has no live tree runs the plugin copy unimpeded.
//
// Once the paired live-tree/mirror edit ships (sync.ps1 -Mode push after
// removing the user-settings governance entries), the live-tree hooks script
// directory still exists but the settings entries are gone; that is fine, the
// guard only checks the file's presence to decide who owns the run. Set
// PLUGIN_HOOK_GUARD_DISABLE=1 in the env to force the plugin to run anyway
// (useful for local testing).
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function callerFile() {
  // process.argv[1] is the script the harness invoked, which is what we care
  // about (the guard is a require()d dependency, __filename here is the guard).
  const argv1 = process.argv[1];
  if (argv1) {
    try { return fs.realpathSync(argv1); } catch (_) { return path.resolve(argv1); }
  }
  return null;
}

function pluginRootCanonical() {
  const r = process.env.CLAUDE_PLUGIN_ROOT;
  if (!r) return null;
  try { return fs.realpathSync(r); } catch (_) { return path.resolve(r); }
}

function isPluginCopy(caller, pluginRoot) {
  if (!caller || !pluginRoot) return false;
  const rel = path.relative(pluginRoot, caller);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function liveTreeTwinExists(caller) {
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const live = path.join(configDir, 'hooks', path.basename(caller));
  try { return fs.statSync(live).isFile(); }
  catch (_) { return false; }
}

function skipIfLiveTreeWillFire() {
  if (process.env.PLUGIN_HOOK_GUARD_DISABLE === '1') return;
  const pluginRoot = pluginRootCanonical();
  if (!pluginRoot) return; // not a plugin invocation
  const caller = callerFile();
  if (!isPluginCopy(caller, pluginRoot)) return;
  if (!liveTreeTwinExists(caller)) return;
  // Silent exit -- Claude Code treats a 0-exit hook with no stdout as a no-op.
  process.exit(0);
}

module.exports = { skipIfLiveTreeWillFire };
