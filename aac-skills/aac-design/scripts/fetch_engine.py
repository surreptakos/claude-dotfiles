#!/usr/bin/env python3
"""Fetch a source skill's engine or large data at run time, hash-checked (issue 1085).

    python3 fetch_engine.py                      # list what can be fetched
    python3 fetch_engine.py NAME [--cache DIR]   # fetch NAME, print its local path

The plugin payload carries the source skills' rule text only (vendor/). What a source needs to
run, such as impeccable's detector binary and its font index, is pinned in
vendor/PROVENANCE.json under `fetched` and downloaded here on demand. A download is kept only
when its hash matches the pin: `blob` is the upstream git blob sha of the file at the vendored
commit, `sha256` the per-platform digest of a release binary. A cached copy is re-checked before
it is used, so a changed file is refused, not run.

Exit 0 with the path on stdout; 1 when the hash does not match or the download fails; 2 for a
name that is not pinned or a platform with no pinned binary. Standard library only.
"""
import argparse
import hashlib
import json
import os
import platform
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROVENANCE = HERE.parent / 'vendor' / 'PROVENANCE.json'
DEFAULT_CACHE = Path(os.environ.get('AAC_DESIGN_CACHE') or Path.home() / '.cache' / 'aac-design')


def pins():
    return {e['name']: e for e in json.loads(PROVENANCE.read_text(encoding='utf-8')).get('fetched', [])}


def platform_key():
    osname = {'linux': 'linux', 'darwin': 'darwin', 'win32': 'windows'}.get(sys.platform, sys.platform)
    arch = {'x86_64': 'x64', 'amd64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(platform.machine().lower(), platform.machine().lower())
    return f'{osname}-{arch}' + ('.exe' if osname == 'windows' else '')


def digest(entry, data):
    """(kind, expected, actual) for this entry on this platform, or None when nothing is pinned here."""
    if 'blob' in entry:
        return 'blob', entry['blob'], hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()
    want = entry.get('sha256', {}).get(platform_key())
    return want and ('sha256', want, hashlib.sha256(data).hexdigest())


def resolve(entry):
    """(url, local file name) for this platform."""
    if 'sha256' in entry:
        key = platform_key()
        if key not in entry['sha256']:
            return None
        return entry['url'].replace('{platform}', key), f"{entry['name']}-{entry['version']}-{key}"
    return entry['url'], f"{entry['name']}-{entry['blob'][:12]}{Path(entry['path']).suffix}"


def verified(entry, data):
    kind, want, got = digest(entry, data)
    return want == got, f'{kind} {got}, pinned {want}'


def fetch(name, cache):
    entry = pins().get(name)
    if entry is None:
        return 2, f'fetch_engine: {name} is not pinned in {PROVENANCE.name}'
    target = resolve(entry)
    if target is None:
        return 2, f'fetch_engine: no pinned {name} binary for {platform_key()}'
    url, fname = target
    dest = Path(cache) / fname
    if dest.is_file():
        ok, why = verified(entry, dest.read_bytes())
        if ok:
            return 0, str(dest)
        dest.unlink()
        sys.stderr.write(f'fetch_engine: cached {dest} failed its check ({why}); fetching again\n')
    try:
        with urllib.request.urlopen(url, timeout=120) as r:
            data = r.read()
    except Exception as e:  # noqa: BLE001 - any network failure is the same answer
        return 1, f'fetch_engine: could not download {url}: {e}'
    ok, why = verified(entry, data)
    if not ok:
        return 1, f'fetch_engine: refused {url}: {why}'
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + '.part')
    part.write_bytes(data)
    if 'sha256' in entry and not fname.endswith('.exe'):
        part.chmod(0o755)
    os.replace(part, dest)
    return 0, str(dest)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('name', nargs='?')
    ap.add_argument('--cache', default=str(DEFAULT_CACHE))
    a = ap.parse_args(argv)
    if not a.name:
        for n, e in pins().items():
            print(f"{n}\t{e['skill']}\t{e['url']}")
        return 0
    code, msg = fetch(a.name, a.cache)
    (sys.stdout if code == 0 else sys.stderr).write(msg + '\n')
    return code


if __name__ == '__main__':
    sys.exit(main())
