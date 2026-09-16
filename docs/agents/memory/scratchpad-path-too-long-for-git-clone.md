---
name: scratchpad-path-too-long-for-git-clone
description: "git clone into the session scratchpad fails with \"Filename too long\" on this machine; clone throwaway repos under a short root like C:\\hv17 instead"
metadata: 
  node_type: memory
  type: project
  originSessionId: 0289dd4e-f841-4aee-9933-0d403b2ac6be
  modified: 2026-09-09T19:58:00.841Z
---

`git clone` into the session scratchpad (`%LOCALAPPDATA%\Temp\claude\<slug>\<session>\scratchpad\...`)
fails on this machine with `error: unable to open loose object ...: Filename too long` and
`fatal: cannot write keep file`. Every clone of the seven AAC repos failed that way on 2026-09-09.

**Why:** the scratchpad slug embeds the full worktree path, so `.git/objects/pack/pack-<sha>.keep`
exceeds the Windows path limit; core.longpaths does not cover the pack keep file.

**How to apply:** for throwaway clones use a short root (`mkdir /c/hv17`), delete it when done.
Keep scripts and outputs in the scratchpad; only the git checkout needs the short path.
Related: [[sed-strips-crlf-in-this-repo]].
