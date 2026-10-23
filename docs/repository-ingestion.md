# Knowledge-base ingestion and retrieval

`features/repository` owns file paths, ingestion, indexing, retrieval, and the
read-only repository tools. Its ingestion and retrieval helpers depend on
`RepositoryFile`, `RepositoryFileStore`, and injected client operations, with no dependency on
the `Agent` type or React.

`AgentProvider` binds a repository to its owning agent and supplies the job
lifetime and persistence callbacks. `useAgentFiles` is a small adapter for UI
consumers. Selecting another agent or closing an upload UI does not change the
destination of an existing upload. Deleting a file or its agent cancels its jobs.
Wizard upload batches capture the newly created agent's ID immediately.

The store is addressed by repository ID and the embedding-model lookup receives
that same ID. This lets a future repository catalog supply shared sources to
multiple consumers. Today the adapter uses the agent ID and configured default
model. Shared repository storage and chat attachments are separate future work;
this change introduces neither data migration nor a chat attachment feature.

## Storage

The code boundary does not require a new storage layout. Each agent currently
owns one knowledge base, stored in OPFS at:

```text
agents/{agentId}/
  AGENTS.md
  files/
    index.json                   # authoritative file membership
    {fileId}/
      metadata.json              # identity, path, status, embedding models
      content.txt                # extracted text
      segments.json              # ordered passage text
      embeddings.bin             # vector dimension followed by Float32 vectors
```

Chat artifacts remain under `chats/{chatId}/artifacts/`. Older `repositories/`
archives are handled at import time.

## Job behavior

- One provider owns the jobs for all its UI consumers. Synchronous insertion
  reserves a path before conversion starts, including simultaneous uploads.
- Each job captures the requested embedding model before conversion and has an
  abort signal connected to extraction, segmentation, and embedding requests.
  Built-in document conversion may finish after cancellation; its output is
  discarded and no later stage starts.
- Extracted text is checkpointed while the file is still processing so indexing
  can be retried after a failure or reload. Partial vectors are never published.
- Up to ten embedding requests run concurrently per file. The first failure
  stops new requests, aborts active siblings, and waits for them to settle before
  publishing an error. Responses are assembled in source order.
- Completion publishes the full text, vectors, and model provenance together
  and awaits the persistence queue. State updates are optimistic; a reported
  persistence failure marks the job as failed. Agent storage provides rollback
  for reported multi-file I/O failures, as described in `persistence.md`.
- Progress stays below 100 until all embeddings are valid. Upload date, file ID,
  and path remain stable throughout processing and reindexing. An error keeps
  extracted text for retry. If conversion never completed, upload the source again.
- A loaded processing/pending record becomes an interrupted error in memory;
  loading does not rewrite stored data. Reindexing is an explicit user action.

## Embedding compatibility and search

Metadata records both the requested model (an empty string means the backend
default) and the resolved model returned by the backend. Inconsistent models or
dimensions within a file, empty/non-finite vectors, and values that overflow
Float32 are rejected. Unsupported binary inputs require a configured extractor.

Search uses completed files directly rather than maintaining another mutable
vector database in every hook. It checks model compatibility, requests one query
embedding, then reads current file membership again before ranking. Deleted or
unfinished files cannot appear through a stale closure. File IDs need no delimiter
format. Backend default-model changes are detected even if dimensions are equal.
Repository search forwards the tool run's cancellation signal to the query request.

Old files without model provenance and files indexed with another configured
model require **Reindex** in the Knowledge Base. Extracted text remains available
to repository read/grep/glob tools. Search reports the need to reindex rather than
silently comparing incompatible spaces or omitting incompatible completed files.

Model identity is limited to the model ID the backend reports: a backend that
changes weights while keeping the same ID and dimensions cannot be detected here.
