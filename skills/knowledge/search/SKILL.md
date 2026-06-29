---
name: search
description: Search across connected sources and synthesize what was found. Use when the user asks to find a document, decision, discussion, source, status, policy, or prior context that may live across chat, email, files, notes, project trackers, or knowledge bases.
---

# Search

Search connected sources as a coordinated research task, then answer with source-grounded results.

## Workflow

1. Identify what the user is looking for: decision, status, document, person, policy, discussion, or broad context.
2. Inspect the available tools and sources. Do not assume a source is connected just because it would be useful.
3. Break the request into targeted searches per available source. Use exact keywords for names, acronyms, filenames, and quoted phrases; use semantic queries for concepts, decisions, and fuzzy recollections.
4. Run independent searches in parallel when the tool surface allows it.
5. Read enough of the best results to verify relevance. Do not answer from search-result snippets alone when the source can be opened.
6. Synthesize the answer with citations or clear source attribution. Mention gaps, stale results, or conflicts instead of smoothing them over.

## Query Shaping

- Preserve user-provided filters such as author, project, channel/folder, file type, and date range.
- Generate synonyms for likely aliases: product names, acronyms, team names, and renamed projects.
- For decision questions, prioritize meeting notes, thread conclusions, explicit approvals, and later confirmation messages.
- For status questions, prioritize recent task/project records and recent discussion.
- For document questions, prioritize file names, titles, and folder paths before broad semantic search.

## Output

Return the answer first, then a compact source list. If nothing relevant is found, say where you searched and what would help narrow the search.
