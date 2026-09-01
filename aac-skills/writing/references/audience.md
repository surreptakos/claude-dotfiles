# Audience — Recipient Test

Every sentence and bullet must serve the recipient's next action, not reassure the writer. Anti-pattern: writing to the reviewer of the piece instead of to the person who has to act on it.

Apply during the cut pass. When a sentence only serves the writer, delete on sight. Do not rephrase.

## The five patterns to cut

1. **Meta-reasoning about the piece** — explains why the writer wrote it, apologizes for length, restates what was just said. (Also covered by the base cut rule.)
2. **Writer-facing reassurance** — defensive scope reminders, "the constraint here is…" openers that repeat what the ask below already carries. Written to prove the writer thought about it, not to move the recipient.
3. **Redundant confirmation requests** — asking the recipient to confirm something the delivery itself proves. "Attached is the report — please confirm you received the report." Delivery is the confirmation.
4. **Header-label restatement** — the first line of a section repeating the header. "`Type: shared mailbox`" under a heading titled "Shared mailbox".
5. **Unverified source-copy** — names, scope, delegates, or numbers copied verbatim from a source ticket, spec, or prior draft without checking they match real use. When these come from a written source, verify against reality before drafting; ask when unsure.

## Examples

### 1. Meta-reasoning

Before:
> I want to lay out the plan below because we've talked past each other twice on this. The scope of what I'm proposing is intentionally narrow. Here is what I have in mind.
>
> Ship the read-only viewer first, then add editing in a follow-up.

After:
> Ship the read-only viewer first, then add editing in a follow-up.

### 2. Writer-facing reassurance

Before:
> The constraint here is that we can only touch the payload, not the render layer. With that in mind, can you add `dealAgeDays` to `boardData_`?

After:
> Please add `dealAgeDays` to `boardData_`.

("Payload only" is the standing rule; naming it again reassures the writer, not the reader.)

### 3. Redundant confirmation

Before:
> Attached is the signed W-9. Please confirm you received the W-9 so I know it went through.

After:
> Attached is the signed W-9.

(If the send fails, the recipient will say so. Asking to confirm the send is writer-anxiety.)

### 4. Header-label restatement

Before:
> ## Shared mailbox
>
> Type: shared mailbox.
> Owner: ops@.
> Purpose: intake for AP invoices.

After:
> ## Shared mailbox
>
> Owner: ops@.
> Purpose: intake for AP invoices.

### 5. Unverified source-copy

Before (copied from an old ticket that named the wrong delegate):
> Assigning to @rlanders per ticket #211.

After (checked the roster: rlanders left in May):
> Assigning to @kmoore — @rlanders is off the roster.

## Detection heuristic (audit mode)

Flag a bullet or sentence if any is true:

- restates the header label immediately above it,
- asks the recipient to confirm something the same message already delivers,
- opens with reasoning the body's structure already conveys,
- names people, scope, or numbers traceable to a source ticket or spec without a note that real use was checked.
