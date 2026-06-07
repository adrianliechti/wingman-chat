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

/* eslint-disable no-restricted-globals */

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

function normalizePath(path) {
  if (!path) return "";
  let p = String(path);
  // Strip query string / fragment
  p = p.split("?")[0].split("#")[0];
  // Strip leading ./ and /
  p = p.replace(/^\.\//, "").replace(/^\/+/, "");
  // Resolve any ".." segments (defensive — browser usually resolves first)
  const parts = [];
  for (const seg of p.split("/")) {
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

function registerSession(token, files) {
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
        registerSession(data.token, data.files);
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

  const hit = lookupFile(token, path);
  if (!hit) {
    return notFoundResponse(token, path);
  }
  return buildResponse(hit.entry);
}
