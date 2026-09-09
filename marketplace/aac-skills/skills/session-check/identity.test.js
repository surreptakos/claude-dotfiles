'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const id = require('./identity.js');

const AAC = 'b1000000-0000-0000-0000-000000000001';
const AAC_ORG = '10000000-0000-0000-0000-00000000000a';
const AAC_OLD_ORG = '20000000-0000-0000-0000-00000000000b';
const DAN = 'a2000000-0000-0000-0000-000000000002';
const DAN_ORG = '30000000-0000-0000-0000-00000000000c';

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'identity-test-'));
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function registry(home) {
  const reg = {
    accounts: {
      'Dan-AAC': { uuid: AAC, orgs: { [AAC_ORG]: 'current' }, surfaces: ['desktop'] },
      Dan: { uuid: DAN, email: 'dan@example.test', orgs: { [DAN_ORG]: 'personal' }, surfaces: ['cli'] },
    },
    repos: {
      'owner/dotfiles': { owner: 'Dan-AAC' },
      'owner/intake': { owner: 'Dan' },
      'owner/old': { owner: 'Dan-AAC', status: 'dead' },
    },
    routines: {
      'daily-thing': { owner: 'Dan-AAC', org: AAC_ORG },
      'weekly-thing': { owner: 'Dan-AAC', org: AAC_ORG },
    },
    auditRepo: 'owner/dotfiles',
  };
  writeJson(path.join(home, '.claude', 'accounts.json'), reg);
  return reg;
}

test('desktop identity comes from the host-session file path', () => {
  const home = scratch();
  const root = path.join(home, 'sessions');
  writeJson(path.join(root, AAC, AAC_ORG, 'local_abc.json'), { cwd: 'x' });
  const got = id.resolveIdentity({
    USERPROFILE: home, CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    CLAUDE_CODE_HOST_SESSION_ID: 'local_abc', CLAUDE_DESKTOP_SESSIONS_ROOT: root,
  });
  assert.equal(got.surface, 'desktop');
  assert.equal(got.accountUuid, AAC);
  assert.equal(got.orgUuid, AAC_ORG);
});

test('desktop identity falls back to config.json lastKnownAccountUuid, org unknown', () => {
  const home = scratch();
  const appdata = path.join(home, 'AppData');
  writeJson(path.join(appdata, 'Claude', 'config.json'), { lastKnownAccountUuid: AAC });
  const got = id.resolveIdentity({
    USERPROFILE: home, APPDATA: appdata, CLAUDE_CODE_ENTRYPOINT: 'claude-desktop',
    CLAUDE_CODE_HOST_SESSION_ID: 'local_missing',
  });
  assert.equal(got.accountUuid, AAC);
  assert.equal(got.orgUuid, null);
  assert.match(got.source, /lastKnownAccountUuid/);
});

test('cli identity comes from oauthAccount in the profile .claude.json', () => {
  const home = scratch();
  writeJson(path.join(home, '.claude.json'), {
    oauthAccount: { accountUuid: DAN, organizationUuid: DAN_ORG, emailAddress: 'dan@example.test' },
  });
  const got = id.resolveIdentity({ USERPROFILE: home, CLAUDE_CODE_ENTRYPOINT: 'cli' });
  assert.equal(got.surface, 'cli');
  assert.equal(got.accountUuid, DAN);
  assert.equal(got.orgUuid, DAN_ORG);
  assert.equal(got.email, 'dan@example.test');
});

test('a named profile reads CLAUDE_CONFIG_DIR/.claude.json, not the home one', () => {
  const home = scratch();
  const profile = path.join(home, '.claude-personal');
  writeJson(path.join(home, '.claude.json'), { oauthAccount: { accountUuid: AAC } });
  writeJson(path.join(profile, '.claude.json'), { oauthAccount: { accountUuid: DAN } });
  const got = id.resolveIdentity({ USERPROFILE: home, CLAUDE_CONFIG_DIR: profile });
  assert.equal(got.accountUuid, DAN);
});

test('cloud containers have no identity', () => {
  const home = scratch();
  writeJson(path.join(home, '.claude.json'), { oauthAccount: { accountUuid: DAN } });
  assert.equal(id.resolveIdentity({ USERPROFILE: home, CLAUDE_CODE_REMOTE_SESSION_ID: 'r1' }), null);
});

test('registry: labels, repo owners, dead status, and the default-profile fallback', () => {
  const home = scratch();
  registry(home);
  const profile = path.join(home, '.claude-personal');
  fs.mkdirSync(profile, { recursive: true });
  const reg = id.loadRegistry({ USERPROFILE: home, CLAUDE_CONFIG_DIR: profile });
  assert.ok(reg, 'named profile without its own registry falls back to ~/.claude/accounts.json');
  assert.equal(id.labelFor(reg, AAC), 'Dan-AAC');
  assert.equal(id.labelFor(reg, DAN.toUpperCase()), 'Dan');
  assert.equal(id.labelFor(reg, 'nope'), null);
  assert.equal(id.repoEntry(reg, { owner: 'Owner', repo: 'Intake' }).owner, 'Dan');
  assert.equal(id.repoEntry(reg, { owner: 'owner', repo: 'old' }).status, 'dead');
  assert.equal(id.repoEntry(reg, { owner: 'owner', repo: 'unknown' }), null);
  assert.equal(id.describe(reg, { surface: 'desktop', accountUuid: AAC, orgUuid: AAC_ORG }),
    'Dan-AAC (desktop, org current)');
  assert.match(id.describe(reg, { surface: 'cli', accountUuid: 'ffffffff-1', orgUuid: null }),
    /unregistered account ffffffff/);
});

test('registry: invalid JSON is reported, missing file is null', () => {
  const home = scratch();
  assert.equal(id.loadRegistry({ USERPROFILE: home }), null);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'accounts.json'), '{ nope');
  assert.match(id.loadRegistry({ USERPROFILE: home }).error, /not valid JSON/);
});

test('routine audit flags enabled scheduled routines outside their owner account or org', () => {
  const home = scratch();
  const reg = id.loadRegistry({ USERPROFILE: home }) || (registry(home), id.loadRegistry({ USERPROFILE: home }));
  const root = path.join(home, 'sessions');
  const task = (name, enabled, cron) => ({
    id: `${name}-id`, enabled, cronExpression: cron,
    filePath: path.join(home, '.claude', 'scheduled-tasks', name, 'SKILL.md'),
  });
  // Right account, right org: clean.
  writeJson(path.join(root, AAC, AAC_ORG, 'scheduled-tasks.json'),
    [task('daily-thing', true, '10 18 * * 1-5'), task('weekly-thing', true, '0 17 * * 5')]);
  // Right account, stale org: stray. Disabled copy there: ignored. Manual-only there: ignored.
  writeJson(path.join(root, AAC, AAC_OLD_ORG, 'scheduled-tasks.json'),
    [task('daily-thing', true, '10 9 * * 1-5'), task('weekly-thing', false, '0 17 * * 5'),
      task('manual-orchestrator', true, undefined)]);
  // Wrong account: stray; plus one the registry has never heard of.
  writeJson(path.join(root, DAN, DAN_ORG, 'scheduled-tasks.json'),
    { scheduledTasks: [task('daily-thing', true, '10 9 * * 1-5'), task('mystery', true, '0 9 * * 1')] });
  // An unknown shape scans but yields nothing, rather than throwing or inventing tasks.
  writeJson(path.join(root, DAN, 'other-org', 'scheduled-tasks.json'), { version: 2, items: {} });

  const r = id.auditRoutines(reg, root);
  assert.equal(r.scanned, 4);
  assert.deepEqual(r.stray.map((s) => `${s.taskId}@${s.where}`).sort(),
    ['daily-thing@Dan-AAC/20000000', 'daily-thing@Dan/personal'].sort());
  assert.deepEqual(r.unregistered.map((u) => u.taskId), ['mystery']);
  assert.equal(r.stray.find((s) => s.where === 'Dan/personal').owner, 'Dan-AAC');
});

test('routine audit with no registry root is empty, never throws', () => {
  const r = id.auditRoutines({ accounts: {}, routines: {} }, path.join(scratch(), 'missing'));
  assert.deepEqual(r, { scanned: 0, stray: [], unregistered: [] });
});
