# Claims tripwire — per-repo wiring for claims-audit.js

Same generic-tool/per-repo-config shape session-check uses: `claims-audit.js` travels with the
consistency-audit skill to every machine, and each repo declares its own facts in
`docs/claims.json`. Wire it once per repo, after a consistency sweep has established the truth.

## 1. Seed `docs/claims.json` from the sweep

Every fact the sweep fixed becomes a claim. Pick the smallest claim type that captures the
invariant — a `symbol-exists` or `command-single-source` claim on the load-bearing detail, rather
than an `expected-text` claim on a whole paragraph, which breaks on any edit.

```json
{
  "claims": [
    {
      "id": "test-command-single-source",
      "type": "command-single-source",
      "source": ".claude/session.json",
      "sourcePath": "test",
      "bindings": [
        { "doc": "README.md",       "occurrence": "Run `node --test tests/` before committing." },
        { "doc": "docs/runbook.md", "occurrence": "CI executes `node --test tests/` and then deploys." }
      ]
    },
    {
      "id": "public-api-symbols",
      "type": "symbol-exists",
      "doc": "docs/api.md",
      "source": "src/pipeline.js",
      "symbol": "processInvoice"
    }
  ]
}
```

The four claim types, each for the facts that fail sweeps most:

- **token-subset** — endpoint lists, flag inventories, enumerations the docs recite. The doc names
  every token; the code file emits every token; drift is one side that stopped matching.
- **symbol-exists** — API reference docs, trace files, ADRs citing a function name. Both
  directions: the doc must still cite it AND the source must still define it, so a rename that
  landed in code but not docs (and its inverse) both trip.
- **expected-text** — pinned prose the reader must see verbatim: a warning, a rule, a header a
  script parses. Use sparingly.
- **command-single-source** — commands quoted across README/runbook/CI docs whose source of truth
  is a config file (`.claude/session.json`, a workflow YAML, a package.json script). Bindings are
  explicit doc positions, so dated history files stay exempt by not being bound.

The first consumer is `aac-bill-intake` (issue 326); its seed claims are the fixtures this engine
was designed against.

## 2. Add a wrapper test

A thin test in the repo's suite — the engine already exits 1 with one line per finding.

```js
// tests/claims-audit.test.js in the consuming repo
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const ENGINE = path.join(
  require('node:os').homedir(),
  '.claude', 'skills', 'consistency-audit', 'claims-audit.js'
);

test('docs/claims.json verifies clean', () => {
  execFileSync(process.execPath, [ENGINE], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
});
```

If the repo's canonical test command is another runner (a `pytest` suite, a `powershell` runner),
shell out to the engine from that runner — the exit code is the whole contract.

## 3. Wire the wrapper into pre-commit and CI

A test that runs only on demand is a report, not a tripwire. Surface all three exit codes to the
caller, so a runner can tell "the tripwire fired" from "you pointed me at nothing":

- **0** — every claim verified clean.
- **1** — one or more findings; one tab-separated line per finding on stdout
  (`<claimId>\t<docPath>:<lineNo>\t<message>`). Broken claims land here too — an unknown `type`,
  a missing `doc`, a missing `source`, or a malformed field — so one broken claim never masks the
  rest of the audit.
- **2** — audit-level configuration error: the claims file itself is missing, is not valid JSON,
  or is not the expected shape. Anything scoped to a single claim stays at exit 1.

## 4. Extend claims.json as the world changes

A new claim is a JSON edit; the engine stays as it is. A repo needing a claim type the engine
lacks files a ticket against this skill's engine — the declarative shape exists so per-repo
config never forks the engine.
