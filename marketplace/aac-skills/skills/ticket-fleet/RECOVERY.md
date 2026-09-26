# ticket-fleet: recovering a dead run

Reached from SKILL.md when a wave died before it delivered. Both paths hand the dead run's own results back rather than re-running finished work.

## Finishing a run whose verifiers died

A run can lose every verifier after its implementers have already committed their branches.
The runtime's own resume does not recover that: the cache key of an `isolation: 'worktree'`
agent includes the worktree slot the runtime assigned, and a resumed run assigns new slots, so
the replay starts a fresh implementer inside another ticket's slot. Hand the finished results
back instead:

- `priorImpl`: `{<ticket number>: <IMPL-shaped result>}` - `{branch, committed, pushed,
  testExitCode, testTail, discoveries}`. An entry from a journal written before `pushed` existed
  simply reads as not-pushed, and the run pushes that branch itself before verifying it.
- `priorProbe`: `{<ticket number>: <PROBE-shaped result>}` - `{items, blocked, discoveries}`.

A ticket with an entry skips its **attempt-1** implementer or prober entirely - the recorded
result is used as-is and the reuse is logged (`reusing prior implementer result from
args.priorImpl (branch ...)`). Everything downstream is unchanged: the verifier still runs
blind against the branch, and attempt 2+ re-implements or re-probes normally, so a reused
branch the verifier refutes is retried exactly as a fresh one would be. The Scout-phase open-PR
scan still runs first, so a ticket handed in from a dead run that already has a PR is dropped
before the entry is read.

The values come from the dead run's `journal.jsonl`, which carries one `result` line per
agent label - `impl:#<N>.1` for the code lane, `probe:#<N>.1` for the probe lane. Take the
attempt-1 line per ticket, key it by the ticket number in the label, and pass the structured
result as the value:

```json
{
  "priorImpl": {
    "274": { "branch": "agent/issue-274-attempt1-wf_dd0cf9a4091-w0", "committed": true,
             "testExitCode": 0, "testTail": "# pass 31\n# fail 0", "discoveries": [] }
  }
}
```

Pass the same `tickets` list as the dead run, a **new** `runId` (branch names for any ticket
that does re-implement must not collide with the dead run's), and the `testCommand` the dead
run should have used. An entry whose `committed` is false, or a probe entry with no items, is
treated as a failed attempt 1: attempt 2 runs the stage normally.

## Finishing a run whose Deliver step died

The other half of the same problem (issue 405). A verified branch used to exist nowhere but the
container that made it: the Deliver step was the first thing to push it, so a container restart
mid-Deliver, a deliverer that reported the branch "does not exist" without ever pushing, or an
interrupt during Verify each ended with committed, verified work nobody could reach. Two things
close that:

- **The branch is pushed at implement time.** The implementer runs `git push -u origin <branch>`
  as soon as the commit lands and reports `pushed`; when it did not (or could not), the run
  starts a one-command `push:#<N>.<attempt>` agent of its own - before the verifier, so the
  branch is on origin for every stage after it. The Deliver step still pushes, and is told to
  fail loudly with the git output rather than conclude the branch is missing.
- **`finishRunId` replays a dead run's journal.** The launch runs delivery only:

```
Workflow({
  scriptPath: 'aac-skills/ticket-fleet/ticket-fleet.js',
  args: { contractVersion: 2, runId: '<hex>', invocationId: '<fresh hex>', finishRunId: 'wf_6aaacc32-c84' }
})
```

`finishRunId` takes either spelling of the dead run's id: the harness workflow id its journal
directory is named for (`wf_...`), or the caller-minted `runId` its branch names embed. A
`journal-read` agent finds `~/.claude/projects/<project>/<session>/subagents/workflows/<run>/journal.jsonl`,
pairs each `started` label with its `result` by `agentId`, and reports per ticket whether a
verifier passed, on which branch, and whether a `deliver:#<N>` result recorded a PR or comment
URL. Then, per ticket: **delivered** ones are skipped naming the PR they already have,
**unverified** ones are left alone (a finish pass never delivers what no verifier passed - re-run
the fleet on those), and **verified-but-undelivered** ones go through the ordinary Deliver
prompt, with one extra instruction: reuse an open PR for that branch if one exists rather than
open a second, which makes a finish pass safe to repeat. Finally the report writer runs over the
journal's discoveries, so a dead run's follow-ups still land.

The run must happen where the dead run ran: the journal is machine-local and dies with its
container. It starts no scout, no implementer, no prober and no verifier, so a finish pass costs
one journal read plus one deliverer per undelivered branch.
