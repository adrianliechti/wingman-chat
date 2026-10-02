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
  a lock they already hold.
- A file stream closes only after a successful write. Failure aborts the stream
  and removes a newly created empty placeholder. Existing good bytes survive a
  failed write. Invalid JSON raises an error rather than looking like a missing file.
- Agent and skill saves prepare file changes before mutation and roll back
  reported I/O failures, including changes to their indexes. Agent file membership
  lives in `files/index.json`; cleanup of removed folders follows the commit.
- Chat attachments are addressed by content hash, retain their MIME type, and
  remain referenced until the new manifest is durable. All sibling blob writes
  settle before the save releases its lock. Missing references remain intact so
  a later partial restore can repair them.
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

Export flushes registered queues before taking a snapshot. Read errors fail the
export; they do not produce an apparently successful partial ZIP. Downloads open
the save-file picker before taking the snapshot when the browser supports it,
then stream compressed ZIP chunks directly to disk with backpressure. Other
browsers download a Blob assembled from those chunks. Cancelling the picker
does no snapshot work; failed disk writes abort the output and report an error.

Restore decodes and checks the archive before mutation. Matching file paths are
replaced, while files absent from a partial backup remain untouched. Collection
indexes are rebuilt from actual records; imported indexes provide only identity
and timestamp hints. A reported write or rebuild failure restores prior bytes
and indexes. Invalid JSON in known metadata skips the owning record, including
its sibling files, while preserving any existing copy. Invalid profile JSON skips
only the profile; invalid collection indexes are ignored and rebuilt. Valid
records still import, and the UI reports skipped paths before offering a reload.
Unsafe paths, structurally invalid metadata, and malformed embeddings are
rejected before writing. Artifact content is preserved as supplied, including
arbitrary JSON files.

The settings drawer restores full or partial OPFS ZIP backups, including chats.
Agent import accepts ZIPs containing current `AGENTS.md` definitions: full
backups, collection exports, or single agent packages, including bundled skills.
Legacy agent/repository imports and pre-OPFS chat JSON imports are no longer
supported. Existing saved agents remain readable, and agent exports use the
current format without rewriting local data.

One index scanner serves repair and restore. It preserves custom chat ordering,
skill identities, and existing timestamps, and never deletes folders. Obsolete
repository index rebuilding and duplicate generic scanners were removed. Loading
older records can normalize values in memory; it does not write migrations back
as a side effect of reading.

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
