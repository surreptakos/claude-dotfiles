#!/usr/bin/env node
// THE ONLY CORRECT WAY TO RE-AUTHENTICATE CLASP. Do not hand-write a `clasp login` command.
//
// Run `node tools/clasp-auth.js`. It checks the stored credential and, when it is dead, prints the exact
// command to paste. The command is GENERATED from the constants below, so it cannot drift from
// what the credential actually needs.
//
// Why this file exists rather than a paragraph in CLAUDE.md: a bare `clasp login` looks like it
// works and quietly produces a WRONG credential, in two independent ways.
//
//   1. WRONG OAUTH CLIENT. clasp ships its own public client (1072944905499-…, see
//      @google/clasp/build/src/auth/oauth_client.js). Every AAC token is issued to a private client
//      in the shared GCP project instead — CLIENT_ID below. Without `--creds`, clasp authorizes its
//      own app and you get a credential for the wrong client.
//
//   2. SILENTLY NARROWER SCOPES. clasp's DEFAULT_SCOPES
//      (@google/clasp/build/src/commands/login.js) do NOT include spreadsheets, full drive,
//      mail.google.com, or script.processes. `authorize()` never passes `include_granted_scopes`
//      (see auth/auth_code_flow.js), so anything not requested is DROPPED from the new grant.
//      ~/.clasprc.json is shared by every AAC project on this machine, so a bare login silently
//      breaks Gmail and Drive work in other repos while `clasp push` here keeps working — the
//      worst possible failure shape.
//
// Exit codes match tools/header-drift.js and tools/tracker-audit.js:
//   0  credential is alive and carries every required scope
//   1  credential is dead or missing scopes — the fix command is printed
//   2  could not check (no credential file, no network) — NOT a pass
//
// INSTALLED BY THE project-harness SKILL (v7). Worked out in Meta/message-board, ported to
// aac-bill-intake 2026-08-01, then templated so every clasp repo gets the same gate.
//
// AAC-SPECIFIC BY DESIGN. CLIENT_ID and ACCOUNT below name the private OAuth client in GCP project
// gpt-sheets-access-475817 and the account that owns the bound scripts. A non-AAC repo needs both
// changed; there is no detection that could work them out, and guessing them would produce a tool
// that confidently validates the wrong credential.
//
// Run it before every `clasp push`. A repo with a package.json should also wire it to a `prepush`
// npm hook (see message-board); one without gets the gate from the session check and its release
// runbook instead.
//
// ~/.clasprc.json IS SHARED BY EVERY CLASP PROJECT ON THE MACHINE, so the scope list here is shared
// state. Keep the copies in step: a narrower grant taken in one repo silently breaks the others.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* ─── The credential's identity. Verified against ~/.clasprc.json on 2026-08-01. ─── */

// The private OAuth client in GCP project gpt-sheets-access-475817 (project number 594980791877).
// NOT clasp's bundled public client. A token whose client_id is anything else is the wrong token.
const CLIENT_ID = '594980791877-1r31l7idb4nc5js9ag2d28s5eni5joj5.apps.googleusercontent.com';

// The account that created the bound script. Only this account can push.
const ACCOUNT = 'djgatsakos@gmail.com';

// Scopes clasp requests on its own. Listed here only so the tool can work out which EXTRA scopes
// have to be named on the command line; keep in sync with clasp's DEFAULT_SCOPES.
const CLASP_DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/script.deployments',
  'https://www.googleapis.com/auth/script.projects',
  'https://www.googleapis.com/auth/script.webapp.deploy',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/service.management',
  'https://www.googleapis.com/auth/logging.read',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/cloud-platform'
];

// Everything the grant must carry, with the reason each one is load-bearing. Adding a line here
// automatically adds it to the generated command — that is the point of this file.
const REQUIRED_SCOPES = [
  ['https://www.googleapis.com/auth/script.projects', 'clasp push / clasp pull'],
  ['https://www.googleapis.com/auth/script.deployments', 'clasp deploy'],
  ['https://www.googleapis.com/auth/script.webapp.deploy', 'web-app deployments'],
  ['https://www.googleapis.com/auth/script.processes', 'read trigger execution history'],
  ['https://www.googleapis.com/auth/script.scriptapp', 'trigger management from script code'],
  ['https://www.googleapis.com/auth/script.external_request', 'UrlFetchApp from script code'],
  ['https://www.googleapis.com/auth/script.container.ui', 'menus and dialogs from script code'],
  ['https://www.googleapis.com/auth/spreadsheets', 'Sheets read+write; the header-drift clasp fallback'],
  ['https://www.googleapis.com/auth/drive', 'full Drive — NOT covered by drive.file'],
  ['https://www.googleapis.com/auth/drive.file', 'clasp default; kept for parity'],
  ['https://www.googleapis.com/auth/drive.metadata.readonly', 'clasp default; kept for parity'],
  ['https://mail.google.com/', 'full Gmail, used by other AAC projects sharing this token'],
  ['https://www.googleapis.com/auth/cloud-platform', 'GCP project access'],
  ['https://www.googleapis.com/auth/service.management', 'clasp default; enabling APIs'],
  ['https://www.googleapis.com/auth/logging.read', 'clasp logs'],
  ['https://www.googleapis.com/auth/userinfo.email', 'identity'],
  ['https://www.googleapis.com/auth/userinfo.profile', 'identity']
];

const CLASPRC = path.join(os.homedir(), '.clasprc.json');

// Where the client-secret JSON has been found before. The file is matched by its client_id, never
// by filename alone, so a stale download of some other client cannot be picked up by mistake.
const CREDS_SEARCH_DIRS = [
  path.join(os.homedir(), 'Downloads'),
  path.join(os.homedir(), '.config'),
  path.join(os.homedir(), 'Desktop'),
  path.join(os.homedir(), 'OneDrive - Active Alarm Company, Inc', 'Desktop'),
  path.join(os.homedir(), 'OneDrive - Active Alarm Company, Inc', 'Downloads')
];

/* ─── Helpers ─── */

function findCredsFile() {
  for (const dir of CREDS_SEARCH_DIRS) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue; // missing directory is not an error
    }
    for (const name of entries) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      let keys;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        keys = parsed.installed || parsed.web;
      } catch {
        continue; // not a client-secret file
      }
      if (!keys || keys.client_id !== CLIENT_ID) continue;
      const localhost = (keys.redirect_uris || []).some((u) => {
        try {
          return new URL(u).hostname === 'localhost';
        } catch {
          return false;
        }
      });
      // clasp throws "No localhost redirect URL found" without one, so reject it here with a
      // message that says what is actually wrong.
      if (!localhost) {
        console.error(`  ${file} matches the client id but has no http://localhost redirect URI.`);
        continue;
      }
      return file;
    }
  }
  return null;
}

/** The exact command to paste. Built from REQUIRED_SCOPES so it can never fall out of date. */
function buildLoginCommand(credsFile) {
  const extra = REQUIRED_SCOPES
    .map(([scope]) => scope)
    .filter((s) => !CLASP_DEFAULT_SCOPES.includes(s));
  const creds = credsFile
    ? credsFile.replace(/\\/g, '/')
    : `<DOWNLOAD FROM GCP: console.cloud.google.com/apis/credentials?project=gpt-sheets-access-475817 -> OAuth 2.0 Client IDs -> ${CLIENT_ID}>`;
  return `clasp login --creds "${creds}" --extra-scopes "${extra.join(',')}"`;
}

function printFix(credsFile, reason) {
  console.log('');
  console.log('='.repeat(78));
  console.log('CLASP RE-AUTHENTICATION REQUIRED');
  console.log('='.repeat(78));
  console.log(`Reason: ${reason}`);
  console.log('');
  console.log(`Back up the current credential first (clasp login overwrites it):`);
  console.log('');
  console.log(`  cp ~/.clasprc.json ~/.clasprc.json.bak-$(date +%Y%m%d)`);
  console.log('');
  console.log('Then run EXACTLY this. Do not shorten it — a bare `clasp login` authorizes the');
  console.log('wrong OAuth client and silently drops scopes that other AAC projects depend on.');
  console.log('');
  console.log(`  ${buildLoginCommand(credsFile)}`);
  console.log('');
  console.log(`In the browser: pick ${ACCOUNT} (NOT the activealarm.com address), then`);
  console.log('Advanced -> "Go to ... (unsafe)" on the unverified-app screen, then approve.');
  console.log('"Warning: You seem to already be logged in" is expected — it proceeds.');
  console.log('');
  console.log('Then re-run `node tools/clasp-auth.js` to confirm the grant actually came back.');
  console.log('='.repeat(78));
}

/* ─── Main ─── */

/* Returns the process exit code. Never calls process.exit(): on Node 24 / Windows that trips a
 * libuv assertion while fetch sockets are still open and reports 127 instead of the real code,
 * which would make the prepush gate block every push. Set process.exitCode and drain instead. */
async function main() {
  const quiet = process.argv.includes('--quiet');

  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(CLASPRC, 'utf8'));
  } catch (e) {
    console.error(`CANNOT CHECK: could not read ${CLASPRC} (${e.code || e.message})`);
    printFix(findCredsFile(), 'no credential file on disk');
    return 2;
  }

  const token = stored && stored.tokens && stored.tokens.default;
  if (!token || !token.refresh_token) {
    printFix(findCredsFile(), `${CLASPRC} has no default refresh token`);
    return 1;
  }

  if (token.client_id !== CLIENT_ID) {
    // This is the failure a bare `clasp login` produces. Name it explicitly.
    printFix(findCredsFile(),
      `stored token belongs to the WRONG OAuth client.\n` +
      `        stored: ${token.client_id}\n` +
      `        wanted: ${CLIENT_ID}\n` +
      `        A bare \`clasp login\` (no --creds) does exactly this.`);
    return 1;
  }

  // Refresh. This is the only way to know the grant is still live server-side; an unexpired
  // expiry_date proves nothing, because the grant can be revoked underneath it.
  let refreshed;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: token.client_id,
        client_secret: token.client_secret,
        refresh_token: token.refresh_token,
        grant_type: 'refresh_token'
      })
    });
    refreshed = await res.json();
    if (!res.ok || !refreshed.access_token) {
      printFix(findCredsFile(),
        `refresh failed: ${refreshed.error || res.status} — ${refreshed.error_description || ''}`.trim());
      return 1;
    }
  } catch (e) {
    console.error(`CANNOT CHECK: network error refreshing the token — ${e.message}`);
    console.error('This is not a pass.');
    return 2;
  }

  // Ask Google what the grant actually carries rather than trusting the local file.
  let granted = [];
  try {
    const res = await fetch(
      'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(refreshed.access_token));
    const info = await res.json();
    granted = String(info.scope || '').split(/\s+/).filter(Boolean);
  } catch (e) {
    console.error(`CANNOT CHECK: tokeninfo failed — ${e.message}`);
    return 2;
  }

  const missing = REQUIRED_SCOPES.filter(([scope]) => !granted.includes(scope));

  if (!quiet) {
    console.log(`credential: ${CLASPRC}`);
    console.log(`client:     ${token.client_id}`);
    console.log(`account:    ${ACCOUNT}`);
    console.log(`granted:    ${granted.length} scopes`);
    console.log('');
    for (const [scope, why] of REQUIRED_SCOPES) {
      console.log(`  ${granted.includes(scope) ? 'ok  ' : 'MISS'}  ${scope}  (${why})`);
    }
    const extra = granted.filter((s) => !REQUIRED_SCOPES.some(([r]) => r === s));
    if (extra.length) console.log(`\n  also granted (harmless): ${extra.join(', ')}`);
  }

  if (missing.length) {
    printFix(findCredsFile(),
      `token is alive but missing ${missing.length} required scope(s):\n` +
      missing.map(([s, why]) => `          ${s}  (${why})`).join('\n'));
    return 1;
  }

  if (!quiet) console.log('\nCLEAN — token refreshes and carries every required scope.');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
}, (err) => {
  console.error(`CANNOT CHECK: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 2;
});
