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
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
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

function shell(name) {
  const exe = resolve(name);
  return {
    path: exe,
    skip: exe ? false : `no ${name}: not on PATH and no Git for Windows bin/${name}.exe`,
    run(args, opts) {
      const r = spawnSync(exe, args, opts);
      // EPIPE with an exit status: the child ran and exited without reading `input`.
      if (r.error && !(r.error.code === 'EPIPE' && r.status !== null)) throw new Error(`${exe} ${args.join(' ')} did not start: ${r.error.message}`);
      return r;
    },
  };
}

module.exports = { shell };
