---
name: aac-registry
description: Find where an Active Alarm Company (AAC) fact lives, and who may change it, by reading the aac-nexus registry live before answering. Use for any question about where a company fact, price, policy, standard, document, or approver lives, who owns or approves it, which copy is the authority, or "where do RMR prices live?". Also use before quoting a company fact from memory.
metadata:
  modified: "2026-10-02T23:56:58Z"
  previous-modified: "none"
  revision: "1"
  content-sha: "a7f4d8247d3e"
---

# aac-registry

The aac-nexus registry, `registry.yaml` on its `master` branch, records where each AAC fact lives
and who may change it. Each row names one **fact kind**, its **authority** (the one place that is
right when copies disagree), its owner, how to read it, its audience tier, its status, and, where
they exist, the copies that are **not the authority**. This skill carries instructions only: no
row is copied here (nexus ADR 0004), so every answer comes from a live read. Never answer from
memory or from an earlier read in another session.

## 1. Read the registry live

Read `registry.yaml` from `master`, in this order, and stop at the first that works:

1. **gh** (desktop, and any session where gh is signed in):

   ```bash
   gh api repos/surreptakos/aac-nexus/contents/registry.yaml -H "Accept: application/vnd.github.raw" > <scratch>/registry.yaml
   gh api repos/surreptakos/aac-nexus/commits/master --jq .sha
   ```

2. **The attached checkout** (cloud session with aac-nexus attached): find the checkout whose
   `git remote get-url origin` names `surreptakos/aac-nexus`, then read `master` as the remote
   holds it, never the working tree, which may sit on a branch with unmerged rows:

   ```bash
   git -C <nexus checkout> fetch origin master
   git -C <nexus checkout> show FETCH_HEAD:registry.yaml > <scratch>/registry.yaml
   git -C <nexus checkout> rev-parse FETCH_HEAD
   ```

Keep the commit SHA: the answer names it. `REGISTRY.md` on the `registry` branch is a page
generated from this file, and a dashboard, a memory note, or a plugin file is not the registry.
Never read any of them in place of `registry.yaml`.

Done when `<scratch>/registry.yaml` holds the file and you have the commit it came from.

## 2. When nexus is unreachable, stop

If neither read works (gh missing, signed out, or refused, and no aac-nexus checkout attached, or
its fetch fails), do not guess, do not answer from memory, and do not fall back to a copy. Reply
with this line, filling in what failed, and end the turn:

`aac-nexus unreachable: <what failed, quoted>. I cannot say where <fact> lives without the live registry; attach surreptakos/aac-nexus or sign gh in, then ask again.`

Done when that line is sent and nothing else about the fact is claimed.

## 3. Open only the rows the task needs

Search the file for the fact the task names, by the words in each row's `id` and `fact_kind`
(`grep -n -i '<word>' <scratch>/registry.yaml`), then read only the matching rows in full. Do not
print, summarise, or paste the whole file, and do not open rows the task does not need. A
`fact_kind` may say what the row is not ("not the ... rule in ..."); read it before choosing.

If no row covers the fact, say the registry has no row for it at that commit and stop. A comment,
a note in another row, or an ADR mentioning the fact is not a row.

Done when you hold the one row (or the few rows) the task needs, or know there is none.

## 4. Answer from the row

Reply with what the row says, in its words:

- **Where it lives:** the `authority`, and `how_to_read` for how to open it.
- **Who may change it:** the `owner`.
- **Status:** `active` rows are in force from their `effective_date`; a `draft` row is recorded
  but not in force, so say so and give its `how_to_read`; a `retired` row is history.
- **Not the authority:** name any `not_authority` copy the task might otherwise reach for.
- **Read at:** the commit SHA from step 1.

A `pointer` row says where the fact lives, not what it is. When the task needs the fact itself (a
price, a rate, a rule), open the authority the row names and read it there. For a money term, a
policy that changes a quote, HR or payroll, customer or deal data, or two sources that disagree,
read the authority live or stop and say so (nexus ADR 0004).

An `audience: owner` row is for Dan and agents working for him. Do not repeat it to anyone else.

Done when the answer names the authority, the owner, the status and the commit, and claims
nothing the row does not say.

## Changing the registry

This skill reads; it never writes. A row changes by a pull request to aac-nexus that edits
`registry.yaml` (see `/file-it`, form registry-row).
