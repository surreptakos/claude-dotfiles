'use strict';
/**
 * Which Claude account is this session running under, and who owns what.
 *
 * Two accounts share one machine (issue 103 in claude-dotfiles) and nothing in the product says
 * which one a session, a desktop routine or a scheduled master is using. The identity IS on disk
 * for the two local surfaces, just in two different places:
 *
 *   desktop  — CLAUDE_CODE_ENTRYPOINT=claude-desktop and CLAUDE_CODE_HOST_SESSION_ID name a file
 *              %APPDATA%\Claude\claude-code-sessions\<accountUuid>\<orgUuid>\<hostSessionId>.json;
 *              the two directory names are the identity. Fallback: lastKnownAccountUuid in
 *              %APPDATA%\Claude\config.json (account only, no org).
 *   cli      — <profile>/.claude.json holds oauthAccount { accountUuid, organizationUuid,
 *              emailAddress }, where <profile> is CLAUDE_CONFIG_DIR's parent-less file for the
 *              default profile (~/.claude.json) or CLAUDE_CONFIG_DIR/.claude.json for a named one.
 *   cloud    — nothing on disk; identity is unknown and every check stays quiet.
 *
 * The registry (~/.claude/accounts.json, hand-written) maps labels to uuids, repos to owner labels
 * and desktop routines to the account and org they must be enabled under. Every function here is
 * pure over the paths and env it is handed, so the tests run against fixture directories.
 *
 * Enforcement is a WARNING, never a hard gate (Dan, 2026-09-09). Nothing here exits non-zero.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (e) { return null; }
}

function homeDir(env) {
  return env.USERPROFILE || env.HOME || os.homedir();
}

/** The profile directory a session reads its config from. */
function configDir(env) {
  return env.CLAUDE_CONFIG_DIR || path.join(homeDir(env), '.claude');
}

/** The .claude.json that carries oauthAccount for this profile. The default profile keeps it
 *  beside ~/.claude (as ~/.claude.json); a named profile keeps it inside CLAUDE_CONFIG_DIR. */
function cliStateFile(env) {
  if (env.CLAUDE_CONFIG_DIR) return path.join(env.CLAUDE_CONFIG_DIR, '.claude.json');
  return path.join(homeDir(env), '.claude.json');
}

function desktopSessionsRoot(env) {
  if (env.CLAUDE_DESKTOP_SESSIONS_ROOT) return env.CLAUDE_DESKTOP_SESSIONS_ROOT;
  if (!env.APPDATA) return null;
  return path.join(env.APPDATA, 'Claude', 'claude-code-sessions');
}

function isCloud(env) {
  return Boolean(env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE);
}

/** Find <root>/<account>/<org>/<hostSessionId>.json without knowing account or org. */
function findDesktopSession(root, hostSessionId) {
  if (!root || !hostSessionId || !fs.existsSync(root)) return null;
  const wanted = `${hostSessionId}.json`;
  for (const account of safeReaddir(root)) {
    const accountDir = path.join(root, account);
    if (!isDir(accountDir)) continue;
    for (const org of safeReaddir(accountDir)) {
      const orgDir = path.join(accountDir, org);
      if (!isDir(orgDir)) continue;
      if (fs.existsSync(path.join(orgDir, wanted))) return { accountUuid: account, orgUuid: org };
    }
  }
  return null;
}

function safeReaddir(dir) {
  try { return fs.readdirSync(dir); } catch (e) { return []; }
}
function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

/**
 * @returns {null | { surface: 'desktop'|'cli', accountUuid: string, orgUuid: string|null,
 *                    email: string|null, source: string }}
 *   null when the surface leaves no identity on disk (cloud) or nothing readable was found.
 */
function resolveIdentity(env = process.env) {
  if (isCloud(env)) return null;

  if (env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') {
    const root = desktopSessionsRoot(env);
    const hit = findDesktopSession(root, env.CLAUDE_CODE_HOST_SESSION_ID);
    if (hit) {
      return { surface: 'desktop', accountUuid: hit.accountUuid, orgUuid: hit.orgUuid, email: null,
        source: 'host-session file' };
    }
    const cfg = env.APPDATA ? readJson(path.join(env.APPDATA, 'Claude', 'config.json')) : null;
    if (cfg && cfg.lastKnownAccountUuid) {
      return { surface: 'desktop', accountUuid: cfg.lastKnownAccountUuid, orgUuid: null, email: null,
        source: 'desktop config.json lastKnownAccountUuid' };
    }
    return null;
  }

  const state = readJson(cliStateFile(env));
  const acct = state && state.oauthAccount;
  if (acct && acct.accountUuid) {
    return { surface: 'cli', accountUuid: acct.accountUuid, orgUuid: acct.organizationUuid || null,
      email: acct.emailAddress || null, source: path.basename(cliStateFile(env)) + ' oauthAccount' };
  }
  return null;
}

/** ~/.claude/accounts.json — from the active profile first, then the default profile, so a named
 *  profile (claude-personal) that the sync does not refresh still finds the one registry. */
function registryPath(env = process.env) {
  const candidates = [
    path.join(configDir(env), 'accounts.json'),
    path.join(homeDir(env), '.claude', 'accounts.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadRegistry(env = process.env) {
  const p = registryPath(env);
  if (!p) return null;
  const reg = readJson(p);
  if (!reg || typeof reg !== 'object') return { error: `${p} is not valid JSON` };
  reg._path = p;
  reg.accounts = reg.accounts || {};
  reg.repos = reg.repos || {};
  reg.routines = reg.routines || {};
  return reg;
}

function labelFor(registry, accountUuid) {
  if (!registry || !accountUuid) return null;
  for (const [label, a] of Object.entries(registry.accounts)) {
    if (a && a.uuid && a.uuid.toLowerCase() === String(accountUuid).toLowerCase()) return label;
  }
  return null;
}

function orgLabelFor(registry, label, orgUuid) {
  const a = registry && registry.accounts[label];
  if (!a || !a.orgs || !orgUuid) return null;
  for (const [uuid, name] of Object.entries(a.orgs)) {
    if (uuid.toLowerCase() === String(orgUuid).toLowerCase()) return name;
  }
  return null;
}

function repoEntry(registry, slug) {
  if (!registry || !slug) return null;
  const key = `${slug.owner}/${slug.repo}`;
  const hit = Object.entries(registry.repos).find(([k]) => k.toLowerCase() === key.toLowerCase());
  return hit ? { key: hit[0], ...hit[1] } : null;
}

/** Describe an identity for a report line: "Dan-AAC (desktop, org current)". */
function describe(registry, id) {
  if (!id) return 'unknown account';
  const label = labelFor(registry, id.accountUuid) || `unregistered account ${id.accountUuid.slice(0, 8)}`;
  const parts = [id.surface];
  const org = orgLabelFor(registry, labelFor(registry, id.accountUuid), id.orgUuid);
  if (id.orgUuid) parts.push(org ? `org ${org}` : `unregistered org ${id.orgUuid.slice(0, 8)}`);
  return `${label} (${parts.join(', ')})`;
}

/**
 * Walk every <root>/<account>/<org>/scheduled-tasks.json and report enabled, cron-scheduled
 * routines sitting under an account or org other than the registry says. Manual-only tasks (no
 * cron) never fire on their own and are skipped. Tasks the registry does not know are reported
 * separately so the registry can be completed.
 */
function auditRoutines(registry, root) {
  const result = { scanned: 0, stray: [], unregistered: [] };
  if (!registry || !root || !fs.existsSync(root)) return result;
  for (const account of safeReaddir(root)) {
    const accountDir = path.join(root, account);
    if (!isDir(accountDir)) continue;
    for (const org of safeReaddir(accountDir)) {
      const file = path.join(accountDir, org, 'scheduled-tasks.json');
      const data = readJson(file);
      if (!data) continue;
      result.scanned++;
      // The desktop app writes { "scheduledTasks": [...] } (shape read 2026-09-09); the other
      // two shapes cost nothing and keep a future rename from silently emptying the audit.
      const tasks = Array.isArray(data) ? data
        : Array.isArray(data.scheduledTasks) ? data.scheduledTasks
          : Array.isArray(data.tasks) ? data.tasks : [];
      for (const t of tasks) {
        if (!t || typeof t !== 'object' || !t.id || !t.enabled) continue;
        if (!t.cronExpression) continue; // manual-only: never fires by itself
        const taskId = t.filePath ? path.basename(path.dirname(t.filePath)) : t.id;
        const want = registry.routines[taskId];
        const where = `${labelFor(registry, account) || account.slice(0, 8)}/${orgLabelFor(registry, labelFor(registry, account), org) || org.slice(0, 8)}`;
        if (!want) { result.unregistered.push({ taskId, where, cron: t.cronExpression }); continue; }
        const ownerUuid = (registry.accounts[want.owner] || {}).uuid || '';
        const accountOk = ownerUuid && ownerUuid.toLowerCase() === account.toLowerCase();
        const orgOk = !want.org || want.org.toLowerCase() === org.toLowerCase();
        if (!accountOk || !orgOk) {
          result.stray.push({ taskId, where, owner: want.owner, cron: t.cronExpression, file });
        }
      }
    }
  }
  return result;
}

module.exports = {
  resolveIdentity, loadRegistry, registryPath, labelFor, orgLabelFor, repoEntry, describe,
  auditRoutines, desktopSessionsRoot, cliStateFile, findDesktopSession, isCloud,
};
