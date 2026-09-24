# Global rules — pointer

`sync.ps1 -Mode pull` writes this file to `~/.claude/CLAUDE.md` in place of the rules text (issue 732).

The global rules arrive via the aac-skills plugin: its SessionStart hook injects the full text at every
startup, resume, clear and compaction, and a short digest rides every prompt. A plugin update carries
a rules change, so no pull is needed for one.

Their source lives in the claude-dotfiles repo at `profile/claude/CLAUDE.md`. Edit it there on a branch;
the merge to master is the release.

Do not paste the rules back into this file. The plugin hook stays silent whenever this file carries
the rules file's first line, so a copy here replaces the delivered text with a stale one.

## Machine-local notes

Notes for this machine only. A pull rewrites this file; the previous copy is in that pull's
`~/.claude-dotfiles-backup-<timestamp>` folder.
