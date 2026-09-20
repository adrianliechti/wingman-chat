# Worker and bridge lifetimes

Each worker needs an explicit owner and a clear end to its useful lifetime.
Cancellation must release resources as well as stop waiting for their results.

| Resource               | Owner                               | End of lifetime                                                                       |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| DuckDB worker          | Consumer's database instance        | Consumer disposal; an interrupted query retires the runtime                           |
| JavaScript worker      | Interpreter execution               | Every execution, including success                                                    |
| Python worker          | Interpreter host                    | Failure, cancellation, or one minute idle; successful adjacent runs reuse the runtime |
| Interpreter RPC        | Execution that started it           | Reply or execution cancellation; both channel endpoints close                         |
| PDF worker             | Loading task for one document       | Viewer close, extraction/rasterization completion, failure, or cancellation           |
| PDF canvas             | Visible page or rasterization step  | Page leaves the preload area, step completes, or operation is cancelled               |
| Preview service worker | Browser registration shared by tabs | Browser decides when to stop/restart it                                               |
| Preview session        | Mounted preview                     | Close cancels requests, drops snapshots, and unregisters that session                 |
| Audio worklet          | Recorder/player operation           | Stop, replacement, failure, or disposal; see [voice lifecycle](voice-lifecycle.md)    |

Keep these properties when adding another worker or bridge:

- Own resources as soon as they are acquired, including while initialization is pending. A failed PDF open still owns a loading task that must be destroyed.
- Capture cancellation and context for the operation that started a request. Late replies must not affect the next execution or document.
- Close ports and remove listeners on every outcome, including failed structured cloning and unreadable replies. A request to an unavailable service worker must time out.
- Reuse runtimes only when their state can be reset. A cancelled queued execution should settle immediately without allowing another execution to overlap the active runtime.
- Bound memory retained by results and canvases. PDF viewers keep nearby canvases and clear their backing stores when they leave that area.
- Treat service-worker memory as disposable. The owning page keeps the current preview snapshot; revision numbers prevent old recovery replies from replacing newer files. Closing a preview cancels recovery, and later activity prunes sessions whose page has disappeared.
- Keep preview files and library manifests scoped to their session. Closing one preview must not unregister the shared service worker or change another tab's library versions.

The regression tests cover stalled initialization, queued cancellation, ignored aborts,
worker errors, stale recovery replies, and session isolation. The browser fixtures in
`tests/browser/worker-services.spec.ts` and `duckdb-lifecycle.spec.ts` also run in WebKit
to check actual worker termination and canvas cleanup.

## DuckDB and OPFS

Artifact files already persist in OPFS. `createDuckDbWorkspace` registers native
`File` objects with `BROWSER_FILEREADER` and direct I/O, so queries read slices
without first loading whole files into the WASM heap. The SQL database itself is
temporary and belongs to one consumer. Keeping those lifetimes separate allows
previews, editors, and interpreter runs to query the same source files.

DuckDB-Wasm is pinned to `1.32.0`, matching the installed runtime and the extension
engine version in `scripts/bundle-duckdb-extensions.mjs`. Upgrade them deliberately
and run the browser extension/lifecycle tests. The [DuckDB OPFS article](https://duckdb.org/2026/09/18/opfs-wasm)
reports a persistence regression in `1.33.1-dev57.0`; it identifies `1.32.0` and
`1.33.1-dev64.0` as working versions. Our lockfile already used `1.32.0` before
the explicit pin.

A future persistent SQL database could cache expensive derived tables across
reloads. It would need its own owner, source-revision invalidation, bounded storage,
and coordinated export/deletion. Do not point independent consumer workers at one
writable database. [DuckDB's OPFS documentation](https://duckdb.org/docs/current/clients/wasm/instantiation#persistence-with-opfs)
requires releasing synchronous file handles before another instance uses them.
Automatic `opfs://` registration also resolves origin-wide paths, so exposing it
to artifact SQL would bypass the workspace's explicit file mounts and write flow.

For persistent writes, checkpoint completed batches before reporting them saved;
page shutdown cannot be the only flush opportunity. Keep the current cancellation
path able to terminate a busy worker immediately. An OPFS-backed database still
needs the existing query-memory and result limits; persistence alone does not
establish a lower peak memory footprint.
