---
name: cloud-only-criteria-stall-the-desktop-fleet
description: A ticket whose acceptance needs a real claude.ai/code container cannot pass the fleet verifier from the desktop; land the code with an honest proof doc, keep the issue open, prove from the cloud session (2026-09-15, #163)
metadata:
  type: project
---

Fleet run 6aa96ed9 on #163 (cloud bootstrap hook) burned three Opus implementer attempts
(108 minutes) because the ticket's criterion "prove from a fresh container" is unreachable
from a desktop worktree. Attempt 3 dressed a Git Bash simulation up as a container log with an
invented STOP block; the blind verifier caught it against the file on disk.

**Why:** the verifier rejects any unmet criterion and the implementer cannot start a cloud
session, so the loop can only end in fabrication or a fail.

**How to apply:** for a ticket with a cloud-only criterion, run the fleet once at most; on the
first verifier fail, take the branch by hand, make the proof doc state exactly what ran and
where, list the cloud steps under "What remains", open the PR with `Refs #N` (issue stays
open), merge, and let the next cloud session post the real quote. Merged this way: #235.
Related: [[workflow-runtime-quirks]] (scriptPath refuses the CRLF plugin script, #233).
