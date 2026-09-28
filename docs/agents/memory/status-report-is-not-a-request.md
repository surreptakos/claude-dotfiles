---
name: status-report-is-not-a-request
description: A terse past-tense line from Dan ("messages sent to X") reports work he did; check Teams or mail before reading it as an ask
metadata:
  type: feedback
---

A short line from Dan in past tense ("messages sent to my team to the people that need to do it")
reports something he already did. It is not a request to do it. On 2026-09-28 a session read that
line as "send these messages", then searched for addresses and asked to send from his personal Gmail.
Dan had already sent all three over Teams, and the connector's Chat.Read could have shown that.

**Why:** the session trusted its own reading of an ambiguous sentence as the source. The source
was Dan's Teams sent messages, which the Microsoft 365 connector reads (`chat_message_search`).

**How to apply:** when a message could be a report or a request, search Teams and Outlook for what
Dan sent in the last hour before acting. Record what is found on the tickets. Ask only if the search
shows nothing. See [[answer-yes-no-in-one-line]].
