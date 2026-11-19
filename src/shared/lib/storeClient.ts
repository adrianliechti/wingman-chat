/**
 * Thin HTTP wrapper around the server store API.
 *
 * Routes follow `/api/v1/...` (see pkg/server/store/handler.go).
 * The server identifies the user via reverse-proxy headers, so this
 * client never needs to send any auth itself.
 */

import { isBackupSessionCurrent } from "./backupLifecycle";
import { BackupBusyError } from "./backupBusy";
import {
  DIRECT_UPLOAD_CHUNK,
  directUploadHashes,
  transferDirectUpload,
  uploadRetryDelay,
  type DirectUploadSession,
} from "./directUpload";

const PREFIX = "/api/v1";

let backupGeneration: string | undefined;

export function setBackupGeneration(generation: string): void {
  backupGeneration = generation;
}

const REQUEST_TIMEOUT_MS = 60_000;
/** Blob and file bodies can be large in either direction. */
const TRANSFER_TIMEOUT_MS = 10 * 60_000;

async function storeFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!isBackupSessionCurrent()) {
    throw new Error("Backup reset in progress. Reload before syncing.");
  }
  const headers = new Headers(init?.headers);
  if (backupGeneration) headers.set("X-Backup-Generation", backupGeneration);
  // A hung request would otherwise hold the sync engines' locks indefinitely.
  const transfer = init?.body !== undefined || /\/(blobs|files)\//.test(input);
  const signal = init?.signal ?? AbortSignal.timeout(transfer ? TRANSFER_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
  // Request bodies are strings, Blobs, or FormData, so they can be resent.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, { ...init, headers, signal });
    if (!isBusy(res) || attempt >= BUSY_RETRIES) return res;
    await res.body?.cancel().catch(() => {});
    await abortableDelay(busyDelay(res, attempt), signal);
  }
}

/** The backend's upload queue is full; it asks the client to come back. */
const BUSY_RETRIES = 2;
const MAX_BUSY_DELAY_MS = 15_000;

function isBusy(res: Response): boolean {
  return res.status === 503 && res.headers.has("Retry-After");
}

function busyDelay(res: Response, attempt: number): number {
  return Math.min(uploadRetryDelay(res, attempt), MAX_BUSY_DELAY_MS);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function ensureOk(res: Response, allowNotFound = false): Promise<Response> {
  if (res.ok || (allowNotFound && res.status === 404)) return res;
  const body = await res.text().catch(() => "");
  if (isBusy(res)) throw new BackupBusyError(body || res.statusText, busyDelay(res, 0));
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

interface ServerUser {
  id: string;
}

interface ServerChatMeta {
  id: string;
  headSeq: number;
  updated: string; // RFC 3339
  deleted?: boolean;
}

interface KeystoreResponse {
  data: string; // raw JSON body
  etag: string;
}

interface AppendRequest {
  id: string;
  frame: string;
}

interface AppendResponse {
  newSeq: number;
}

interface ConditionalOptions {
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

/** The signed-in account, served by /me outside the backup API. */
export async function fetchMe(): Promise<ServerUser> {
  const res = await ensureOk(
    await fetch("/me", { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  );
  const user: Partial<ServerUser> = await res.json();
  if (!user.id) throw new ServerError(401, "Sign in to use online backup.");
  return { id: user.id };
}

export async function getKeystore(): Promise<KeystoreResponse | null> {
  const res = await ensureOk(await storeFetch(`${PREFIX}/keystore`), true);
  if (res.status === 404) return null;
  const etag = unquote(res.headers.get("ETag") ?? "");
  return { data: await res.text(), etag };
}

type PutKeystoreOptions = { ifMatch: string; ifNoneMatch?: never } | { ifMatch?: never; ifNoneMatch: "*" };

/** Returns the new ETag, or throws ServerError(412) on CAS mismatch. */
export async function putKeystore(json: string, opts: PutKeystoreOptions): Promise<string> {
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

/** A changed chat head returns 412; transient backup conflicts remain 409. */
export async function deleteChat(chatId: string, expectedSeq: number): Promise<void> {
  await ensureOk(
    await storeFetch(`${PREFIX}/chats/${encodeURIComponent(chatId)}`, {
      method: "DELETE",
      headers: { "X-Expected-Seq": String(expectedSeq) },
    }),
    true,
  );
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
  const body = data instanceof Blob ? data : new Blob([new Uint8Array(data)]);
  const path = `${PREFIX}/blobs/${encodeURIComponent(blobId)}`;
  if (await tryDirectUpload(path, body, {})) return;
  await fetchOrThrow(path, {
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

type PutFileOptions = ConditionalOptions;

/** Returns the new ETag, or throws ServerError(412) on CAS mismatch. */
export async function putFile(fileId: string, data: Uint8Array, opts: PutFileOptions = {}): Promise<string> {
  const path = `${PREFIX}/files/${encodeURIComponent(fileId)}`;
  const body = new Blob([new Uint8Array(data)]);
  const direct = await tryDirectUpload(path, body, opts);
  if (direct) return unquote(direct.headers.get("ETag") ?? "");
  const res = await storeFetch(path, {
    method: "PUT",
    headers: conditionalHeaders(opts, { "Content-Type": "application/octet-stream" }),
    body,
  });
  if (res.status === 412) throw new ServerError(412, "file conflict");
  await ensureOk(res);
  return unquote(res.headers.get("ETag") ?? "");
}

// Set per backup session; a capability failure disables it until the next one.
let directUploadEnabled = false;

export function setDirectUploads(enabled: boolean): void {
  directUploadEnabled = enabled;
}

async function tryDirectUpload(path: string, body: Blob, opts: ConditionalOptions): Promise<Response | undefined> {
  if (!directUploadEnabled || body.size <= DIRECT_UPLOAD_CHUNK) return;
  const started = await storeFetch(`${path}/upload-session`, {
    method: "POST",
    headers: conditionalHeaders(opts, { "Content-Type": "application/json" }),
    body: JSON.stringify({ size: body.size }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (started.status === 404 || started.status === 405 || started.status === 501) {
    directUploadEnabled = false;
    return;
  }
  await ensureOk(started);
  const session = (await started.json()) as DirectUploadSession;
  const expires = Date.parse(session.expiresAt);
  if (!session.ticket || !Number.isFinite(expires)) throw new Error("Invalid OneDrive upload session");
  const deadline = Math.min(expires, Date.now() + TRANSFER_TIMEOUT_MS);
  // Hash while the transfer runs, so hashing doesn't eat into the deadline.
  const hashes = directUploadHashes(body);
  hashes.catch(() => {});
  const transfer = await transferDirectUpload(session, body, deadline);
  if (transfer === "fallback") {
    directUploadEnabled = false;
    return;
  }
  const payload = JSON.stringify({ ticket: session.ticket, ...(await hashes) });
  const retryable = [425, 429, 500, 502, 503, 504];
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("OneDrive upload session expired before confirmation");
    const result = await storeFetch(`${path}/upload-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(Math.min(remaining, REQUEST_TIMEOUT_MS)),
    }).catch(() => undefined);
    if (result && !retryable.includes(result.status)) return ensureOk(result);
    const delay = result?.status === 425 ? 1000 * 2 ** attempt : uploadRetryDelay(result, attempt);
    if (attempt === 4 || Date.now() + delay >= deadline) {
      if (transfer === "unconfirmed" && (!result || result.status === 425)) {
        throw new Error("OneDrive did not confirm the final upload fragment");
      }
      if (result) return ensureOk(result);
      throw new Error("Could not confirm the OneDrive upload");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }
}

export interface FileUpload extends ConditionalOptions {
  id: string;
  data: Uint8Array;
}

/**
 * Upload several files with one backup index commit. All-or-nothing: throws
 * ServerError(412) if any precondition fails. Returns ETags in input order.
 */
export async function putFiles(files: FileUpload[]): Promise<string[]> {
  const form = new FormData();
  form.append("manifest", JSON.stringify(files.map(({ id, ifMatch, ifNoneMatch }) => ({ id, ifMatch, ifNoneMatch }))));
  for (const file of files) form.append(file.id, new Blob([new Uint8Array(file.data)]), file.id);
  const res = await storeFetch(`${PREFIX}/files`, { method: "POST", body: form });
  if (res.status === 412) throw new ServerError(412, "file conflict");
  await ensureOk(res);
  const body = (await res.json()) as { files?: { id: string; etag: string }[] };
  const results = body.files ?? [];
  if (results.length !== files.length || results.some((result, i) => result.id !== files[i].id || !result.etag)) {
    throw new Error("Invalid batch upload response");
  }
  return results.map((result) => result.etag);
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
