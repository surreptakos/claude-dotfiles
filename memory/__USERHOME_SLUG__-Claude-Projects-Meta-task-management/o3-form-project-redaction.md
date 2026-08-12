---
name: o3-form-project-redaction
description: "O3-form rule (Phase 3 render o3): a task in a direct's project belongs on their O3 form; if it's in the NON-shared version of that project it goes ONLY on the eyes-only form, never the shared one."
metadata: 
  node_type: memory
  type: project
  originSessionId: 139aab06-0c78-41ac-9748-31d76f57fa8d
  modified: 2026-07-23T00:10:34.753Z
---

Dan's rule for generating O3 forms (Phase 3, `render o3`, tickets 30–32; ties to
the shareable/eyes_only redaction split):

- **Any task in a direct's project must appear on that direct's O3 form.**
- **But respect which version of the project it's in.** A direct's work exists in
  two versions: the one **shared with them** (e.g. the "<Name> - Shared" Todoist
  projects, `kind: shared` in `config/projects.yaml`) and a version **NOT shared
  with them** (Dan's own / eyes-only copy).
  - Task in the SHARED version → may go on the **shared** (black / `shareable`)
    O3 form the direct sees.
  - Task in the NON-shared version → goes ONLY on the **"my eyes only"** (red /
    `eyes_only`) O3 form, **never** the shared version.

So the project a task lives in — shared vs. not-shared — decides the redaction
band of its O3 line. Apply this when building the O3 red/black split in
`aacx/render/o3.py`. See [[one-brain-plan]] (Phase 3 = view parity + O3 cutover).
Stated by Dan 2026-07-22.
