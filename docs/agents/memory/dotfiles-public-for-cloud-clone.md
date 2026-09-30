---
name: dotfiles-public-for-cloud-clone
description: "claude-dotfiles is a PUBLIC repo since 2026-09-21 so the cloud bootstrap hook can clone it in any session: the cloud GitHub proxy clones public repos unattached and private ones only via add_repo; a cloud environment has no repository or source list (issue 614); BOOTSTRAP_DOTFILES_TOKEN is the askpass clone path for a private repo (issue 1047)"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9e978f2d-96a9-5db9-91c2-f651e56b68dc
  modified: 2026-09-30T00:00:00.000Z
---

Dan flipped claude-dotfiles to public on 2026-09-21 so every harnessed repo's SessionStart
bootstrap clones master without an add_repo step. Proven the same day: a fresh session on
aac-contract-builder main with nothing attached reported "aac-bootstrap payload v2026.9.190627",
54 skills, 11 seated governance hook entries (comment on aac-contract-builder PR #291).

What the docs say (code.claude.com, cloud-environments): the GitHub proxy reaches "only
repositories attached to the session" for API and release-asset requests; a plain clone of a
public repo works unattached (measured: octocat/Hello-World exit 0, an unattached private repo
"could not read Username"). The environment dialog has name, network access, environment
variables, API credentials and a setup script; there is no repository or "source" list, so
"attach it as an environment source" was never a real fix. The setup script
cannot help either: it runs before the agent proxy, so it gets no GitHub or Google credential,
and it reaches only public GitHub content.

Consequence: a clone failure with "could not read Username" now means the repo reads as private
again. Check its visibility first; add_repo is the per-session workaround, not the fix.
Pre-flip scan (tree + 898 commits): no tokens or keys; the exposure is identifiers and the AAC
standards text, which the payload already carried.

2026-09-30, token path (issue 1047, PRD 1045): the flip to private is being prepared, and this
note stays until it lands. A cloud environment that carries the variable `BOOTSTRAP_DOTFILES_TOKEN`
bootstraps from a PRIVATE claude-dotfiles even when the repo is not attached to the session. The
hook hands the token to git through an askpass helper with the credential helper disabled, on the
initial shallow clone and on every later fetch, deepen and reset of `~/.aac-dotfiles`; it never
goes in the clone URL, because a URL credential persists in `.git/config` and in the setup-script
snapshot for about seven days (red-team ruling, 2026-09-29). After a clone the hook asserts the
remote URL has no userinfo and fails the bootstrap (marker `failed: true`, stage `clone`) if it
does. A session without the variable behaves as before. The clone-failure STOP text and the
session-check note now name the variable and the attached-source fallback (add_repo) instead of
the repo's visibility. Retire this note only after the flip.

Source: https://github.com/surreptakos/claude-dotfiles/issues/614, https://github.com/surreptakos/claude-dotfiles/issues/291, https://github.com/surreptakos/claude-dotfiles/issues/617, docs/research/cloud-container-capabilities.md, .claude/hooks/session-start.sh

Unsourced facts, ticket: https://github.com/surreptakos/claude-dotfiles/issues/969
