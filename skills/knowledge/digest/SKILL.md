---
name: digest
description: Generate a concise activity digest from connected sources. Use when the user wants to catch up, review recent decisions, summarize changes since a date, prepare for the day/week, or identify mentions, action items, document updates, and open questions.
---

# Digest

Create a source-grounded catch-up brief from recent activity.

## Workflow

1. Determine the time window. Use the user's stated range; otherwise default to the most relevant recent period for the request.
2. Check which sources are available. Search only connected sources.
3. Gather recent activity from each relevant source: messages, threads, emails, documents, tasks, comments, and knowledge-base updates.
4. Group findings by project, topic, or urgency. Deduplicate repeated announcements and cross-posts.
5. Extract action items, decisions, blockers, document changes, and unresolved questions.
6. Cite or attribute each substantive item to its source.

## Prioritization

- Put direct requests to the user and time-sensitive decisions first.
- Prefer newer information for status, but prefer authoritative sources for policy or factual reference.
- Mark uncertainty when a thread is unresolved or sources conflict.
- Keep low-signal activity out of the main digest unless the user asked for exhaustive coverage.

## Output

Use this structure by default:

```markdown
## Digest

### Needs attention

- ...

### Decisions and updates

- ...

### Documents and references

- ...

### Open questions

- ...

Sources: ...
```
