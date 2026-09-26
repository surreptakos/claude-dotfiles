---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
metadata:
  modified: '2026-09-25T23:57:51Z'
  previous-modified: '2026-09-21T03:33:03Z'
  revision: '3'
  content-sha: 1ea15c7491f9
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** — official docs, source code, specs, first-party APIs — not a secondary write-up of them. Follow every claim back to the source that owns it. When a source is a large dataset or dump rather than prose, write and run code against it to pull out the relevant facts rather than reading the raw data into context.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
4. Before calling the note finished, ground-check it where the repo carries the checker (claude-dotfiles does): `node tools/check-evidence.js <note.md>`. Every number, date and quote must appear verbatim in a source the note cites — a Markdown link or a `Source:` line; a path named in backticks is a mention, not a citation. Exit 1 names the note line whose fact is missing from the source; exit 3 means a source could not be read, which is not a pass. Fix the note or cite the source the fact actually came from.
