---
name: claude-md-lint
description: Audit or trim a CLAUDE.md, AGENTS.md or other always-loaded instructions file against the concision paradigm ("would removing this line cause a mistake?"). Use when asked to lint, audit, trim, shrink or review a CLAUDE.md, when a rulebook feels ignored or bloated, or before adding a new section to one. Bundles the deterministic linter; the trim pass is the model's job.
metadata:
  modified: '2026-09-12T16:30:57Z'
  previous-modified: '2026-09-11T21:19:25Z'
  revision: '3'
  content-sha: 42953a204051
---

# claude-md-lint — keep instruction files to what a session cannot derive

> **Packaged copy.** A cloud session runs none of this machine's hooks, so the commands below
> call the plugin's own bundled scripts. Nothing is cached and `--refresh` does not apply:
> every run is fresh.

Bloated instruction files make the rules that matter get ignored. This skill runs a deterministic
linter over one, then walks the trim pass the bundled `/doctor` skill describes but does not
apply to global or non-checked-in files.

## Run the linter

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/claude-md-lint/claude-md-lint.js" <file> [--against <other.md>]... [--json]
```

Exit 0 clean, 1 findings, 2 usage. One tab-separated line per finding: `file:line  rule  message`.
Pass `--against` for every other always-loaded file the target shares a session with (the global
file when linting a project one, and the reverse) so verbatim duplicates surface. The script reads
package.json and formatter configs beside the file on its own.

Rules, one per row of the paradigm's exclude column: `size`, `self-evident`, `std-convention`,
`enforced-elsewhere`, `guessable-command`, `tech-stack`, `tutorial`, `file-inventory`, `api-dump`,
`lazy-candidate`, `volatile`, `code-derivable`, `ambiguous`, `duplicate`, `emphasis`. Budgets:
200 non-blank lines (the docs' own target), 2500 prose words, 40,000 chars (the CLI's memory-file
warning floor). Fenced code is never linted as prose. The script header documents every rule.

## Read the findings, do not obey them

Every finding is a prompt to ask the paradigm's question of that line, not a verdict. Two classes
are always noise: a rule *about* hedging or volatility trips `ambiguous` / `volatile`, and a rule
about a capability trips `code-derivable`. Leave those; suppress only when a line must stay and the
finding will keep firing (`<!-- claude-md-lint-ignore -->` on the line above, or
`<!-- claude-md-lint-disable: rule,rule -->` once per file). Comments cost context too, so prefer
leaving noise unsuppressed over sprinkling them.

## The trim pass

Then read the whole file once by section, applying the derivability test the linter cannot: could a
fresh session in this repo reconstruct this with `ls`, `cat`, the manifest or `--help`?

- **Cut:** directory layouts, tech-stack lists, standard build/test invocations, API signatures
  copied from source, README-style architecture tours, generic best practice, rules a linter or
  pre-commit already enforces, counts and progress ("12 cases", "20 of 35"), history and dated
  narrative behind a rule.
- **Keep:** gotchas and failure contracts, design rationale the code cannot explain, conventions that
  differ from tool defaults, safety prohibitions ("never push to main") without exception, repo
  etiquette, non-guessable commands and env quirks, pointers to where the rest lives.
- **Move, keep a pointer:** a section that applies to one project family or one task (a deploy
  recipe, a credentials inventory) becomes a skill or a nested instructions file; a two-line
  pointer stays so no session can claim the thing does not exist. Dated evidence behind a rule
  goes to a memory note the file names.
- **When unsure, keep.** The owner wrote it.

## Land it

1. Back up first: copy the live file beside itself with a dated `.bak-<why>` suffix, or name the
   git recovery path out loud.
2. Edit the live file (for a mirrored global file, never the repo mirror), re-run the linter, and
   re-run any claims tripwire the repo keeps on that file.
3. Report before and after: prose words, non-blank lines, estimated tokens, findings. Name what
   moved where. Every rule from the original must still exist somewhere the file points at.
4. If the file is mirrored into a dotfiles repo, regenerate the mirror with its sync push; do not
   hand-edit the mirror.

The canonical copy of the linter, with its test suite, lives in the claude-dotfiles repo under
`tools/`; that suite asserts this skill's copy is byte-identical, so update both together.
