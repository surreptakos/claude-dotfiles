# Technical Writing: False Positive Guide

## When to Use This Guide

This guide applies when writing or reviewing:

- API documentation
- Technical specifications
- Product requirements (PRDs)
- Architecture decision records (ADRs)
- Code comments and READMEs
- Configuration guides

For casual/blog prose, ignore this guide. Use the core Stop Slop rules.

## Patterns That Are OK in Technical Docs

| Pattern | When OK | Still Slop in |
|---------|---------|----------------|
| `robust`, `comprehensive` | Describing system qualities, test coverage, error handling | Marketing copy, casual prose |
| `ecosystem` | Describing plugin/extension systems, package managers | Business jargon contexts |
| `facilitate`, `streamline` | Process descriptions, workflow automation | Casual prose, blog posts |
| 3+ item lists | API parameters, config options, enum values, dependencies | Narrative prose |
| Passive voice | Actor unknown ("the data is encrypted"), actor irrelevant ("the request is sent") | Most other contexts |
| Hedging (`may`, `might`, `typically`) | True uncertainty (platform differences, edge cases) | False modesty, performative humility |
| `actually` | Correcting a previous statement ("Actually, the method returns an array") | Empty emphasis |
| `simply` | Describing a straightforward operation ("simply call the method") | Downplaying complexity |

## What to Keep in Technical Writing

- Code blocks, config examples, terminal output
- Bulleted and numbered specs
- Tables (not flagged by Stop Slop, but sometimes removed, so keep them)
- Technical accuracy over stylistic purity
- Domain-specific terminology even if it matches slop patterns

## What to Still Flag (Even in Technical Docs)

| Pattern | Why Still Slop |
|---------|----------------|
| Throat-clearing ("Here's the thing about APIs...") | Waste of space |
| Binary contrasts ("Not because X, because Y") | Predictable |
| Dramatic fragmentation ("Speed. Quality. Cost.") | Performative |
| Empty intensifiers ("really", "very", "literally") | No meaning |
| Narrator-from-a-distance ("Nobody designed this system") | Put the reader in the room |
| False agency ("The code decides") | Code doesn't decide. A person wrote it. |

## Detecting vs Rewriting

In technical writing, **detect-only mode** is often preferable:

- Terms like "may" are sometimes correct (spec compliance)
- Passive voice is sometimes required (security docs avoid naming actors)
- Technical accuracy > stylistic perfection

## How to Override

To keep a flagged phrase without disabling detection globally, add `[keep]` on the same line:

```
The request is processed asynchronously. [keep]
```
