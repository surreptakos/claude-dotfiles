'use strict';
/**
 * node --test tests/ps-engine-resolution.test.js
 *
 * Issue 454. Every PowerShell suite here spawns children — the tool under test, sync.ps1, another
 * suite — and every spawn used to name the literal `powershell`, which exists only on Windows. A
 * container could install PowerShell 7 and still run none of them: the parent started, the first
 * child died on a missing binary. Each file now resolves the engine once, from its own process, and
 * falls back to that same literal so the desktop path is unchanged.
 *
 * The resolution is hand-copied per file on purpose (each suite runs standalone, before it
 * dot-sources anything), so this is the file that keeps the copies in step: a spawn site that goes
 * back to the literal, or a fallback that stops being `'powershell'`, fails here rather than in a
 * container three weeks later. The same for `$env:TEMP`, which is Windows-only too and is unset in
 * a stock fleet container — a suite that joins its sandbox onto it dies before its first assertion.
 *
 * The recipe for running these under pwsh is in docs/agents/issue-tracker.md, "Running the
 * PowerShell suites in a container".
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const SUITES = ['tests/restore-test.ps1', 'tests/git-env-leak.tests.ps1',
                'tests/settings-defaultmode.tests.ps1', 'tests/settings-invariants.tests.ps1'];

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('every PowerShell suite resolves its engine and spawns that, never the literal binary', () => {
  for (const rel of SUITES) {
    const src = read(rel);
    assert.match(src, /^\$Engine\s+= 'powershell'$/m,
      `${rel}: the fallback must stay the literal 'powershell' — that IS the Windows path`);
    assert.match(src, /^try \{ \$Engine = \[System\.Diagnostics\.Process\]::GetCurrentProcess\(\)\.MainModule\.FileName \} catch \{ \}$/m,
      `${rel}: no engine resolution — it would spawn 'powershell' on a machine that has pwsh`);
    assert.doesNotMatch(src, /&\s+powershell\b/,
      `${rel}: a spawn site still names the literal 'powershell', which exists only on Windows`);
  }
});

test('no suite joins its sandbox onto $env:TEMP, which a Linux container does not set', () => {
  for (const rel of SUITES) {
    const src = read(rel);
    assert.doesNotMatch(src, /Join-Path \$env:TEMP\b/,
      `${rel}: $env:TEMP is null in a container — Join-Path throws before the first assertion`);
    if (/\$TempRoot/.test(src)) {
      assert.match(src, /^\$TempRoot = if \(\$env:TEMP\) \{ \$env:TEMP \} else \{ \[System\.IO\.Path\]::GetTempPath\(\) \}$/m,
        `${rel}: $TempRoot must prefer %TEMP% so the Windows sandbox path is unchanged`);
    }
  }
});
