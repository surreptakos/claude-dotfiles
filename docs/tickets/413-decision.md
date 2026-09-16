# Issue 413: can `aac-routines`' SessionStart hook repoint the editable install from a fleet worktree? — check + decision

**Answer: yes, it can.** The hook installs from whatever working tree the session starts in, and a
ticket-fleet implementer or prober session starts in a linked worktree.

**Decision:** the ticket's fix (a) — the prompts — lands in `claude-dotfiles`, and the hook's own
guard does not, because the hook lives in another repository. What lands here instead is the
repair: the fleet runs `aac-skills/ticket-fleet/editable-install-guard.js` once the wave has
drained and repoints a captured editable install back at the main checkout. That covers the
hook-triggered path, which no prompt of ours can reach — the hook runs before the agent reads a
word. The hook-side guard is named below as an `aac-routines` follow-up.

## The check

The hook was read at `surreptakos/aac-routines` `.claude/hooks/session-start.sh` (108 lines,
default branch, 2026-09-16), via
`gh api repos/surreptakos/aac-routines/contents/.claude/hooks/session-start.sh`. Three facts
decide it:

```sh
ROOT="${CLAUDE_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
cd "$ROOT" || exit 0
...
if "$PY" "$CHECK"; then
  exit 0  # no-op: the declared dependency set is already installed
fi
...
if "$PY" -m pip install --disable-pip-version-check --quiet --editable ".[dev]" >&2 \
```

1. `ROOT` is the session's own project directory, and a fleet implementer's session *is* a linked
   worktree — so `cd "$ROOT"` lands inside it and `pip install --editable "."` installs *that*
   checkout.
2. The hook already handles linked worktrees deliberately a few lines above, rewriting an absolute
   `core.hooksPath` because "linked worktrees under `.claude/worktrees/` share the repository
   config" (its issue 339 block). It is not a hook that only ever runs on main.
3. Nothing between those two points tests where it is. The install is reached whenever
   `check_test_deps.py` reports a missing dependency — which is precisely the state an orphaned
   editable install produces, so the failure re-arms itself: worktree installs, worktree is
   deleted, next session's check fails, next worktree installs.

## What would guard it (an `aac-routines` change, not this repo's)

Inside a linked worktree `git rev-parse --git-dir` and `--git-common-dir` differ; in the main
checkout they agree. So the install line becomes: install from the main checkout, or not at all.

```sh
gitdir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -n "$gitdir" ] && [ -n "$common" ] && [ "$gitdir" != "$common" ]; then
  echo "aac-routines: this is a linked worktree, so the editable install was left naming the main checkout (claude-dotfiles issue 413). Run tests from here with PYTHONPATH=$PWD/src for anything that spawns a subprocess."
  exit 0
fi
```

Until that lands, a fleet wave repairs what it caused: see "Python packages: one editable install,
shared by every worktree" in `aac-skills/ticket-fleet/SKILL.md`.
