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
 * sessions: Map<token, Map<normalizedPath, FileEntry>>
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
const libraryUrls = new Map();
const LIBRARY_CACHE = "wingman-artifact-libraries";
const LIBRARY_PATTERN = /(?:^|\/)\.lib\/([^/]+)$/;

function setLibraries(libraries) {
  if (!libraries || typeof libraries !== "object") return;
  libraryUrls.clear();
  for (const [name, url] of Object.entries(libraries)) {
    if (typeof name === "string" && typeof url === "string" && name && url) libraryUrls.set(name, url);
  }
  // Drop cached copies of builds that are no longer referenced.
  const wanted = new Set([...libraryUrls.values()].map((url) => new URL(url, self.location.href).href));
  caches
    .open(LIBRARY_CACHE)
    .then(async (cache) => {
      for (const request of await cache.keys()) if (!wanted.has(request.url)) await cache.delete(request);
    })
    .catch(() => {});
}

async function serveLibrary(name) {
  const url = libraryUrls.get(name);
  if (!url) return null;
  const cache = await caches.open(LIBRARY_CACHE);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) return null;
    await cache.put(url, response.clone());
  }
  return new Response(response.body, {
    status: 200,
    headers: { "Content-Type": "text/javascript;charset=utf-8", "Cache-Control": "no-store" },
  });
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

function registerSession(token, files, libraries) {
  setLibraries(libraries);
  const store = new Map();
  if (files && typeof files === "object") {
    for (const [rawPath, file] of Object.entries(files)) {
      const key = normalizePath(rawPath);
      if (!key) continue;
      store.set(key, buildFileEntry(file || {}));
    }
  }
  sessions.set(token, store);
}

function updateFile(token, rawPath, file) {
  const store = sessions.get(token);
  if (!store) return;
  const key = normalizePath(rawPath);
  if (!key) return;
  store.set(key, buildFileEntry(file || {}));
}

function deleteFileFromSession(token, rawPath) {
  const store = sessions.get(token);
  if (!store) return;
  const key = normalizePath(rawPath);
  if (!key) return;
  store.delete(key);
}

function renameFileInSession(token, fromPath, toPath) {
  const store = sessions.get(token);
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

function unregisterSession(token) {
  sessions.delete(token);
}

function requestSessionSnapshot(client, token) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), RECOVERY_TIMEOUT_MS);

    channel.port1.onmessage = (event) =>
      finish(event.data?.ok ? { files: event.data.files, libraries: event.data.libraries } : null);
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
  if (pending) return pending;

  const recovery = (async () => {
    // The app itself is outside this worker's narrow preview scope, so include
    // uncontrolled same-origin windows when asking for the live page snapshot.
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    let snapshot;
    try {
      snapshot = await Promise.any(
        clients.map(async (client) => {
          const reply = await requestSessionSnapshot(client, token);
          if (!reply || typeof reply.files !== "object" || Array.isArray(reply.files)) throw new Error("Session not owned");
          return reply;
        }),
      );
    } catch {
      return false;
    }
    registerSession(token, snapshot.files, snapshot.libraries);
    return true;
  })();

  pendingRecoveries.set(token, recovery);
  try {
    return await recovery;
  } finally {
    if (pendingRecoveries.get(token) === recovery) pendingRecoveries.delete(token);
  }
}

function lookupFile(token, path) {
  const store = sessions.get(token);
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
  if (!data || typeof data !== "object") return;
  const { type } = data;
  try {
    switch (type) {
      case "html-preview/register":
        registerSession(data.token, data.files, data.libraries);
        break;
      case "html-preview/update":
        updateFile(data.token, data.path, data.file);
        break;
      case "html-preview/delete":
        deleteFileFromSession(data.token, data.path);
        break;
      case "html-preview/rename":
        renameFileInSession(data.token, data.fromPath, data.toPath);
        break;
      case "html-preview/unregister":
        unregisterSession(data.token);
        break;
      case "html-preview/ping":
        // No-op; used to confirm the SW is reachable.
        break;
      default:
        return;
    }
    if (event.ports?.[0]) {
      event.ports[0].postMessage({ ok: true });
    }
  } catch (error) {
    if (event.ports?.[0]) {
      event.ports[0].postMessage({ ok: false, error: String(error) });
    }
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = request.url;
  if (!url) return;

  const parsed = parsePreviewUrl(url);
  if (!parsed) return; // Not our scope; let the network handle it.

  event.respondWith(handleFetch(request, parsed));
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
      const response = await serveLibrary(library[1]);
      if (response) return response;
    } catch {
      // Fall through to the 404 below.
    }
  }
  return notFoundResponse(token, path);
}
