// aac-design render.py names the cause of a failed conversion (issue 1310). In the cloud container
// soffice printed only "Error: source file could not be loaded" for every .docx; the cause was a
// LibreOffice core with no Writer component beside it. A stub soffice reproduces that shape: it
// prints LibreOffice's generic line, writes no PDF, and sits in a folder with no Writer library.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RENDER = path.join(__dirname, '..', 'aac-skills', 'aac-design', 'scripts', 'render.py');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aac-design-render-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a conversion that writes no PDF names the missing Writer component beside soffice\'s own line', () => {
  const bin = path.join(root, 'program');
  fs.mkdirSync(bin);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(bin, 'soffice.cmd'), '@echo Error: source file could not be loaded\r\n');
  } else {
    fs.writeFileSync(path.join(bin, 'soffice'), '#!/bin/sh\necho "Error: source file could not be loaded"\n', { mode: 0o755 });
  }
  const docx = path.join(root, 'known-good.docx');
  fs.writeFileSync(docx, 'stub');
  const r = spawnSync('python3', [RENDER, docx, '--out', path.join(root, 'out')], {
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, AAC_DESIGN_NO_INSTALL: '1' },
  });
  assert.equal(r.status, 3, `${r.stderr}\n${r.stdout}`);
  assert.match(r.stderr, /conversion failed under Carlito: LibreOffice's Writer component \((lib)?swlo\.(so|dll|dylib)\) is not installed/);
  assert.match(r.stderr, /install libreoffice-writer/);
  assert.match(r.stderr, /soffice said: Error: source file could not be loaded/);
});
