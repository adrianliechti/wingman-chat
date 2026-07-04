/**
 * Thin HTTP wrapper around the server store API.
 *
 * Routes follow `/api/v1/...` (see pkg/server/store/handler.go).
 * The server identifies the user via reverse-proxy headers, so this
 * client never needs to send any auth itself.
 */

const PREFIX = "/api/v1";

export interface ServerUser {
  id: string;
  email?: string;
}

export interface ServerChatMeta {
  id: string;
  headSeq: number;
  updated: string; // RFC 3339
}

export interface KeystoreResponse {
  data: string; // raw JSON body
  etag: string;
}

export interface AppendRequest {
  id: string;
  frame: string;
}

export interface AppendResponse {
  newSeq: number;
  deduped?: string[];
}

export class ServerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`${status}: ${message}`);
    this.status = status;
  }
}

function unquote(s: string): string {
  return s.replace(/^"(.*)"$/, "$1");
}

async function fetchOrThrow(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
  return res;
}

export async function fetchMe(): Promise<ServerUser> {
  const res = await fetchOrThrow(`${PREFIX}/me`);
  return res.json();
}

export async function getKeystore(): Promise<KeystoreResponse | null> {
  const res = await fetch(`${PREFIX}/keystore`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
  const etag = unquote(res.headers.get("ETag") ?? "");
  return { data: await res.text(), etag };
}

export interface PutKeystoreOptions {
  ifMatch?: string;
  ifNoneMatch?: "*";
}

/** Returns the new ETag, or throws ServerError(412) on CAS mismatch. */
export async function putKeystore(json: string, opts: PutKeystoreOptions = {}): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.ifMatch) headers["If-Match"] = `"${opts.ifMatch}"`;
  if (opts.ifNoneMatch) headers["If-None-Match"] = opts.ifNoneMatch;

  const res = await fetch(`${PREFIX}/keystore`, { method: "PUT", headers, body: json });
  if (res.status === 412) throw new ServerError(412, "keystore conflict");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
  return unquote(res.headers.get("ETag") ?? "");
}

export async function listChats(): Promise<ServerChatMeta[]> {
  const res = await fetchOrThrow(`${PREFIX}/chats`);
  return res.json();
}

/** Streams the JSONL response as parsed objects. */
export async function readEvents(
  chatId: string,
  fromSeq: number,
): Promise<{ seq: number; id: string; frame: string }[]> {
  const res = await fetchOrThrow(`${PREFIX}/chats/${encodeURIComponent(chatId)}/events?fromSeq=${fromSeq}`);
  const text = await res.text();
  const out: { seq: number; id: string; frame: string }[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

/** Returns null on 409 (seq conflict), or the AppendResponse on success. */
export async function appendEvents(
  chatId: string,
  expectedSeq: number,
  events: AppendRequest[],
): Promise<AppendResponse | null> {
  const body = events.map((e) => JSON.stringify(e)).join("\n");

  const res = await fetch(`${PREFIX}/chats/${encodeURIComponent(chatId)}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-ndjson",
      "X-Expected-Seq": String(expectedSeq),
    },
    body,
  });

  if (res.status === 409) return null;
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new ServerError(res.status, errBody || res.statusText);
  }
  return res.json();
}

export async function compactChat(chatId: string, beforeSeq: number): Promise<void> {
  const res = await fetch(`${PREFIX}/chats/${encodeURIComponent(chatId)}/compact?beforeSeq=${beforeSeq}`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
}

export async function deleteChat(chatId: string): Promise<void> {
  const res = await fetch(`${PREFIX}/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
}

export async function headBlob(blobId: string): Promise<boolean> {
  const res = await fetch(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`, { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new ServerError(res.status, res.statusText);
  }
  return true;
}

export async function getBlob(blobId: string): Promise<Uint8Array | null> {
  const res = await fetch(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function putBlob(blobId: string, data: Uint8Array | Blob): Promise<void> {
  const body: BodyInit = data instanceof Blob ? data : new Blob([new Uint8Array(data)]);
  const res = await fetch(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new ServerError(res.status, errBody || res.statusText);
  }
}

export async function deleteBlob(blobId: string): Promise<void> {
  const res = await fetch(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
}

export interface ServerFileMeta {
  id: string;
  etag: string;
  updated: string; // RFC 3339
  size: number;
}

export async function listFiles(): Promise<ServerFileMeta[]> {
  const res = await fetchOrThrow(`${PREFIX}/files`);
  return res.json();
}

export async function getFile(fileId: string): Promise<{ data: Uint8Array; etag: string } | null> {
  const res = await fetch(`${PREFIX}/files/${encodeURIComponent(fileId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
  const etag = unquote(res.headers.get("ETag") ?? "");
  return { data: new Uint8Array(await res.arrayBuffer()), etag };
}

export interface PutFileOptions {
  ifMatch?: string;
  ifNoneMatch?: "*";
}

/** Returns the new ETag, or throws ServerError(412) on CAS mismatch. */
export async function putFile(fileId: string, data: Uint8Array, opts: PutFileOptions = {}): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (opts.ifMatch) headers["If-Match"] = `"${opts.ifMatch}"`;
  if (opts.ifNoneMatch) headers["If-None-Match"] = opts.ifNoneMatch;

  const res = await fetch(`${PREFIX}/files/${encodeURIComponent(fileId)}`, {
    method: "PUT",
    headers,
    body: new Blob([new Uint8Array(data)]),
  });
  if (res.status === 412) throw new ServerError(412, "file conflict");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
  return unquote(res.headers.get("ETag") ?? "");
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await fetch(`${PREFIX}/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new ServerError(res.status, body || res.statusText);
  }
}
