---
name: audit-code-changes
description: Implements code changes and runs a structural + behavioral audit afterward to catch bugs that syntax checking misses — out-of-scope variables, signature/caller drift, stale references after a rename, dropped field consumers, hardcoded literals that should follow a constant, plus behavioral failure modes the compiler can't see (missing failure-boundary guards on external calls, broken assumptions about call order, non-idempotent retries, logic that passes structural checks but fails the user's intent). Use whenever the user gives a coding task that modifies existing code (refactor, edit, fix, rename, drop a field, add a parameter, change a layout, add a retry, integrate with an API), especially in dynamic languages where the compiler doesn't catch these at edit time (JavaScript, Apps Script, Python, Ruby, TypeScript). Trigger even when the change seems small — the audit catches latent bugs that compound across edits, and `node --check` / `python -m py_compile` only validates parser-level syntax.
---

# Audit Code Changes

Implement the code changes the user describes, then run a two-phase audit before declaring the work complete:

- **Structural audit (1–6)** catches mechanical errors that interpreted-language compilers miss: undefined variables, signature drift, stale references after a refactor, hardcoded constants, missing fields.
- **Behavioral audit (7–10)** catches errors the compiler can't see at all: lost intent, unhandled failure paths from external dependencies, broken state assumptions, non-idempotent retries, and stale or shallow tests.

Treat the audit as a non-negotiable step. Skipping it and letting the runtime catch the error means the user pays the round-trip cost (run → error → copy stack trace → send back → wait for fix) every time. Surfacing logic bugs at the user's first run instead of before saving wastes their time and breaks their flow.

## Implementation phase

Make the code changes the user requested. Use file-editing tools (`str_replace`, `create_file`, etc.) as appropriate. Save work-in-progress freely. **Do not declare the work complete or present the file** — proceed to the audit.

## Audit phase

After every implementation, before saying "done" or calling `present_files`, run these checks in order. Stop and fix anything that turns up before moving to the next check. If a fix to one check could affect an earlier check, re-run from the top.

### Structural checks

#### 1. Syntax check (parser-level)

Run the language's syntax checker on the modified file. This is the fast pre-filter — a fail here means stop immediately and fix.

- JavaScript / Apps Script (`.gs`, `.js`): `cp file.gs /tmp/file.js && node --check /tmp/file.js`
- TypeScript: `tsc --noEmit <file>`
- Python: `python -m py_compile <file>`
- Ruby: `ruby -c <file>`

A pass here means the file parses. It does NOT mean variables resolve, calls match, or fields exist. Continue.

#### 2. Signature / caller drift

If any function signature changed in this session — added param, removed param, reordered params, renamed function — grep every call site and verify the argument count and order match the new signature.

```bash
grep -n "functionName(" path/to/file
```

For each call site, mentally walk the arguments against the new signature. Update any mismatches. Pay special attention to call sites that pass `null` or `undefined` as a positional placeholder — those are easy to drift without `node --check` complaining.

#### 3. Identifier scope check

For every new block of code (closure, inner function, IIFE, callback) added in this session, enumerate every identifier the block references. Verify each resolves to one of:

- a parameter of an enclosing function
- a local declared in an enclosing scope
- a global helper or constant defined in the file
- a language built-in (`Math`, `Array`, `console`, `Date`, etc.)

```bash
# Crude but effective enumeration over a block of lines
awk 'NR>=START && NR<=END' file | grep -oE "\b[a-zA-Z_][a-zA-Z0-9_]*\b" | sort -u
```

For each identifier on that list, search for its definition:

```bash
grep -n "var IDENT\|let IDENT\|const IDENT\|function IDENT\|IDENT *=" file
```

If an identifier doesn't resolve to an in-scope definition, that's a bug — fix it by adding the param, declaring locally, or threading it through.

This check catches the most insidious class of bug: a function uses a name that *would have* been in scope before a refactor moved the code or changed the signature, but isn't anymore. The syntax checker has no opinion on this.

#### 4. Dropped / renamed field consumers

If any field, property, or column was dropped, renamed, or had its type changed, grep for every reference to the old name in the file.

```bash
grep -n "\boldFieldName\b" path/to/file
```

Every match needs to be one of:
- updated to the new name
- removed (the consumer no longer needs that field)
- confirmed safe (the match is unrelated — e.g., a comment, a different namespace)

Missing this is how `obj.deletedField` ships and silently returns `undefined` at runtime.

#### 5. Hardcoded literals that should be constants

If a constant changed value (e.g., `PERF_NC: 13 → 14`, `BUFFER_SIZE: 1024 → 4096`, `MAX_RETRIES: 3 → 5`), grep for the OLD value as a hardcoded literal in the same file.

```bash
grep -nE "\b13\b" path/to/file
```

Most matches will be unrelated (loop counters, indices, magic numbers in different contexts). The ones that aren't — pad-to-N, slice ranges, column-index assertions — need to switch to the constant.

#### 6. New field access verification

If new code reads a field on an existing data structure (`ms.newField`, `record.computedAt`, etc.), verify the field is actually set somewhere upstream by grepping the structure's construction site:

```bash
grep -n "rows.push\|return {" path/to/source-file
```

Read the object literal and confirm the field is present. If absent, the new code reads `undefined` — fix by setting the field upstream or computing it locally.

### Behavioral checks

#### 7. Happy-path logic trace

Pick one realistic input — a representative row, a typical call, a normal user action — and mentally walk it through the code paths you touched. Confirm two things:

- the data flows through every transformation as intended (correct field used, transformation in the right direction, edge cases handled)
- the final output actually satisfies the user's original request

Structural checks (1–6) verify the code is correctly *connected*. They don't verify the code does the *right thing*. It's possible to ship a clean, well-scoped implementation that solves a different problem than the one asked — wrong field summed, sort order reversed, filter inverted. The trace is the cheap insurance against that.

If the change touches multiple paths, trace each one separately. If the change is a refactor with no intended behavior change, trace one representative case and confirm the output matches what the pre-refactor code would have produced.

#### 8. Failure boundary check

Identify every point where your code touches something it doesn't own — APIs, file system, database, third-party service, another module, user input, environment variables, time. For each touchpoint added or modified in this session, ask:

- What if it returns `null` / `undefined` / `[]`?
- What if it throws?
- What if it returns the right type but the wrong shape (missing field, extra field, off-by-one length)?
- What if it succeeds but with a value that indicates a domain-level failure (a 4xx body, an "OK" string with an error payload, an empty result set)?

If the surrounding code can't survive any of those, add a guard, a try/catch, or a default. The "mocker's trap" is assuming the dependency behaves the way it does in your head — production data and production failure modes are messier.

```bash
# Crude search for external touchpoints in changed code
grep -nE "fetch\(|\.get\(|http|exec\(|spawn\(|readFile|writeFile|query\(|\.api\.|Service\.|Client\." <file>
```

If you wrap something in try/catch, be specific about which errors are retryable vs terminal (a 5xx is worth a retry; a 401 isn't — auth doesn't get better on retry).

#### 9. State and side-effect audit

If your change reads or writes state visible to other code, check three things:

- **Call order**: Does this code assume some other function ran first (an `init()`, a phase-1 calculation, a parameter populated upstream)? If yes, is that order enforced by the call site, or is it a convention you're trusting? If it's a convention, add a guard or a comment that names the assumption.
- **Shared mutation**: Did you mutate a shared object, a closure variable, or a module-level singleton that other code holds a reference to? Aliasing bugs are nearly invisible at edit time and surface days later as "this worked yesterday." Prefer returning a new value over mutating shared state.
- **Idempotency**: If this code runs twice (retry, double-click, replayed event, cron overrun, user reload), does the second run corrupt what the first run produced? If yes, add a guard (existence check, dedup key, lock, idempotency token).

#### 10. Test reality check (only if a test suite exists)

If the file has companion tests (`*.test.js`, `*_test.py`, `*.spec.ts`, etc.):

- If you updated a mock, does the mock still reflect what the real service does **today** — not what it did when the test was originally written? Mocks rot silently.
- Do existing assertions check the *value* of the result, or just that a function was called? "Called" assertions tend to silently pass through wrong values and lull you into a false sense of safety.
- Is there at least one test case for bad input (null, empty, wrong type, error response) covering the new logic? "Happy path only" tests miss the cases that actually fire in production.

If no test suite exists, skip this check.

## When all checks pass

Save the file to the appropriate output location (e.g., `/mnt/user-data/outputs/`) and present it via `present_files`. Only now is the work complete.

## When to surface the audit to the user

Default: **don't**. The audit is the author's discipline, not the user's status update. Just fix what the audit finds and present clean work.

Surface only when:

- A check reveals something that needs the user's decision (e.g., "this field appears to be missing from the data structure — was that intentional?")
- The user asked you to walk them through the validation
- The fix requires reverting a change the user explicitly requested
- **An assumption surfaced that the user should know about.** If the code now assumes something that isn't enforced — "this only works if `config` is loaded before this runs" or "this assumes the rep array is non-empty" — say so. Better to flag the assumption and the guard you added than to bury both in a comment. Phrase it: *"Implemented assuming X is true; I added a guard for when it isn't, but you should know about that path."*

## When not to use this skill

- Brand new file with no callers, no existing data structures referenced — no audit surface area
- Pure utility commands the user asked you to run (`grep`, `sed`, `find`)
- Strictly-typed languages with a real compiler running on every save (Rust, Go, modern Java/Kotlin/Swift) — those catch most of checks 2–6 at edit time, though 7–10 still apply

## Example flows

### Structural-heavy: dropping a column

User: "Drop the `projSales` column from the team summary writer and add a `mixPct` column."

1. Make the edits (drop the header entry, drop the value push, drop the accumulator, add new header, add new value computation, update the totals row).
2. **Audit:**
   - **Structural 1–3**: syntax passes; no signature changed; new closure identifiers (`ms`, `pjGP`, `num`, `fmtPct`) all resolve — `ms` is the forEach param, `num`/`fmtPct` are global helpers, `pjGP` is a local just declared above. ✓
   - **Structural 4**: `grep -n "projSales" file` → finds two stale references in the totals row that still reference `totProjSales`. Fix.
   - **Structural 5**: `PERF_NC` was 13, now 14. `grep -nE "\b13\b"` finds three stale comments. Fix the misleading ones.
   - **Structural 6**: `mixPct` is computed locally, not read from a structure. Skip.
   - **Behavioral 7**: Walk one rep's row through the new code. `mixPct` renders as expected, no division-by-zero when the denominator is 0 (covered by the `mixOrDash` helper). The TOTAL row sums what the user wanted. ✓
   - **Behavioral 8 / 9**: No new external touchpoints, no shared state mutation, computation is pure. Skip.
   - **Behavioral 10**: No test suite. Skip.
3. Save and present.

### Behavioral-heavy: adding retry logic

User: "Add retry logic to the `fetchUser` function."

1. Wrap the call in a loop with try/catch. Use exponential backoff.
2. **Audit:**
   - **Structural 1–6**: all pass — no signature/field/scope/literal issues.
   - **Behavioral 7 (happy path)**: Trace a successful first call — returns immediately without entering the retry loop. ✓
   - **Behavioral 8 (failure boundary)**: What if `fetchUser` throws a 401? Retrying won't help — auth doesn't get better on retry. Fix: only retry on 5xx and network/timeout errors; pass 4xx through immediately. What if it returns `null` on missing user? That's a legitimate "no such user" — don't retry, don't error. Fix: distinguish error types before deciding to retry.
   - **Behavioral 9 (state)**: If a UI spinner is set before the call, will it clear if all retries fail? Move the cleanup into a `finally` block so it runs whether the retries succeed or exhaust.
   - **Behavioral 10**: Test suite exists. The current mock only returns success — update it to simulate retry scenarios. Add a negative test for `5xx-then-success` (retries should kick in) and one for permanent `401` (should fail fast, not retry three times).
3. Save. **Surface to user** because assumptions were made about which errors are retryable: *"Added retry on 5xx and timeouts only — 4xx errors return immediately so we don't burn retries on bad auth or 404. Spinner cleanup moved into `finally`. Let me know if you want different retry semantics on specific status codes."*

The user sees clean working code with the design tradeoffs called out, not a stack trace and not silent assumptions buried in the diff.
