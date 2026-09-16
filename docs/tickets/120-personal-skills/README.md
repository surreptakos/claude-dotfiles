# Staged rewrites — the six personal-tree skills of issue 120

Six of issue 120's fifteen skills are real directories inside `~/.claude/skills`, so their only
copy in this repo is the generated mirror at `claude/skills/<name>/SKILL.md`. That mirror is
written by `sync.ps1 -Mode push` from the live tree and by nothing else: a hand edit here is
overwritten by the next push, and until then it reads as committed while the machine it came from
never changed. CLAUDE.md's cloud-session carve-out covers `aac-skills/` and `agents/skills/`; it
does not extend to `claude/skills/`.

These six rewrites were therefore produced in a cloud session that has no live tree, and staged
here instead. Each file is the complete `SKILL.md` the pass produced, `metadata:` block included
and unchanged — the stamps rotate on the push that lands the content, which is how they stay
believable.

| Staged file | Lands at | Words before → after |
|---|---|---|
| `aac-google-access.SKILL.md` | `~/.claude/skills/aac-google-access/SKILL.md` | 955 → 932 |
| `claude-md-lint.SKILL.md` | `~/.claude/skills/claude-md-lint/SKILL.md` | 649 → 631 |
| `consistency-audit.SKILL.md` | `~/.claude/skills/consistency-audit/SKILL.md` | 2044 → 1976 |
| `consolidate-memory.SKILL.md` | `~/.claude/skills/consolidate-memory/SKILL.md` | 491 → 453 |
| `maintain-repo.SKILL.md` | `~/.claude/skills/maintain-repo/SKILL.md` | 403 → 333 |
| `update-cloud-plugin.SKILL.md` | `~/.claude/skills/update-cloud-plugin/SKILL.md` | 1245 → 1195 |

## Landing them

From the main checkout on the owner's machine, after this branch has merged:

```powershell
$repo = "$HOME\Claude\Projects\Meta\claude-dotfiles"
Get-ChildItem "$repo\docs\tickets\120-personal-skills\*.SKILL.md" | ForEach-Object {
  $name = $_.Name -replace '\.SKILL\.md$',''
  Copy-Item $_.FullName "$HOME\.claude\skills\$name\SKILL.md" -Force
}
& "$repo\sync.ps1" -Mode push
```

The push re-mirrors `claude/skills/`, rotates the four stamps on each of the six, and rebuilds
`marketplace/aac-skills/`. Diff `claude/skills/<name>/SKILL.md` against the staged file afterwards:
they match apart from the stamps.

Two of the six carry a mirror home-path token that only `sync.ps1 -Mode pull` expands:
`__USERHOME_FWD__` in `aac-google-access.SKILL.md`'s clasp re-authentication command, and
`__USERHOME__` in `update-cloud-plugin.SKILL.md`'s from-mirror rebuild example. Substitute the
owner's home path when copying those two by hand, or pull them rather than copying.

Delete this folder once the six have landed and the mirror agrees with it.
