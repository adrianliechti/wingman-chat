# How backup works

Wingman saves your work in the browser first. When online backup is enabled by
the deployment and you configure a PIN or passkey, it also uploads encrypted
copies to OneDrive. You can continue working offline.

```mermaid
flowchart LR
    A[Chats and workspace changes] --> B[Browser storage<br/>Plaintext local copy]
    B --> C[Pending changes]
    C --> D[Encrypt in browser]
    D --> E[OneDrive<br/>Encrypted backup]
    E --> F[Unlock and decrypt<br/>in browser]
    F --> B
```

## Choose a provider

The default provider is `local`, which uses ZIP download and restore controls.
These controls also remain available when online backup is enabled. Omitting the
provider selects local backups.

For online backups in Kubernetes, add one environment variable to the Wingman
container, using your existing OneDrive connection in `/app/drives.yaml`:

```yaml
env:
  - name: BACKUP_PROVIDER
    value: "onedrive"
```

The backend automatically selects the sole OneDrive connection. Only deployments
with multiple OneDrive connections need `BACKUP_DRIVE` set to the chosen
connection's `id` in `drives.yaml` (or `drive` in `backup.yaml`).

Alternatively, configure `backup.yaml` using the existing OneDrive connection:

```yaml
provider: onedrive
drive: personal # optional
```

The providers are `local` (ZIP files) and `onedrive` (encrypted OneDrive
storage). The backend exposes the choice as `backup: { provider: "onedrive" }` in
`/config.json`; `onedrive` enables online backup controls, while `local` keeps
the ZIP backup controls. Unknown providers or missing or ambiguous connections
fail startup. `BACKUP_PROVIDER` and `BACKUP_DRIVE` take precedence over
`backup.yaml`. Restart the backend after changing configuration.

Switching providers or OneDrive connections selects a separate backup; it does
not migrate or delete the old one. Each browser records which backup its local
sync tracking belongs to (the keystore's account ID). When it finds a different
or missing backup, it clears that tracking and reloads open tabs, keeping local
chats and files; they upload again once protection is configured at the new
destination.

### Stable account identity

The chat backend identifies the backup user by the proxy's `X-Forwarded-User`
header. `/me` returns its truncated SHA-256 hash, which the browser uses
to tell apart accounts' local sync state. Backup API requests without `X-Forwarded-User`
fail with 401. Which backup is used is decided by the Microsoft account behind
the Graph token, not by this header.

Ciphertext is bound to a random `accountId` stored in the keystore, not to the
sign-in identity, so a changed header value does not make an existing backup
unreadable. The server rejects keystores without a valid `accountId` and
updates that change it.

Still prefer a stable subject over an email address for `X-Forwarded-User`
(OAuth2 Proxy forwards the OIDC `sub` claim by default): a browser treats a new
value as a different account and asks to export and clear its local workspace
before syncing again.

```yaml
environment:
  OAUTH2_PROXY_PASS_ACCESS_TOKEN: "true"
  OAUTH2_PROXY_PASS_USER_HEADERS: "true"
```

The backend trusts these headers and does not authenticate requests itself. The
proxy must validate the session, strip/overwrite client-supplied `X-Forwarded-*`
headers, and be the only route to the backend. The forwarded Microsoft token, not
`X-Forwarded-User`, selects the OneDrive backup.

### OneDrive authentication and storage

The OneDrive provider uses the same forwarded access token and optional
on-behalf-of exchange as the selected reader connection. The reverse proxy must
supply `Authorization: Bearer …` or `X-Forwarded-Access-Token` on backup API requests,
alongside the existing trusted account identity headers. The resulting token must
be for Microsoft Graph and have delegated write access: `Files.ReadWrite.All`
already suffices, or use `Files.ReadWrite.AppFolder` for app-folder-only access.
Keep broader read permissions if the file browser needs to browse outside the app
folder. Re-consent after changing permissions. No additional Microsoft login or
refresh-token store is introduced by this provider. A personal Microsoft account
requires a compatible existing Graph token flow; this feature does not add a
personal-account sign-in flow to an organizational OBO deployment.

Backups live under `Apps/<Microsoft app name>/backup/`. The exact app-folder name
comes from the registration that issued the Graph token. Each Microsoft account
has its own OneDrive. Data and
protected recovery keys are encrypted in the browser before upload. OneDrive sees
opaque objects and a metadata index containing sizes, resource IDs and timing.

Chat appends upload immutable event segments; changed workspace files and blobs
upload separately. An index publishes committed versions only after their objects
are uploaded. Failed writes remain pending in the browser. File and blob uploads use temporary
encrypted files on the chat backend, removed when the request finishes, to bound
memory. Chat appends encode one incoming batch in memory before uploading it. The backend
rejects file and blob bodies over 257 MiB and append bodies over 64 MiB with 413;
the browser splits large chat uploads into several appends below that cap. Automatic
chat compaction only publishes snapshots that fit in one append request; larger
chats retain their complete event history. Files larger than 10 MiB use upload sessions with sequential 10 MiB
fragments. Throttled requests retry with bounded backoff; interrupted operations
retry through the existing sync loop. Sessions are not persisted across requests.

OneDrive uses conditional index writes with Microsoft Graph ETags to coordinate
requests across replicas. Unrelated resource
changes merge and retry; concurrent
changes to the same resource return a conflict. A changed keystore or reset
generation rejects uploads that started before that change. Each configured backup
also has a generation identifier that rejects requests from devices using an older backup. No lock files, persistent volume, or shared
filesystem are required. Encrypted upload
spools use the backend's temporary directory and are removed after each request.

Usage reports OneDrive's account-folder size, which may update with a delay.
Old objects are reclaimed after a successful replacement; cleanup failures and
uncertain commits may leave unreferenced objects that still consume quota.
Reset also works when the index contents are corrupt or unsupported. It atomically clears the index and its key material, retaining an empty index
with a fresh generation to fence stale writers. It then deletes a snapshot of
existing encrypted objects, including objects left by earlier failed commits.
An upload already in progress can leave an unpublished object after reset; it
cannot publish into the new backup. A browser whose reset response was lost
retries the reset on its next load; if another device configured a new backup in
between, that retry removes it too. Object cleanup is best-effort;
a later reset can reclaim objects left behind. Concurrent deletion or reset can interrupt a download; restore reports the
failure and must be retried rather than accepting a partial backup. OneDrive's recycle
bin and version-history policies still apply: a reset or PIN change cannot revoke
historical copies already retained by OneDrive. Restoring backups uses Wingman's
restore controls, rather than manually reverting individual OneDrive objects.

## When does it sync?

| Trigger                           | What happens                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Edit a chat                       | Save locally through the persistence queue, normally within 100 ms; then attempt an upload.                              |
| An AI response is running         | Continue local saves. Pause that chat's uploads and this page's workspace file uploads. Already-sent uploads can finish. |
| Request finishes, stops, or fails | Flush local saves, then resume uploads. Large chats may need several frames.                                             |
| Change a workspace file           | Normally upload after a 2-second debounce.                                                                               |
| Open the app                      | Pull remote chats, retry pending chat uploads, and reconcile files.                                                      |
| Keep the tab visible              | Pull chats and retry pending chat uploads every minute; reconcile files about every five minutes.                        |
| Return to the tab                 | Pull chats and retry pending chat uploads immediately; reconcile files if due.                                           |
| Select **Sync now**               | Pull chats, upload pending chats, and reconcile files. Request pauses still apply.                                       |

Failed uploads remain pending for retry. All sync requires unlocked (or remembered) backup access.
Open tabs share the local mirror: each chat syncs under a cross-tab lock and
starts from the baseline last written by any tab, so events are never applied twice.
Store requests time out after a minute (ten for file and attachment transfers).

## Where is data stored?

**In the browser:** chats and workspace files live in OPFS (Origin Private File
System), in plaintext. Pending changes survive reloads. Local data remains
accessible when online backup is locked or offline.

**In OneDrive:** encrypted backup objects and the index live in the app folder.
Chats use encrypted event segments; attachments and workspace files are separate
encrypted objects. Paths stay inside the encrypted payload, but file IDs are
unsalted hashes of paths: anyone with the index can test guesses for likely
paths. The backend can also see account identity, sizes, and update timing.

## How is it encrypted?

Encryption happens **in the browser before upload**; decryption happens there
after download. Each event frame, attachment, or file is encrypted with
AES-256-GCM under a random root key and a fresh nonce. Authenticated context
binds the payload to its account, resource, and (for chat frames) sequence
number, so the backend cannot reorder or move frames without decryption failing.
Restored workspace files must still match the resource ID derived from their path.

Your PIN or passkey (WebAuthn PRF + HKDF-SHA256) protects the root key. Either
configured method can unlock it. Changing protection preserves existing data and keys.

New PINs must have at least 8 characters. They are stretched with Argon2id
(64 MiB, 3 passes) and HKDF-SHA256. A leaked keystore permits offline PIN
attempts; Argon2id raises the cost of each guess.

Setup and unlock automatically remember this device. The root key is saved in
local IndexedDB as a non-extractable Web Crypto key, excluded from exports. Scripts
running in the page can use it while the app is open, but cannot read or copy its
bytes. Access to the browser profile still grants local data and remembered backup
access. Because the saved key cannot be read back, adding or replacing a recovery
method on a remembered device first asks for an existing method again: a passkey
prompt, or the PIN before adding a passkey. Browsers that are not remembered
neither upload nor download until you unlock them.

## What is included?

Online backup covers chats, referenced attachments, current artifacts and app
state, projects, drafts, agents, skills, plugins, images, memory, and the profile.
Immutable artifact revisions are included so attachments pinned to an earlier
version remain usable after restore. Revision listings are rebuilt locally.
It excludes internal sync tracking, browser
preferences and OAuth credentials in localStorage, and remembered-device keys.
Workspace files larger than 256 MiB stay local and remain pending with an explicit size-limit error.

## Restore, conflicts, and reset

On a new browser, sign in and choose **Restore backup**, then use your PIN or
passkey. There is no automatic recovery if you lose both methods and all unlocked
devices. Passkeys require a compatible provider and the same site hostname.

Sync is not collaborative editing: concurrent chat changes can overwrite each
other; ordinary file conflicts use modification times. Remote deletion removes
unchanged local copies, while pending local edits survive and can upload again.
Pending chat deletions use a separate per-chat local journal so simultaneous
offline deletions in different tabs cannot overwrite each other.
Chat deletions apply only to the server head this browser last confirmed. If
another device has saved newer work, the deletion is cancelled and its current
copy is restored on the next pull. Deleted chat logs retain a metadata tombstone
with an advanced sequence, so offline edits can recreate a chat without reusing
an older log's sequence numbers. Tombstones contain no transcript data and remain
until account reset. Online retention waits for reconciliation and skips chats
whose newer backup could not be downloaded; startup never expires stale local
snapshots before that check.

When a different account signs in on a browser with an existing local workspace,
online backup stops rather than deleting the previous account’s data. The local
workspace remains plaintext and accessible in the browser profile. Sign back
into the original account and export any needed data before clearing local data.

**Deactivate backup** removes this browser's remembered keys and stops sync across
its open tabs, retaining local data and the online copy. **Reset online backup**
deletes the selected destination’s data and protection settings, retaining local data. Backups
remain off until you configure protection again.

For implementation and deployment details, see [Persistence contracts](persistence.md).

## Provider interface

`store.Provider` remains the extension point for future backup destinations.
OneDrive is the only online implementation. The interface has 14 methods covering keystore CAS,
chat events and compaction, encrypted objects, file listing, attachment existence,
usage, and reset. Files and blobs share `GetObject`, `PutObject`, and `DeleteObject`,
with `ObjectKind` keeping their namespaces separate. Conditional object writes
return `ErrObjectConflict` when their ETag precondition fails.
Each method serves an existing API operation; providers own concurrency control
and must fence requests that began before a reset or keystore change. Local ZIP export stays in the browser.

Chat attachments are content-addressed and may be shared across conversations.
Deleting a chat removes its event history but retains shared encrypted attachment
objects until account reset. This avoids deleting another chat's attachments;
retained objects continue to count toward OneDrive usage.
