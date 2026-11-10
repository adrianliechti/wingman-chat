# Persistence contracts

The browser stores chats, composer drafts, projects, agents, images, translations, skills, and the profile in OPFS. Theme,
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
  Blob extraction walks message parts, native tool-call output and tool-result
  content and subagent conversations. Saved message `textSegments` become text
  parts with phase metadata when loaded. Legacy tool output/error metadata
  moves into native content/state/error. MCP app bindings become `UIResourcePart`
  fields, with resource policy, the display hint and the original MCP response
  in its `meta`. New parts retain their HTML; migrated URI-only parts fetch it
  when opened. Supported modes are read from the live app handshake.
  The storage boundary converts readable media from damaged legacy tool output
  into native content, retaining the original record for recovery. Duplicate media
  MIME types move to native `source.mimeType`, and generated-file lists become
  artifact deltas. Runtime blob traversal reads only native fields.
  Records saved before version 2 migrate when read:
  deterministic and idempotent, with unreadable parts dropped with a warning.
  Reading keeps the original JSON in `chat.legacy.json` for both unversioned
  records and older version-2 fields, so the conversion can
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
- Projects store their instructions and file membership in `projects/<id>/project.json`.
  Original file bytes live under `files/<uuid>` and are committed before membership.
  Removed files remain on disk for tools already using an older project snapshot;
  deleting the project removes its directory and detaches its chats without deleting them.
  Chats retain `projectId` and `agentId`; project tools read only the requesting
  project's captured membership. Copies into a chat never overwrite existing files.
- Composer drafts use `drafts/chat-<id>/` for saved chats and `drafts/new-<projectId>/`
  for each project's new chat (`new-chat` outside projects). A manifest references
  immutable original file blobs, written before the manifest. Drafts transfer to a
  newly created conversation only after the destination is durable. The composer
  clears an unchanged draft when the runtime accepts its message; failed preparation
  preserves it. Deleting or expiring a chat also removes its draft. Restoring a sent
  message resolves its attachment revisions before replacing the composer.

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
replaced, while files absent from a partial backup remain untouched. After validation,
import migrates older layouts into the current storage paths. Flat `chats/<id>.json`
records become `chats/<id>/chat.json`; if the archive supplies both, its folder record
wins. Legacy agent definitions become `AGENTS.md`, and retired custom agent MCP servers
are discarded. Obsolete local definition paths and `servers.json` are removed in the
same rollback transaction. Converted `agent.json` source bytes
are retained as `agent.legacy.json` so unrecognized fields remain recoverable.
When older attached-file exports omit `files/index.json`, imported files are added
to the destination's committed membership without reviving excluded local folders.
An explicit archive file index remains authoritative.
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
Chat backups include drafts; projects have a separate export selection. Project
backups include original shared file bytes and support the same index repair and
restore flow as other collections.
Restore also accepts an archive that carries a record without its collection
folder — `chat.json`, `one/chat.json`, `AGENTS.md`, `one/agent.json` and the
like — and files it under the collection its definition identifies, with blobs,
artifacts and agent files following the record. A flat chat keeps its stored ID,
so re-importing it updates the same conversation. A flat `SKILL.md` uses its
declared skill name as the folder name. Named record folders keep their identity,
including single-agent exports containing bundled skills. Ambiguous record folders stay unchanged;
folders without a definition follow a flat record when present and otherwise
stay unchanged. Conflicting normalized paths are rejected before writing.

Agent import accepts ZIPs whose agent folders carry `AGENTS.md`, the older
`AGENT.md`, or `agent.json`: full backups, collection exports, or single agent
packages, including bundled skills. An agent folder with none of those is
reported as skipped rather than dropped silently. Pre-agent `repository.json`
archives and pre-OPFS chat/agent JSON exports are not supported. Existing saved
agents remain readable, and agent exports use the current format without
rewriting local data.

Settings restore also installs skills bundled under `agents/<id>/skills/` into
the shared `skills/` library after skipping malformed agents and their bundles.
Identical copies shared by several agents are deduplicated; conflicting copies are
rejected before writing. Legacy chat transcript
content stays intact during import and uses the existing migration and recovery-copy
behavior when opened.

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

## OneDrive backup uploads and protected restore

When the deployment enables OneDrive backups, Settings → Backup & Restore offers
required PIN or passkey protection. New accounts keep their key in memory and
make no backup requests until protection is configured. Existing unprotected
accounts enter setup and retain their old key for a protected upgrade, preserving
their existing history. Local edits and deletions remain usable during setup.
Protection can be changed; removing it requires deleting the online backup with
Reset backups. After one unlock/setup, encrypted uploads
continue across page reloads without a prompt. The browser retains a public
upload key, pinned to the user and key ID in `_sync/upload-key.json`; remembered
devices also retain the local root key described below. A new browser
or changed public key requires an unlock before automatic uploads are enabled.
Local OPFS chats and files remain plaintext and available while restore is locked.

New payloads use hybrid encryption: a fresh random AES-256-GCM key for each event
frame, attachment, or file is wrapped using RSA-OAEP-SHA256 with a 3072-bit public
key. Both layers bind the user/resource context and key ID. Version 3 envelopes
carry the wrapped content key, random nonce, ciphertext, and authentication tag.
The private RSA key is stored on the server encrypted under the existing root
key; that root remains protected by the user's PIN or passkey. RSA private keys remain in memory only. After successful setup or unlock,
the root key is stored as a non-extractable AES-GCM `CryptoKey` in a separate local
IndexedDB database, bound to the signed-in account and a SHA-256 fingerprint of the
complete protected keystore. Older raw-byte records are converted on the next load.
This database is neither uploaded nor included in OPFS ZIP exports/imports. Access
to the browser profile grants use of that saved decryption key, but its bytes cannot
be read back. Protection changes on a remembered device therefore re-authenticate
with an existing passkey or PIN first.

PIN wraps use Argon2id (64 MiB, t=3, p=1) followed by HKDF-SHA256.
Backups with legacy peppered PINs must be migrated using a passkey or the
previous version, as described in [How backup works](backup.md).
Legacy PBKDF2-SHA256 wraps remain readable and are re-wrapped after a successful PIN
unlock. The backend accepts only bounded Argon2id parameters. “Stop sync on this device” removes
the saved key and public upload key, then reloads open tabs to stop uploads and
incoming sync. The backend rejects unprotected
keystore writes, protection downgrades, and all backup operations without a valid
PIN- or passkey-protected keystore. Legacy plaintext keystore reads remain
available only so a user can upgrade protection without losing old backups.

Unlocking backup enables incoming cross-device changes immediately and for the
remainder of the page session. Remembered devices automatically unlock and resume
incoming sync on later visits. Other devices resume uploads only after reload.
Setup and unlock automatically remember the device without an extra setting.
“Stop sync on this device” in Backup options flushes local persistence and reloads
open tabs immediately. Uploads and incoming sync stay off until an explicit unlock.
A changed account or protected
keystore invalidates saved device access. Changing protection on this device
refreshes remembered access. Backup reset and clearing all local data remove it.
New browsers without local chats offer “Restore backup”; existing local sessions
offer “Unlock backup”. Clearing browser site data requires a fresh unlock.
Upload conflicts and server deletions wait for an unlocked restore; an upload-only
browser never downloads ciphertext to reconcile a conflict or overwrites a newer
remote version. Ordinary new uploads and pending local changes continue normally.
When an unlocked browser finds a remotely deleted chat, it removes an unchanged
local copy. Pending local edits and their attachments survive and upload as a
fresh chat log, matching file sync's preference for preserving unsynced work.
A local file deletion only applies to the version this browser last synced; if
another device changed the file since, its edit wins and is restored on the next pull.

Existing version 2 symmetric history stays readable with the protected root key.
An unlocked session provisions the backup key pair once without replacing old
history. Switching PIN/passkey protection rewraps the same root and preserves the
backup key envelope. The backend rejects updates that drop or change that envelope,
including updates from older clients, to prevent orphaning encrypted data. Restart
the Go backend when upgrading to this format before using automatic uploads.

Passkey protection uses WebAuthn PRF and HKDF-SHA256. OAuth2 Proxy still handles
identity; no extra Entra configuration is needed. PRF results accept standard
buffers/views and strictly validated 32-byte arrays for providers such as
1Password. Setup verifies repeated PRF evaluation before saving the keystore.
Each enrollment uses a fresh user handle so failed replacement cannot overwrite
the working credential. Failed uploads can leave an unused provider credential.

Passkeys require HTTPS or localhost with a DNS hostname and a provider supporting
PRF. Credentials are tied to the site hostname. New devices need the same passkey
through their provider or security key. PIN and passkey are alternative methods;
there is no automatic recovery. Keep exported backups before changing protection.
Keystore updates remove legacy `keystore.prev.json` sidecars, but older exported
or server backups may retain earlier keys. Changing protection does not revoke
keys already held by another unlocked browser.

## Online backup coverage

ChatSync backs up chat metadata, transcripts, and referenced message attachments.
Both backup modes keep the native `chat.json` snapshot locally. Online saves
commit an outbox snapshot before starting backup initialization or network work;
confirmed event logs are backup baselines rather than the UI's storage format.
Retention applies to local chats and to older chats restored from online backup.
FileSync backs up current artifact files under `chats/<id>/artifacts/` and saved
HTML artifact app data under `chats/<id>/artifact-state/`. Immutable artifact
revisions under `artifact-versions/` are also backed up, preserving sent attachment
references even after a file is edited. The derived revision listing stays local
and is rebuilt from restored revision files. Startup reconciliation picks up
existing artifacts as well as new ones; ordinary writes and file, folder, or chat
deletions propagate through the file sync engine. Artifacts use the same encrypted
file envelopes, conflict handling, and request-time upload pauses as other files.

The rest of OPFS is included by default, except internal `_sync/` tracking and
chat internals handled by ChatSync. This covers projects and original shared files,
composer drafts and pending attachments, agents and their attached documents,
embeddings and memory, editable skills, installed plugins and bundled resources,
repositories, generated images, and `profile.json`. Local chat indexes and legacy
chat recovery copies are excluded; the chat log supplies the restored chat list.

Online backup does not cover localStorage: theme, layout/background, device choices,
model/effort/verbosity and tool/source preferences, selected agent/project, artifact
browser visibility, inline UI interaction state, and MCP OAuth credentials remain
browser-local. Remembered-device decryption keys in IndexedDB are also excluded.
Shipped templates, server configuration, and remote service data are not browser
workspace data. Individual FileSync files larger than 256 MiB are skipped and
remain local; the current engine logs this limit in the console. Downloaded OPFS
ZIP backups have separate coverage and include local artifact history.

## Upload timing during LLM requests

Chat snapshots continue saving locally at the normal persistence interval while a
request is running. Sends, retries, connections, and queued/tool continuations hold
nested backup leases per chat. Server appends and attachment uploads wait until the
request ends. The final local persistence queue is flushed before uploads resume.
Stop and disposal also release their captured leases after local persistence; late
provider events cannot release a newer request's lease. A closed/crashed page keeps
its pending local snapshot for retry on the next launch.

Workspace file uploads also wait while a request is active in that page. Guards at
the actual HTTP mutation boundaries cover a request beginning during encryption.
An upload already sent before a new request begins may finish. Manual/periodic
flushes respect the same pauses; unrelated chats can still upload independently.
Normal edits outside a request continue to upload automatically. Large transcripts
may span multiple encrypted frames and occasional compaction writes, so this is
one final transcript update per completed request, not a strict one-HTTP-call limit.

## Multiple backend pods and shared storage

OneDrive backups use Microsoft Graph ETags and conditional index commits to
coordinate requests across replicas. They require no persistent server volume.
See [OneDrive concurrency and rollout](backup.md#onedrive-authentication-and-storage)
for conflict handling, reset fencing, and upgrading older writers.

Settings → Backup & Restore → Reset backups permanently deletes the signed-in
account's OneDrive keystore, chat logs, attachments, and workspace backups. It works
without the old PIN/passkey. Confirmation reloads open tabs and stops active
responses after flushing local persistence. Local chats and files stay available;
only backup tracking and the cached upload key are cleared. Backups remain off
until protection is configured again, at which point local data uploads under
fresh keys. Passkeys held by a password manager or security key must be removed
there separately.

Browser sync operations share a storage lock with reset, including local writes
after a server response. Reset waits for those operations, and a persistent
generation fences old tabs even if they miss the reload notification. Pending
local edits remain usable. A failed local cleanup retries without repeating an
acknowledged online deletion.

Conditional index commits reject requests that began before a reset or
keystore change. A backup generation in the protected keystore also rejects
requests started later by an old device. Reset IDs make a retried reset safe
after another device has configured a new backup.

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
