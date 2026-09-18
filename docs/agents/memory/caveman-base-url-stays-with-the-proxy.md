---
name: caveman-base-url-stays-with-the-proxy
description: ANTHROPIC_BASE_URL=http://127.0.0.1:8787/w/claude belongs only in the session that starts the caveman proxy; set at cloud-environment level it strips the platform's github.com credential injection, and synced into settings.json it points a machine at a proxy it does not run
metadata:
  node_type: memory
  type: project
  originSessionId: session_01EtYk6hgE1HXtbnWrtb4pzk
  modified: 2026-09-17T19:10:00.000Z
---

Found 2026-09-17 (issues 483, 519). The cloud environment `Default` carried
`ANTHROPIC_BASE_URL=http://127.0.0.1:8787/w/claude` and
`_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL=1` as environment variables. Every container from it
came up with no credential injection for github.com: `git ls-remote` failed with `could not read
Username`, a dummy bearer reached GitHub as 401, `.claude/hooks/session-start.sh` died at the
dotfiles clone, so no aac payload, no gh, no governance hooks. Two sessions read it as a platform
outage. Dan removed the two variables; the next container's probe passed with nothing else changed.

**Why:** the platform's credential proxy is keyed off the session's first-party base URL. A base
URL pointing at a local proxy makes the container's outbound traffic look third-party, and the
injection stops. The same value in a synced `~/.claude/settings.json` is issue 479's desktop twin:
a restored machine without a running caveman proxy sends every model call to a dead port.

**How to apply:** caveman's `enable` writes the base URL into the settings of the session that
started the proxy, and that is the only place it may live. Never set it in a cloud environment's
variables, never let `profile/claude/settings.json` carry it (it still does today; issue 479 closed
wontfix on 2026-09-18, so strip the key by hand on a machine without the proxy), never put it in a
project `.claude/settings.json`.
When a container shows `git` refusing github.com with `could not read Username` and an empty
`~/.claude/hook-state/aac-bootstrap/`, check `env | grep ANTHROPIC_BASE_URL` before blaming the
platform. Related: [[three-skill-channels]].
