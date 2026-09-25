# Merging a template into a repo's extended copy

Reference for step 7 of [`SKILL.md`](SKILL.md): read it before re-copying any template a repo
already carries (`tools/tracker-audit.js`, `scripts/build-dashboard.js`, `dashboard.yml`, …).

## Assume the repo extended it

Repos customize template bodies, not just `CONFIG`, and their own tests pin those customizations.
Hand-extended copies are the norm: most repos carry a `tracker-audit.js` with their own checks, and
a blind re-copy has deleted a load-bearing dashboard section and broken a pre-push suite. So, per
template, per repo:

1. **Pull the repo first.** A divergence can live only on origin (a merged PR the local clone lacks);
   a local diff then reads clean and the clobber surfaces later as a conflict.
2. **Diff the repo copy against the PREVIOUS template revision** (the one the repo last received).
   If nothing beyond `CONFIG` and the changed region differs, re-copy (splicing `CONFIG` per step
   3.3). Otherwise run the three-way merge below.
3. **Check whether the repo already implements the new check under its own name** before porting
   it; port only the missing half (aac-cockpit's `landed-but-open` pair already covered v11's
   `possibly-delivered?`).

## The three-way merge

The base is the template blob at the repo's version: the file as it stood just before the template
marker first moved past the repo's number. Run from a pulled claude-dotfiles clone, `$r` the repo:

```sh
f=tracker-audit.js     # any template the repo carries under tools/ or scripts/
n=$(sed -n 's/^ *harness-version: *//p' "$r/docs/agents/harness-version.md" | head -1)
tpl() { git show "$1:aac-skills/project-harness/templates/$2" 2>/dev/null ||
        git show "$1:agents/skills/project-harness/templates/$2"; }   # path before issue 214
bump=                  # the commit that took the template marker past $n
for c in $(git log --first-parent --format=%H origin/master -- '*/project-harness/templates/harness-version.md'); do
  v=$(tpl "$c" harness-version.md | sed -n 's/^ *harness-version: *//p' | head -1)
  [ "${v:-0}" -le "$n" ] && break
  bump=$c
done
w=$(mktemp -d)
tpl "$bump^" "$f" > "$w/base"          # the template as the repo last received it
tpl origin/master "$f" > "$w/theirs"   # the template now
cp "$r/tools/$f" "$w/ours"
git merge-file -L "repo" -L "template v$n" -L "template now" "$w/ours" "$w/base" "$w/theirs"
echo "conflicts: $?"                   # 0 = clean; N = N conflict hunks; negative = error
cp "$w/ours" "$r/tools/$f"
```

An empty `$bump` means the repo is already at the template's version: nothing to merge.

Resolve every `<<<<<<<` hunk keeping BOTH sides — the repo's extension and the template's addition —
then `node --check` and run the repo's own tests, which pin the extensions. The usual conflict sites
in `tracker-audit.js` are the ones every added check touches:

- the header comment (the generated banner against the repo's own notes);
- the `module.exports` list under `require.main !== module` (the repo exports its own helpers to its
  tests);
- the `ORDER` array of finding kinds before the report — resolve as the union;
- the `NOTE:` blind-spot blocks after it.
