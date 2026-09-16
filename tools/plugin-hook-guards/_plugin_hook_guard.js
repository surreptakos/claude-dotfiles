// Shared dedup guard for governance hooks that ride in both the plugin payload
// and the live-tree ~/.claude/settings.json (issue 208 criterion 4).
//
// On a PC where the user-settings entries still point at the live-tree copy
// (~/.claude/hooks/<name>.js), the plugin's own hook entry would fire the SAME
// event a second time. This guard makes the plugin copy exit 0 silently when
// user settings still dispatch this script -- so the hook fires once, from
// user-settings -- while a container that has no such entry runs the plugin
// copy unimpeded.
//
// The test is "does settings.json name this script", NOT "does the live file
// exist": the live-tree files stay after the paired edit lands (they are the
// packager's source for this very payload and the restore test executes them),
// so a presence check would keep skipping forever and the hook would fire zero
// times. Once the settings entries are gone, the guard finds nothing and the
// plugin copy runs. Set PLUGIN_HOOK_GUARD_DISABLE=1 in the env to force the
// plugin to run anyway (useful for local testing).
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

function userSettingsDispatch(caller) {
  // True when ~/.claude/settings.json (or CLAUDE_CONFIG_DIR/settings.json) carries a hook
  // command that names this script's basename. Plugin-root commands never appear there, so a
  // match is the live-tree entry and the live copy is the one that fires.
  const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const name = path.basename(caller);
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8')); }
  catch (_) { return false; }
  const events = settings && settings.hooks;
  if (!events || typeof events !== 'object') return false;
  for (const groups of Object.values(events)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      const hooks = group && Array.isArray(group.hooks) ? group.hooks : [];
      for (const hook of hooks) {
        for (const key of ['command', 'commandWindows']) {
          const cmd = hook && hook[key];
          if (typeof cmd === 'string' && cmd.includes(name)) return true;
        }
      }
    }
  }
  return false;
}

function skipIfLiveTreeWillFire() {
  if (process.env.PLUGIN_HOOK_GUARD_DISABLE === '1') return;
  const pluginRoot = pluginRootCanonical();
  if (!pluginRoot) return; // not a plugin invocation
  const caller = callerFile();
  if (!isPluginCopy(caller, pluginRoot)) return;
  if (!userSettingsDispatch(caller)) return;
  // Silent exit -- Claude Code treats a 0-exit hook with no stdout as a no-op.
  process.exit(0);
}

module.exports = { skipIfLiveTreeWillFire, userSettingsDispatch };
