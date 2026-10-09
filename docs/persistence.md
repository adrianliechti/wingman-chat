# Persistence contracts

The browser stores chats, agents, images, skills, and the profile in OPFS. Theme,
device selection, and OAuth state in localStorage are outside the OPFS backup.

## Writes and state ownership

- `ChatStore` owns the chat index and loaded conversations; `usePersistentCollection`
  owns the other collections' current snapshots. Each updates
  its reference synchronously, so consecutive edits in one event compose correctly.
  Initial loading preserves local additions, edits, and deletions.
- `PersistenceQueue` coalesces queued snapshots by record ID and serializes saves
  and deletions. A deletion follows an active save and replaces a queued save.
  Failed operations stay retryable. Creating or deleting one record reports that
  record's result independently of failures saving other records.
- Collection writes start within 100 ms of the first edit, including continuous
  streaming. The profile uses its configured delay. Explicit flush, hiding the
  page, going online, and unmounting attempt to finish pending writes.
- Collection and index locks use Web Locks across tabs, with an in-process fallback.
  Index updates lock the complete read/modify/write operation. Lock order is
  collection, workspace when needed, index, then file; callers must not reacquire
  a lock they already hold. Plugin installs and removals also take their collection
  lock, so backups wait for them to finish. Plugin icons are fetched before the lock.
- A file stream closes only after a successful write. Failure aborts the stream
  and removes a newly created empty placeholder. Existing good bytes survive a
  failed write. Invalid JSON raises an error rather than looking like a missing file.
- Agent and skill saves prepare file changes before mutation and roll back
  reported I/O failures, including changes to their indexes. Agent file membership
  lives in `files/index.json`; cleanup of removed folders follows the commit.
- A chat record (`chats/<id>/chat.json`, version 2) holds the runtime's native
  `UIMessage[]` transcript, its optional resume pointer and middleware metadata.
  Blob extraction walks message parts, native tool-result content, rich tool outputs in metadata
  and subagent conversations. Records saved before version 2 migrate when read:
  deterministic and idempotent, with unreadable parts dropped with a warning.
  Reading keeps the original JSON in `chat.legacy.json` so the migration can
  be redone; the migrated record is written on the next save. Older backups remain
  restorable and restore validation accepts both shapes.
- Chat attachments are addressed by content hash, retain their MIME type, and
  remain referenced until the new manifest is durable. All sibling blob writes
  settle before the save releases its lock. Missing references remain intact so
  a later partial restore can repair them. Cleanup retains blob references from
  the original recovery JSON, including dropped parts, and skips deletion if
  that record cannot be read.
- Chat startup loads `ChatEntry` metadata from the index. A conversation's manifest
  loads on selection, with concurrent reads coalesced. Attachment references stay
  in stored history; visible messages and model requests resolve separate copies.
  Forking resolves attachments before saving the new chat so its blobs belong to
  the new conversation. Full-text search scans manifests only when queried and
  includes loaded, unsaved edits without reading attachment bytes.
- Edits to an unloaded conversation enter the persistence queue before its read
  starts, so backups and flushes wait for them. Deleted IDs cannot reappear from
  a late initial load or conversation read. Retention reads candidate manifests
  before deleting them, protecting recently saved chats with stale index dates.
- Full deletion stops existing queues and rejects subsequent writes in the old
  page. The settings action reloads immediately after completing deletion.

## Backup, restore, and compatibility

Export flushes registered queues before taking a snapshot, then locks every
collection it reads. Writers that stay outside those locks (artifact state, an
index repair, the copy a reopened pre-migration chat keeps) can still touch a
file mid-snapshot, so a `NotReadableError` is retried; a file or folder that
has been deleted since it was listed is reported and left out, because its data
is gone rather than unreadable. Any other read error fails the export; it does
not produce an apparently successful partial ZIP.

Downloads open the save-file picker before taking the snapshot when the browser
supports it, then stream compressed ZIP chunks directly to disk with
backpressure. The chosen file is opened for writing only once the snapshot is
ready: the browser stages the bytes in a sibling file and renames it on close,
and synced or scanned folders can lock that staging file. A browser write failure
is retried once and otherwise delivered as an ordinary download, so a locked folder does not
lose the backup. Other browsers download a Blob assembled from those chunks.
Cancelling the picker does no snapshot work and leaves the chosen file untouched.

Restore decodes and checks the archive before mutation. Matching file paths are
replaced, while files absent from a partial backup remain untouched. An incoming
legacy agent definition also removes newer local definitions that would shadow it.
Collection indexes are rebuilt from actual records; imported indexes provide only identity
and timestamp hints. A reported write or rebuild failure restores prior bytes
and indexes. Invalid JSON in known metadata skips the owning record, including
its sibling files, while preserving any existing copy. Invalid profile JSON skips
only the profile; invalid collection indexes are ignored and rebuilt. Valid
records still import, and the UI reports skipped paths before offering a reload.
Unsafe paths, structurally invalid metadata, and malformed embeddings are
rejected before writing. Artifact content is preserved as supplied, including
arbitrary JSON files.

The settings drawer restores full or partial OPFS ZIP backups, including chats.
Restore also accepts an archive that carries a record without its collection
folder — `chat.json`, `one/chat.json`, `AGENTS.md`, `one/agent.json` and the
like — and files it under the collection its definition identifies, with blobs,
artifacts and agent files following the record. A flat chat keeps its stored ID,
so re-importing it updates the same conversation. A flat `SKILL.md` uses its
declared skill name as the folder name. Ambiguous record folders stay unchanged;
folders without a definition follow a flat record when present and otherwise
stay unchanged. Conflicting normalized paths are rejected before writing.

Agent import accepts ZIPs whose agent folders carry `AGENTS.md`, the older
`AGENT.md`, or `agent.json`: full backups, collection exports, or single agent
packages, including bundled skills. An agent folder with none of those is
reported as skipped rather than dropped silently. Pre-agent `repository.json`
archives and pre-OPFS chat/agent JSON exports are not supported. Existing saved
agents remain readable, and agent exports use the current format without
rewriting local data.

One index scanner serves repair and restore. It preserves custom chat ordering,
skill identities, and existing timestamps, and never deletes folders. Obsolete
repository index rebuilding and duplicate generic scanners were removed. Loading
older records can normalize values in memory and keep a recovery copy; it does
not write the migrated record back as a side effect of reading.

## Limits

These are failure-recovery guarantees, not a multi-file transaction across a
browser or operating-system crash. A hard shutdown can prevent pending writes or
rollback from finishing. Export snapshots, rollback, and the compressed input ZIP
still buffer data in memory. ZIP entries are decoded into Blobs from chunks,
avoiding an extra full byte-array copy, but imports are not fully streaming.
Large agent saves and backups therefore still have a memory cost. Edits to the same record from different
tabs remain last-writer-wins; Web Locks prevent interleaved transactions and lost
index updates, but do not merge independently edited conversations. Restore UI
reloads the page to replace its in-memory snapshots with restored data; a partial
restore lets the user review the report and defer that reload.

## Verification

Unit tests use an OPFS double with staged writes, injected I/O failures, and held
operations. Browser tests use actual Chromium OPFS and Web Locks under React
StrictMode, including two tabs, reloads, pending profile edits, deletions during
saves, failed agent saves, and a full backup/restore round trip.

```sh
./node_modules/.bin/vitest run
./node_modules/.bin/playwright test tests/browser/persistence.spec.ts
./node_modules/.bin/tsc --noEmit --project tests/browser/tsconfig.json
```
