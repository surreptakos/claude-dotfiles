---
name: claude-md-lint
disable-model-invocation: true
description: Lint and trim a CLAUDE.md, AGENTS.md or other always-loaded instructions file against the concision paradigm. Use when asked to lint, audit or trim one, when a rulebook feels ignored or bloated, or before adding a section to one.
metadata:
  modified: "2026-10-02T15:41:12Z"
  previous-modified: "2026-09-18T04:06:51Z"
  revision: "6"
  content-sha: "f86dacb998b5"
---

# claude-md-lint — keep instruction files to what a session cannot derive

Bloated instruction files bury the rules that matter. This skill runs a deterministic linter over
one, then walks the trim pass the bundled `/doctor` skill describes but does not apply to global or
non-checked-in files.

## Run the linter

```bash
node "<skill base directory>/claude-md-lint.js" <file> [--against <other.md>]... [--json]
```

Pass `--against` for every other always-loaded file the target shares a session with (the global
file when linting a project one, and the reverse) so verbatim duplicates surface. The script header
documents every rule, budget, flag and exit code; a warn-only finding (issue 337) prints but leaves
the exit code 0.

## Findings are prompts, not verdicts

Ask the paradigm's question ("would removing this line cause a mistake?") of each flagged line. Two
classes are always noise: a rule *about* hedging or volatility trips `ambiguous` / `volatile`, and a
rule about a capability trips `code-derivable`. Leave those as they are. Suppress only when a line
must stay and the finding will keep firing (`<!-- claude-md-lint-ignore -->` on the line above, or
`<!-- claude-md-lint-disable: rule,rule -->` once per file); comments cost context too, so
unsuppressed noise beats a sprinkling of them.

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

1. Back up first: copy the file beside itself with a dated `.bak-<why>` suffix, or name the git
   recovery path out loud.
2. Edit the source. For the owner's global rules that is claude-dotfiles
   `profile/claude/CLAUDE.md`: `~/.claude/CLAUDE.md` is only a pointer (issue 732), and the
   plugin's `rules/global-rules.md` is generated from the source. Re-run the linter, and any claims
   tripwire the repo keeps on that file.
3. Report before and after: prose words, non-blank lines, estimated tokens, findings. Name what
   moved where. Done when every rule from the original still exists somewhere the file points at.
4. A file another copy is generated from: regenerate the copy with that repo's build (in
   claude-dotfiles, `tools/build-cloud-plugin.py` per its `CLAUDE.md`), never by hand.

The canonical linter, with its test suite, is claude-dotfiles `tools/claude-md-lint.js`;
`tools/claude-md-lint.test.js` fails unless this skill's copy is byte-identical, so change both
together.
