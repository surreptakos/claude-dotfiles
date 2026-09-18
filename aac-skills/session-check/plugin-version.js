'use strict';

/**
 * Compare a plugin's installed version to the version its marketplace clone offers.
 *
 * Returns one of:
 *   'behind'  installed is older than offered — the plugin is stale, run `claude plugin update`.
 *   'ahead'   installed is newer than offered — the marketplace CLONE is stale, run
 *             `claude plugin marketplace update`.
 *   'equal'   both parsed to the same numeric sequence — nothing to report.
 *   null      versions were unparseable AND unequal as strings — cannot say which is newer.
 *
 * Parses dot-separated numeric parts (semver-shaped: 1.2.3, 1.10.0, 2026.9.111524).
 * Pre-release tails (-rc.1, +build) are dropped before parsing. When one side has more
 * parts than the other, missing parts default to 0 (1.1 vs 1.1.0 is equal).
 *
 * Existed because `String(offered) !== String(entry)` was reporting installed:1.1.0 vs
 * offered:1.0.0 as "behind" and telling the user to run `claude plugin update`, which
 * reinstalls the same 1.1.0 they already have from the same stale clone (issue 85).
 */
function compareVersions(installed, offered) {
  if (installed == null || offered == null) return null;
  const a = String(installed);
  const b = String(offered);
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);
  if (!parsedA || !parsedB) return a === b ? 'equal' : null;
  const len = Math.max(parsedA.length, parsedB.length);
  for (let i = 0; i < len; i += 1) {
    const partA = parsedA[i] || 0;
    const partB = parsedB[i] || 0;
    if (partA > partB) return 'ahead';
    if (partA < partB) return 'behind';
  }
  return 'equal';
}

function parseVersion(v) {
  const core = String(v).trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (!core) return null;
  const parts = core.split('.');
  const nums = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(Number(part));
  }
  return nums.length ? nums : null;
}

/**
 * Decide what the Plugins section should say about one installed plugin, given both the
 * version compare and the git commits behind it.
 *
 * `installedSha` is installed_plugins.json's gitCommitSha (the marketplace commit the install
 * was cut from); `cloneSha` is the marketplace clone's current HEAD. When the two are equal the
 * clone IS the commit that was installed, so a version disagreement cannot be staleness on
 * either side — it is the marketplace repo's own marketplace.json lagging its plugin.json at
 * that commit. Seen 2026-09-15 on sstklen: plugin.json 1.1.0, marketplace.json 1.0.0, same
 * commit 4752148, and `claude plugin marketplace update` changed nothing. Reported as
 * 'manifest-lag' so the caller can stay silent instead of prescribing a refresh that is a no-op.
 *
 * Returns 'behind' | 'ahead' | 'equal' | 'manifest-lag' | null (see compareVersions).
 */
function classifyInstall({ installed, offered, installedSha, cloneSha } = {}) {
  const cmp = compareVersions(installed, offered);
  if (cmp === 'equal' || cmp === null) return cmp;
  if (installedSha && cloneSha && String(installedSha).trim() === String(cloneSha).trim()) {
    return 'manifest-lag';
  }
  return cmp;
}

module.exports = { compareVersions, classifyInstall };
