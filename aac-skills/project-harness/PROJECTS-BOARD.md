# Projects board — the `gh project` traps

Reference for step 5 of [`SKILL.md`](SKILL.md). Every trap below produced a wrong conclusion at
least once; each rule is what to do instead.

## Auto-add is the owner's toggle, and only a filed issue proves it

The "Auto-add to project" workflow is what keeps the board current after install day. Adding today's
open issues is a snapshot: every later issue needs a manual `gh project item-add`, and
`tracker-audit.js` reports each one missed as `not-on-board`.

- **Linking a project to a repo is a separate feature from auto-add.** Linking puts the board in the
  repo's Projects tab and makes `repository.projectsV2` return it, so it reads as sufficient; an issue
  filed with linking on and the workflow off lands on no board.
- **The filter and scope decide it, not the toggle.** A first enable can still leave new issues off
  the board; once the filter is right a card appears within seconds.
- **The toggle is readable, the filter is not.** GraphQL
  `projectV2 { workflows(first: 20) { nodes { name enabled } } }` returns each built-in workflow's
  `enabled` flag; `gh project` has no subcommand for it, and the repo filter behind auto-add is
  exposed nowhere. A wrong filter pulls another repo's issues onto the board (52 of
  aac-sales-cockpit's once landed on two other boards). So `enabled: true` is a precondition: the
  verification is to file an issue, run `gh issue view <n> --json projectItems`, and confirm it
  landed on the intended board and on *only* that board.
- If `not-on-board` findings reappear later, re-check the workflow.
- Auto-add catches only issues created after it was enabled; `item-add` stays the backfill path.

## Finding and editing cards

- **`gh issue view --json projectItems` returns `status` and `title` only, never the item id.** To
  edit a card, get the `PVTI_…` id from GraphQL on the project node:
  `node(id:"PVT_…"){... on ProjectV2{items(first:100){nodes{id content{... on Issue{number}}}}}}`.
  An empty id fails as `Could not resolve to a node with the global id of ''`.
- **`repository.projectsV2` lists only projects LINKED to the repo.** An owner-level board holding the
  repo's issues is missing from it. Infer board use from the issues: any issue with a `projectItems`
  entry means a board is in play.

## Adding and counting

- **Verify an add with `gh issue view <n> --json projectItems`.** `gh project item-list` can report
  `totalCount: 0` for a board that holds the card. `item-add` is idempotent per issue, so a repeat
  never creates a second card.
- **Space bulk adds ~1s apart and verify the total.** Back-to-back `item-add` calls can each exit 0
  and still drop cards (15 calls once landed 2). After any bulk add, count independently — GraphQL
  `node(id:"<PVT_...>") { ... on ProjectV2 { items(first:N){ totalCount } } }`, or `issue view`
  per issue — and re-add whatever is missing.
