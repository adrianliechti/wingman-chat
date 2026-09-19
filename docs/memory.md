# Agent memory

Enabling an agent's **Memory** switch enables both recall and background learning. Memory belongs to that agent and persists locally in the browser. The agent drawer lets you view, add, edit, and forget individual memories, or clear them all with confirmation. Loads wait for pending settings saves, so turning memory on takes effect before the manager reads it.

The **+** button beside Close accepts ordinary text. One structured-output model call organizes it into up to four OKF notes; the user never needs to enter a filename or YAML. This uses the summarizer, the agent's text model, or the first configured text model, with an 8 KiB input limit and a 45-second timeout. All results are validated and written together through the same memory manager as file tools. Existing notes are preserved, and a concurrent clear or edit cancels the result. On failure the entered text remains available to retry. Editing an individual memory changes only its plain text while preserving metadata; each sidebar entry has a Forget action.

Notes use [OKF v0.2](https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/refs/heads/main/okf/SPEC.md): Markdown with YAML frontmatter. Wingman uses a real YAML parser and preserves unknown metadata, including nested structures. This is a memory-note producer; importing executable knowledge catalogs and attested computations is outside its scope.

```markdown
---
type: Preference
title: Writing style
description: The user's general response preferences.
core: true
tags: [writing]
---

Prefer concise paragraphs unless more detail is requested.
```

The agent accesses these notes through the existing file tools:

| Virtual path                      | Persistent location                              |
| --------------------------------- | ------------------------------------------------ |
| `/.memory/index.md`               | `agents/{agentId}/memory/index.md`               |
| `/.memory/preferences/writing.md` | `agents/{agentId}/memory/preferences/writing.md` |
| `/.memory/projects/wingman.md`    | `agents/{agentId}/memory/projects/wingman.md`    |

`MemoryManager` owns validation, migration, revisions, and index generation. It regenerates root and directory `index.md` files in the same transaction as note changes. Indexes are read-only to the agent. Imported OKF logs are retained and readable. Internal jobs, checkpoints, and suppression records live in `agents/{agentId}/memory-state.json`, outside the virtual mount.

The `artifacts_read`, `grep`, `glob`, `create`, `edit`, `delete`, and `move` operations route explicitly scoped memory paths to this manager. They are available with memory enabled even when conversation artifacts are disabled. A batch or move cannot span the two storage mounts. Child agents have read access. Existing notes must be read before tools change them; stale writes fail with a request to reread. Code runtimes operate on conversation artifacts, and `/.memory/` is reserved against artifact writes.

Memory operations have their own chat labels and brain icon, including running and error states. Grouped tool summaries distinguish memory from artifact operations. Memory notes are excluded from completion attachment chips and artifact verification. Background learning updates the memory drawer without inserting synthetic tool messages into the conversation.

## Recall

Text chat loads memory before its first request and captures the selection once for the whole tool loop. Selection is local: filter by scope and lifecycle, then rank lexical matches in titles, descriptions, tags, paths, and bodies. General `core: true` preferences are included within a separate small allowance. An unrelated query can return no topic notes. The full index remains available for progressive discovery through file tools.

| Bound                                          | Value             |
| ---------------------------------------------- | ----------------- |
| Complete automatic context, including headings | 4 KiB UTF-8       |
| Core portion within that context               | 1 KiB             |
| Selected notes                                 | At most 5         |
| One file-tool response                         | 8 KiB UTF-8       |
| One saved note including frontmatter           | 8 KiB UTF-8       |
| Memory bundle                                  | 256 notes / 1 MiB |

These are hard byte bounds, not estimated token counts. Retrieval adds no embedding or model request to the answer path. Lexical retrieval can miss paraphrases and cross-language matches; semantic retrieval should be justified by evaluation.

Draft, deprecated, and expired notes are omitted from ordinary recall. Historical queries can retrieve them with lifecycle labels. Memories remain historical context: current user corrections take precedence, and changing facts need verification. Voice uses bounded core preferences and the same explicit file operations; incremental background extraction currently follows completed text-chat runs.

## Learning and evidence

After a successful text-chat run, Wingman durably queues the new text-message IDs and content hashes. It reuses existing chat storage as evidence. Aborted, failed, and unfinished runs are excluded. No extra `sourceMessageId` field is added to general tool context.

After 30 seconds without an active text-chat run in the current tab, the worker processes one job. It uses the configured summarizer model or the chat model. A shared lock prevents two tabs processing the same agent simultaneously. Queues resume when the agent is selected again, and processing requires the app to remain open.

Each extraction has a 32 KiB serialized-input limit, a 4,000-output-token request budget, a 45-second timeout, and at most four candidate notes. Up to 16 source messages are coalesced per chat job, with at most 32 queued jobs per agent. Unchanged sources are skipped. Failed jobs stop after three attempts. Starting another text-chat run interrupts this tab's worker.

The extraction policy favors no output over low-value memory. It retains reusable stated preferences, adopted decisions, corrections, and lessons; it excludes generic facts, temporary progress, secrets, unaccepted proposals, and instructions quoted in external content. Each candidate needs an actual user source from its input. Only existing notes supplied in full can be consolidated; hand-maintained notes are protected. Source versions and current note contents are checked again before committing.

Explicit file writes record a `sources[].resource` reference using the tool context's existing chat and run IDs. Automatically learned notes reference existing messages and record content hashes as OKF extension metadata. `generated` identifies the writer. The worker never invents `verified` events. The editor links chat sources back to their conversations.

Editing or removing evidence marks derived automatic notes as draft before subsequent text recall. Deliberate note edits and deletion invalidate pending learning. Durable source, path, and body-hash suppression prevents queued work and previously processed evidence from recreating forgotten content. New statements in later conversations are new evidence; suppression is not a semantic classifier for every possible paraphrase.

## Persistence and exchange

Writes use shared browser locks, revision checks, and rollback of reported I/O failures. Indexes are reconstructable. Broadcast notifications refresh open views across tabs. OPFS does not provide a multi-file browser-crash transaction; a later read repairs derived indexes, but full crash atomicity and cross-device synchronization would require additional storage support.

Existing `MEMORY.md` files first migrate into readable, bounded fallback notes. Recognized user-preference sections become core preferences. This step removes the original only after notes, indexes, and state have been written successfully.

A one-time background LLM pass then organizes those fallbacks into coherent topics and identifies general preferences. It requests faithful preservation of decisions, qualifications and references, within a 32 KiB input / 12,000-output-token budget. The response must account for every fallback file, fit the note limits, and avoid overwriting unrelated notes. The manager atomically replaces unchanged fallbacks, regenerates indexes, and records completion. Refusals, malformed output, I/O failures, and concurrent edits leave the readable fallbacks intact. Attempts are bounded and resume after reopening once a model is available. Subsequent user edits cancel a pending migration.

Common credential patterns are redacted at write and import boundaries; this is a heuristic, not a complete secret detector.

A shareable agent ZIP excludes memory by default. Explicit memory inclusion exports notes while omitting internal learning state. Collection/full backups retain internal state. Imports validate Markdown and bundle bounds before changing storage and rebuild indexes from the merged notes. Unknown structured OKF metadata survives a round trip.

Deterministic tests cover storage failure, migration, source changes, deletion, bounds, no-op learning, routing, request snapshots, and chat presentation. Browser tests cover real OPFS, cross-tab conflicts, editor changes, and the memory switch. Model quality, task success, latency, and total token savings still need a representative live-model evaluation; the architecture alone does not establish those improvements.
