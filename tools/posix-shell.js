'use strict';
/**
 * A POSIX shell for the tests that run .sh hooks or `sh -c` commands.
 *
 * Git Bash and the Linux gate have bash and sh on PATH. Windows PowerShell does not, and there
 * spawnSync('bash') returns status null with error ENOENT, which the hook tests reported as
 * "hook exited null". shell(name) looks on PATH first, then for Git for Windows' bin/<name>.exe
 * launcher, which puts /mingw64/bin and /usr/bin on the child's PATH so a hook finds sed, find
 * and bash exactly as under Git Bash.
 *
 *   const BASH = shell('bash');
 *   test('...', { skip: BASH.skip }, () => { const r = BASH.run([hook], opts); ... });
 *
 * `skip` is false when a shell was found, else the reason node:test prints. `run` is spawnSync
 * with that shell, and throws when the process never started, so a failure names the cause
 * instead of a null exit status.
 *
 * `input` reaches the child as a file on its stdin, never a pipe (issue 1143). spawnSync writes
 * piped `input` while the child runs, so a child that exits without reading it (a hook's early
 * `exit 0`) races that write: when the child wins, the write fails with EPIPE on Linux and EOF
 * on Windows after a clean exit. A 1 MiB prompt, larger than any pipe buffer, loses every time.
 * A file has no writer to fail, so the child may read all of its stdin or none of it.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function gitForWindowsRoots() {
  const roots = [];
  // `git --exec-path` is <root>/mingw64/libexec/git-core, wherever Git for Windows is installed.
  const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (exec.status === 0 && exec.stdout.trim()) roots.push(path.resolve(exec.stdout.trim(), '..', '..', '..'));
  if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'Git'));
  return roots;
}

function resolve(name) {
  if (!spawnSync(name, ['-c', 'exit 0']).error) return name;
  if (process.platform !== 'win32') return null;
  return gitForWindowsRoots().map((root) => path.join(root, 'bin', `${name}.exe`)).find((p) => fs.existsSync(p)) || null;
}

function started(r, exe, args) {
  if (r.error) throw new Error(`${exe} ${args.join(' ')} did not start: ${r.error.message}`);
  return r;
}

function shell(name) {
  const exe = resolve(name);
  return {
    path: exe,
    skip: exe ? false : `no ${name}: not on PATH and no Git for Windows bin/${name}.exe`,
    run(args, opts = {}) {
      const { input, ...rest } = opts;
      if (input == null) return started(spawnSync(exe, args, rest), exe, args);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posix-shell-stdin-'));
      const file = path.join(dir, 'stdin');
      const enc = rest.encoding && rest.encoding !== 'buffer' ? rest.encoding : 'utf8';
      fs.writeFileSync(file, typeof input === 'string' ? Buffer.from(input, enc) : input);
      const fd = fs.openSync(file, 'r');
      try {
        const stdio = Array.isArray(rest.stdio) ? rest.stdio.slice() : [null, rest.stdio || 'pipe', rest.stdio || 'pipe'];
        stdio[0] = fd;
        return started(spawnSync(exe, args, { ...rest, stdio }), exe, args);
      } finally {
        fs.closeSync(fd);
        // Tidy-up never decides the verdict: a grandchild the child left running may hold the file.
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left in the temp dir */ }
      }
    },
  };
}

module.exports = { shell };
