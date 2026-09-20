/**
 * Artifact Preview Service Worker
 *
 * Serves artifact files from in-memory session stores over a dedicated
 * URL path (`/__preview__/{token}/{path}`) so that HTML previews behave
 * like a real web server: navigation, relative URLs, subfolder references,
 * fetch/XHR and form submissions all work naturally.
 *
 * Sessions are registered/updated/unregistered via postMessage from the
 * main thread. No OPFS access happens here — the page ships file contents
 * directly.
 */

const SCOPE_PREFIX = "/__preview__/";

/**
 * sessions: Map<token, { files, libraries, revision, owner }>
 *
 * FileEntry = {
 *   body: string | ArrayBuffer,
 *   contentType: string,
 *   isBinary: boolean,
 * }
 */
const sessions = new Map();
const pendingRecoveries = new Map();
const RECOVERY_TIMEOUT_MS = 1000;

/**
 * Bundled libraries every session can reference as `.lib/<name>` at any depth.
 * The page tells us where the app serves each one; bytes are fetched once and
 * kept in CacheStorage so previews keep working offline and after a restart.
 */
const LIBRARY_CACHE = "wingman-artifact-libraries";
const LIBRARY_PATTERN = /(?:^|\/)\.lib\/([^/]+)$/;

function sessionLibraries(libraries) {
  return new Map(Object.entries(libraries || {}).filter(([name, url]) => name && typeof url === "string" && url));
}

async function serveLibrary(token, name) {
  // Two tabs can run different deployed builds. Each session keeps its own URLs.
  const url = sessions.get(token)?.libraries.get(name);
  if (!url) return null;
  const cache = await caches.open(LIBRARY_CACHE);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) return null;
    await cache.put(url, response.clone());
  }
  const contentType = /\.css$/i.test(name) ? "text/css;charset=utf-8" : "text/javascript;charset=utf-8";
  return new Response(response.body, {
    status: 200,
    headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
  });
}

// A crashed/closed page cannot send unregister. Sweep its sessions on later
// activity; do not keep a timer alive in a browser-managed service worker.
let lastSweep = 0;
async function pruneClosedOwners() {
  if (Date.now() - lastSweep < 30_000) return;
  lastSweep = Date.now();
  const candidates = [...sessions];
  const clients = new Set(
    (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).map((client) => client.id),
  );
  for (const [token, session] of candidates) {
    if (session.owner && !clients.has(session.owner) && sessions.get(token) === session) unregisterSession(token);
  }
}

function normalizePath(path) {
  if (!path) return "";
  let p = String(path);
  // Strip query string / fragment
  p = p.split("?")[0].split("#")[0];
  // Strip leading ./ and /
  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  // Resolve any ".." segments (defensive — browser usually resolves first)
  const parts = [];
  for (const encodedSegment of p.split("/")) {
    let seg = encodedSegment;
    try {
      // URL.pathname keeps percent escapes, while artifact paths are stored
      // decoded (for example, "my photo.png" rather than "my%20photo.png").
      seg = decodeURIComponent(encodedSegment);
    } catch {
      // Leave malformed escapes untouched so they produce a normal 404.
    }
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

function buildFileEntry({ content, contentType, bytes }) {
  if (bytes instanceof ArrayBuffer) {
    return {
      body: bytes,
      contentType: contentType || "application/octet-stream",
      isBinary: true,
    };
  }
  return {
    body: typeof content === "string" ? content : "",
    contentType: contentType || "text/plain;charset=utf-8",
    isBinary: false,
  };
}

function registerSession(token, files, libraries, revision = 0, owner) {
  if ((sessions.get(token)?.revision ?? -1) > revision) return;
  const store = new Map();
  if (files && typeof files === "object") {
    for (const [rawPath, file] of Object.entries(files)) {
      const key = normalizePath(rawPath);
      if (!key) continue;
      store.set(key, buildFileEntry(file || {}));
    }
  }
  sessions.set(token, { files: store, libraries: sessionLibraries(libraries), revision, owner });
}

function updateFile(token, rawPath, file) {
  const store = sessions.get(token)?.files;
  if (!store) return;
  const key = normalizePath(rawPath);
  if (!key) return;
  store.set(key, buildFileEntry(file || {}));
}

function deleteFileFromSession(token, rawPath) {
  const store = sessions.get(token)?.files;
  if (!store) return;
  const key = normalizePath(rawPath);
  if (!key) return;
  for (const entry of store.keys()) {
    if (entry === key || entry.startsWith(`${key}/`)) store.delete(entry);
  }
}

function renameFileInSession(token, fromPath, toPath) {
  const store = sessions.get(token)?.files;
  if (!store) return;
  const fromKey = normalizePath(fromPath);
  const toKey = normalizePath(toPath);
  if (!fromKey || !toKey) return;
  const entry = store.get(fromKey);
  if (entry) {
    store.delete(fromKey);
    store.set(toKey, entry);
  }
  // Also rename any entries under the old path if it was a folder
  const folderPrefix = `${fromKey}/`;
  const toPrefix = `${toKey}/`;
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(folderPrefix)) {
      const rel = key.slice(folderPrefix.length);
      const newKey = `${toPrefix}${rel}`;
      store.set(newKey, store.get(key));
      store.delete(key);
    }
  }
}

function cancelRecovery(token) {
  const pending = pendingRecoveries.get(token);
  pendingRecoveries.delete(token);
  pending?.controller.abort();
}

function unregisterSession(token) {
  cancelRecovery(token);
  sessions.delete(token);
}

function requestSessionSnapshot(client, token, signal) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      channel.port1.close();
      channel.port2.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), RECOVERY_TIMEOUT_MS);
    const abort = () => finish(null);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    channel.port1.onmessage = (event) =>
      finish(
        event.data?.ok
          ? {
              files: event.data.files,
              libraries: event.data.libraries,
              revision: event.data.revision ?? 0,
              owner: client.id,
            }
          : null,
      );
    channel.port1.onmessageerror = () => finish(null);
    try {
      client.postMessage({ type: "html-preview/recover-request", token }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

async function recoverSession(token) {
  if (!token || sessions.has(token)) return sessions.has(token);
  const pending = pendingRecoveries.get(token);
  if (pending) return pending.promise;
  const controller = new AbortController();

  const recovery = (async () => {
    // The app itself is outside this worker's narrow preview scope, so include
    // uncontrolled same-origin windows when asking for the live page snapshot.
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    let snapshot;
    try {
      snapshot = await Promise.any(
        clients.map(async (client) => {
          const reply = await requestSessionSnapshot(client, token, controller.signal);
          if (!reply || typeof reply.files !== "object" || Array.isArray(reply.files))
            throw new Error("Session not owned");
          return reply;
        }),
      );
    } catch {
      return false;
    }
    if (controller.signal.aborted) return sessions.has(token);
    registerSession(token, snapshot.files, snapshot.libraries, snapshot.revision, snapshot.owner);
    return true;
  })();

  pendingRecoveries.set(token, { promise: recovery, controller });
  try {
    return await recovery;
  } finally {
    if (pendingRecoveries.get(token)?.promise === recovery) pendingRecoveries.delete(token);
    controller.abort();
  }
}

function lookupFile(token, path) {
  const store = sessions.get(token)?.files;
  if (!store) return null;
  const key = normalizePath(path);
  const entry = store.get(key);
  if (entry) return { key, entry };

  // Directory index fallback: /pages/ → /pages/index.html
  if (!key || key === "") {
    const idx = store.get("index.html");
    if (idx) return { key: "index.html", entry: idx };
  } else {
    const idx = store.get(`${key}/index.html`);
    if (idx) return { key: `${key}/index.html`, entry: idx };
  }
  return null;
}

function buildResponse(entry, extraHeaders = {}) {
  const headers = new Headers({
    "Content-Type": entry.contentType,
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  return new Response(entry.body, { status: 200, headers });
}

function notFoundResponse(token, path) {
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>Not Found</title>
<style>body{font-family:system-ui,sans-serif;padding:2rem;color:#555;background:#fafafa}code{background:#eee;padding:0.1rem 0.3rem;border-radius:3px}</style>
</head><body>
<h1>404 — File Not Found</h1>
<p>No artifact at <code>${escapeHtml(path)}</code>${token ? ` in session <code>${escapeHtml(token)}</code>` : ""}.</p>
</body></html>`;
  return new Response(body, {
    status: 404,
    headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" },
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function parsePreviewUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.startsWith(SCOPE_PREFIX)) return null;
    const rest = parsed.pathname.slice(SCOPE_PREFIX.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      return { token: rest, path: "" };
    }
    return { token: rest.slice(0, slash), path: rest.slice(slash + 1) };
  } catch {
    return null;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object" || !String(data.type).startsWith("html-preview/")) return;
  event.waitUntil(
    (async () => {
      const port = event.ports?.[0];
      try {
        const { type, token } = data;
        const owner = event.source?.id;
        if (sessions.has(token) && sessions.get(token).owner !== owner)
          throw new Error("Preview session belongs to another page.");
        switch (type) {
          case "html-preview/register":
            cancelRecovery(token);
            registerSession(token, data.files, data.libraries, data.revision, owner);
            break;
          case "html-preview/update":
          case "html-preview/delete":
          case "html-preview/rename": {
            if (!sessions.has(token)) await recoverSession(token);
            const session = sessions.get(token);
            if (!session || session.owner !== owner) throw new Error("Preview session is no longer available.");
            if ((data.revision ?? 0) < session.revision) break;
            if (type === "html-preview/update") updateFile(token, data.path, data.file);
            else if (type === "html-preview/delete") deleteFileFromSession(token, data.path);
            else renameFileInSession(token, data.fromPath, data.toPath);
            session.revision = data.revision ?? session.revision;
            break;
          }
          case "html-preview/unregister":
            unregisterSession(token);
            break;
          case "html-preview/ping":
            break;
          default:
            throw new Error("Unknown preview worker message.");
        }
        port?.postMessage({ ok: true });
      } catch (error) {
        try {
          port?.postMessage({ ok: false, error: String(error) });
        } catch {
          /* Owner closed. */
        }
      } finally {
        port?.close();
      }
    })(),
  );
  event.waitUntil(pruneClosedOwners().catch(() => {}));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = request.url;
  if (!url) return;

  const parsed = parsePreviewUrl(url);
  if (!parsed) return; // Not our scope; let the network handle it.

  event.respondWith(handleFetch(request, parsed));
  event.waitUntil(pruneClosedOwners().catch(() => {}));
});

async function handleFetch(request, { token, path }) {
  // Handle form POSTs: treat them like a GET to the action target.
  // (We could echo form data later; for now we just serve the target file.)
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // A service worker's global memory is not durable. If the browser restarted
  // it while the app stayed open, rehydrate this token from the owning page.
  if (!sessions.has(token)) await recoverSession(token);

  const hit = lookupFile(token, path);
  if (hit) return buildResponse(hit.entry);

  // Not a session file: a `.lib/<name>` reference resolves to a bundled library.
  const library = LIBRARY_PATTERN.exec(normalizePath(path));
  if (library && sessions.has(token)) {
    try {
      const response = await serveLibrary(token, library[1]);
      if (response) return response;
    } catch {
      // Fall through to the 404 below.
    }
  }
  return notFoundResponse(token, path);
}
