/**
 * Thin HTTP wrapper around the server store API.
 *
 * Routes follow `/api/v1/...` (see pkg/server/store/handler.go).
 * The server identifies the user via reverse-proxy headers, so this
 * client never needs to send any auth itself.
 */

import { isBackupSessionCurrent } from "./backupLifecycle";

const PREFIX = "/api/v1";

let backupPublicKey: string | undefined;

export function setBackupKey(publicKey: string): void {
  backupPublicKey = publicKey;
}

const REQUEST_TIMEOUT_MS = 60_000;
/** Blob and file bodies can be large in either direction. */
const TRANSFER_TIMEOUT_MS = 10 * 60_000;

async function storeFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!isBackupSessionCurrent() && !input.endsWith("/me")) {
    throw new Error("Backup reset in progress. Reload before syncing.");
  }
  const headers = new Headers(init?.headers);
  if (backupPublicKey) headers.set("X-Backup-Key", backupPublicKey);
  // A hung request would otherwise hold the sync engines' locks indefinitely.
  const transfer = init?.body !== undefined || /\/(blobs|files)\//.test(input);
  const signal = init?.signal ?? AbortSignal.timeout(transfer ? TRANSFER_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, headers, signal });
}

async function ensureOk(res: Response, allowNotFound = false): Promise<Response> {
  if (res.ok || (allowNotFound && res.status === 404)) return res;
  const body = await res.text().catch(() => "");
  throw new ServerError(res.status, body || res.statusText);
}

function conditionalHeaders(opts: ConditionalOptions, base: Record<string, string> = {}): Record<string, string> {
  if (opts.ifMatch) base["If-Match"] = `"${opts.ifMatch}"`;
  if (opts.ifNoneMatch) base["If-None-Match"] = opts.ifNoneMatch;
  return base;
}

/** Only the signed-in account is needed; restore secrets may have been lost. */
export async function resetBackup(): Promise<void> {
  const res = await fetch(`${PREFIX}/backup`, {
    method: "DELETE",
    headers: { "X-Confirm-Backup-Reset": "true" },
  });
  await ensureOk(res);
}

export interface ServerUser {
  id: string;
  email?: string;
  backupDestination?: string;
  previousId?: string;
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
}

export interface ConditionalOptions {
  ifMatch?: string;
  ifNoneMatch?: "*";
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
  return ensureOk(await storeFetch(input, init));
}

export async function fetchMe(): Promise<ServerUser> {
  const res = await fetchOrThrow(`${PREFIX}/me`);
  const user: ServerUser = await res.json();
  return { ...user, backupDestination: res.headers.get("X-Backup-Destination") ?? "server" };
}

export async function getKeystore(): Promise<KeystoreResponse | null> {
  const res = await ensureOk(await storeFetch(`${PREFIX}/keystore`), true);
  if (res.status === 404) return null;
  const etag = unquote(res.headers.get("ETag") ?? "");
  return { data: await res.text(), etag };
}

/** Per-user secret mixed into PIN key derivation, or null when the server has none configured. */
export async function getPinPepper(): Promise<Uint8Array<ArrayBuffer> | null> {
  const res = await ensureOk(await storeFetch(`${PREFIX}/keystore/pepper`), true);
  if (res.status === 404) return null;
  const { pepper } = (await res.json()) as { pepper?: unknown };
  if (typeof pepper !== "string") throw new Error("Invalid PIN pepper response.");
  const bin = atob(pepper);
  if (bin.length !== 32) throw new Error("Invalid PIN pepper response.");
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export type PutKeystoreOptions = ConditionalOptions;

/** Returns the new ETag, or throws ServerError(412) on CAS mismatch. */
export async function putKeystore(json: string, opts: PutKeystoreOptions = {}): Promise<string> {
  const headers = conditionalHeaders(opts, { "Content-Type": "application/json" });
  const res = await storeFetch(`${PREFIX}/keystore`, { method: "PUT", headers, body: json });
  if (res.status === 412) throw new ServerError(412, "keystore conflict");
  await ensureOk(res);
  return unquote(res.headers.get("ETag") ?? "");
}

export async function listChats(): Promise<ServerChatMeta[]> {
  const res = await fetchOrThrow(`${PREFIX}/chats`);
  return res.json();
}

export async function readEvents(
  chatId: string,
  fromSeq: number,
): Promise<{ seq: number; id: string; frame: string }[]> {
  const res = await fetchOrThrow(`${PREFIX}/chats/${encodeURIComponent(chatId)}/events?fromSeq=${fromSeq}`);
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Returns null on 409 (seq conflict), or the AppendResponse on success. */
export async function appendEvents(
  chatId: string,
  expectedSeq: number,
  events: AppendRequest[],
): Promise<AppendResponse | null> {
  const res = await storeFetch(`${PREFIX}/chats/${encodeURIComponent(chatId)}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-ndjson",
      "X-Expected-Seq": String(expectedSeq),
    },
    body: events.map((e) => JSON.stringify(e)).join("\n"),
  });
  if (res.status === 409) return null;
  await ensureOk(res);
  return res.json();
}

export async function compactChat(chatId: string, beforeSeq: number): Promise<void> {
  const url = `${PREFIX}/chats/${encodeURIComponent(chatId)}/compact?beforeSeq=${beforeSeq}`;
  await fetchOrThrow(url, { method: "POST" });
}

export async function deleteChat(chatId: string): Promise<void> {
  await ensureOk(await storeFetch(`${PREFIX}/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" }), true);
}

export async function headBlob(blobId: string): Promise<boolean> {
  const res = await ensureOk(
    await storeFetch(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`, { method: "HEAD" }),
    true,
  );
  return res.status !== 404;
}

export async function getBlob(blobId: string): Promise<Uint8Array | null> {
  const res = await ensureOk(await storeFetch(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`), true);
  if (res.status === 404) return null;
  return new Uint8Array(await res.arrayBuffer());
}

export async function putBlob(blobId: string, data: Uint8Array | Blob): Promise<void> {
  const body: BodyInit = data instanceof Blob ? data : new Blob([new Uint8Array(data)]);
  await fetchOrThrow(`${PREFIX}/blobs/${encodeURIComponent(blobId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
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
  const res = await ensureOk(await storeFetch(`${PREFIX}/files/${encodeURIComponent(fileId)}`), true);
  if (res.status === 404) return null;
  const etag = unquote(res.headers.get("ETag") ?? "");
  return { data: new Uint8Array(await res.arrayBuffer()), etag };
}

export type PutFileOptions = ConditionalOptions;

/** Returns the new ETag, or throws ServerError(412) on CAS mismatch. */
export async function putFile(fileId: string, data: Uint8Array, opts: PutFileOptions = {}): Promise<string> {
  const res = await storeFetch(`${PREFIX}/files/${encodeURIComponent(fileId)}`, {
    method: "PUT",
    headers: conditionalHeaders(opts, { "Content-Type": "application/octet-stream" }),
    body: new Blob([new Uint8Array(data)]),
  });
  if (res.status === 412) throw new ServerError(412, "file conflict");
  await ensureOk(res);
  return unquote(res.headers.get("ETag") ?? "");
}

/** Throws ServerError(412) when `ifMatch` no longer names the current version. */
export async function deleteFile(fileId: string, opts: Pick<ConditionalOptions, "ifMatch"> = {}): Promise<void> {
  const res = await storeFetch(`${PREFIX}/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: conditionalHeaders(opts),
  });
  if (res.status === 412) throw new ServerError(412, "file conflict");
  await ensureOk(res, true);
}

/** Stored encrypted data and metadata, excluding filesystem overhead. */
export async function getBackupSize(): Promise<number> {
  const res = await fetchOrThrow(`${PREFIX}/backup/usage`);
  const data: unknown = await res.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("bytes" in data) ||
    typeof data.bytes !== "number" ||
    !Number.isFinite(data.bytes) ||
    data.bytes < 0
  ) {
    throw new Error("Invalid backup size");
  }
  return data.bytes;
}
