# Persistence contracts

The browser stores chats, agents, images, skills, and the profile in OPFS. Theme,
device selection, and OAuth state in localStorage are outside the OPFS backup.

## Writes and state ownership

- `usePersistentCollection` owns each collection's current snapshots. It updates
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
- Full deletion stops existing queues and rejects subsequent writes in the old
  page. The settings action reloads immediately after completing deletion.

## Backup, restore, and compatibility

Export flushes registered queues before taking a snapshot. Read errors fail the
export; they do not produce an apparently successful partial ZIP.

Restore decodes and checks the archive before mutation. Matching file paths are
replaced, while files absent from a partial backup remain untouched. Collection
indexes are rebuilt from actual records; imported indexes provide only identity
and timestamp hints. A reported write or rebuild failure restores prior bytes
and indexes. Invalid paths, known malformed metadata, and malformed embeddings
are rejected before writing. Artifact content is preserved as supplied.

The settings drawer can restore a full or partial OPFS backup. Chat import also
accepts a collection export, a single chat folder, or chats within a full backup.
Agent import accepts full backups, collection exports, single agent packages,
bundled skills, and older repository exports. JSON imports retain the older chat
and repository conversion paths, but use the current persistence writers.

One index scanner serves repair and restore. It preserves custom chat ordering,
skill identities, and existing timestamps, and never deletes folders. Obsolete
repository index rebuilding and duplicate generic scanners were removed. Loading
older records can normalize values in memory; it does not write migrations back
as a side effect of reading.

## Limits

These are failure-recovery guarantees, not a multi-file transaction across a
browser or operating-system crash. A hard shutdown can prevent pending writes or
rollback from finishing. Rollback and ZIP decoding buffer data in memory, so large
agent saves and backups have a memory cost. Edits to the same record from different
tabs remain last-writer-wins; Web Locks prevent interleaved transactions and lost
index updates, but do not merge independently edited conversations. Restore UI
reloads the page to replace its in-memory snapshots with restored data.

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
