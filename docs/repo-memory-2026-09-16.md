# Repo-committed memory notes, loaded by the plugin — issue 210

What a claude.ai/code container proved on 2026-09-16, and the one step that needs the desktop.

## What changed

- 29 of the 31 claude-dotfiles notes moved from the generated `memory/` mirror to
  `docs/agents/memory/<name>.md`, index `MEMORY.md`. `concurrent-sessions-share-one-sync-push` and
  `fleet-implementers-edit-the-live-tree` were dropped: both are hazards of the shared live tree,
  which a repo-committed note has no live tree to warn about.
- `tools/repo-memory-load.js` is a SessionStart hook in the plugin payload
  (`marketplace/aac-skills/hooks/hooks.json`, its own group). It walks up from the session's cwd to
  `docs/agents/memory/MEMORY.md` and injects the index lines under a 2KB budget.
- `Get-MemoryItems` in `lib/manifest.ps1` no longer carries any project slug containing
  `-claude-dotfiles` (the checkout and its agent worktrees), so push neither reads the live copy nor
  rebuilds the mirror directory.
- `tools/repo-memory-pointer.js`, called by **both** sync modes, archives whatever is in that live
  directory and leaves one pointer file. The PC copy is therefore emptied by the owner's next push
  or pull, with no hand-run command.

## Proof from this container

Both runs are real plugin-installed sessions: `claude -p --plugin-dir marketplace/aac-skills`
(CLI 2.1.273), one turn each, no tools, answering from session-start context only.

1. **The loader is in the manifest and fires (criterion 2).** Debug log:
   `Hook SessionStart (Loading this repo's memory notes...) provided additionalContext (1833 chars)`.
   Prompt 1 asked for the injected line about one note and the session answered:

   > Line: `state-a-standing-rule-once: no reinforcing copies`
   >
   > Notes live in `docs/agents/memory/`.

   The same debug log shows `pwsh=none` in the marker hook's runtime probe, i.e. this is a container,
   not the desktop.

2. **A note added here reaches the next fresh session (criterion 3).** This session wrote
   `docs/agents/memory/cloud-containers-have-no-powershell.md` plus its index line and committed it
   (`db8ad0d`). A *fresh clone of the pushed branch* was then opened in a new session, which reported:

   > 30 notes. PowerShell line verbatim: "cloud-containers-have-no-powershell: pwsh=none, prove .ps1
   > on the PC"

   Injected size there: 1892 chars — still inside the 2KB budget.

3. **The live directory (criterion 4).** `node tools/repo-memory-pointer.js --home ~ --dry-run` in
   this container prints nothing and exits 0: there is no per-project memory directory here to empty,
   which is the whole reason the notes had to move. The behaviour is covered end to end against a
   fake home in `tools/repo-memory-pointer.test.js` (archive, then pointer; idempotent; other
   projects untouched; worktree slugs included), and the sync/manifest wiring is pinned there as
   text.

## What still needs the desktop

- `tests/restore-test.ps1` has not run: this container has no PowerShell and the isolation guard
  refuses to launch one (that is the new note). Run
  `powershell -ExecutionPolicy Bypass -File tests\restore-test.ps1` before trusting the pull half.
- The first `sync.ps1 -Mode push` (or pull) after this lands prints the archive and pointer lines and
  empties `~/.claude/projects/<...>-claude-dotfiles/memory`. Nothing to type; the archive path is in
  the output if anything in there was never committed.
- `~/.claude/CLAUDE.md`'s memory-governance section still describes local notes only. It is a live
  file and a fleet worker cannot write it. It is also no longer load-bearing for this: the loader's
  own first line tells every session, on every surface, that the notes are committed under
  `docs/agents/memory/` and that a commit is the whole publish.
