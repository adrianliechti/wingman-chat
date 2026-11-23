import { isBackupSessionCurrent } from "./backupLifecycle";

// Objects above this size use an upload session; it matches the backend.
export const DIRECT_UPLOAD_CHUNK = 10 * 1024 * 1024;

// Graph requires fragments in multiples of 320 KiB and below 60 MiB. Each one
// costs about a second of fixed latency on personal OneDrive; larger fragments
// are faster but resend more data when a fragment fails.
export const DIRECT_UPLOAD_FRAGMENT = 96 * 320 * 1024; // 30 MiB

// These URLs are credentials. Share the allowlist with fetch telemetry so the
// complete URL never becomes a span attribute. Personal accounts upload to
// my.microsoftpersonalcontent.com.
export const ONE_DRIVE_UPLOAD_URL =
  /^https:\/\/(?:[a-z0-9-]+\.)*(?:1drv\.com|sharepoint\.com|storage\.live\.com|onedrive\.com|microsoftpersonalcontent\.com)(?::443)?(?:\/|$)/i;

export interface DirectUploadSession {
  uploadUrl: string;
  ticket: string;
  expiresAt: string;
}

/** Hash ciphertext in bounded slices. QuickXorHash checks transfer integrity
 * against Graph metadata. SHA-256 preserves Wingman's content ETag. */
export async function directUploadHashes(body: Blob): Promise<{ sha256: string; quickXor: string }> {
  const { createSHA256 } = await import("hash-wasm");
  const sha256 = await createSHA256();
  const quick = new Uint8Array(20);
  let shift = 0;
  for (let offset = 0; offset < body.size; offset += DIRECT_UPLOAD_CHUNK) {
    const bytes = new Uint8Array(await body.slice(offset, offset + DIRECT_UPLOAD_CHUNK).arrayBuffer());
    sha256.update(bytes);
    for (const byte of bytes) {
      const index = shift >> 3;
      const bits = shift & 7;
      quick[index] ^= byte << bits;
      quick[index === 19 ? 0 : index + 1] ^= byte >> (8 - bits);
      shift += 11;
      if (shift >= 160) shift -= 160;
    }
  }
  let length = body.size;
  for (let index = 12; index < 20; index++) {
    quick[index] ^= length & 255;
    length = Math.floor(length / 256);
  }
  return { sha256: sha256.digest("hex"), quickXor: btoa(String.fromCharCode(...quick)) };
}

export function uploadRetryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("Retry-After");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const time = Date.parse(retryAfter);
    if (Number.isFinite(time)) return Math.max(0, time - Date.now());
  }
  return 250 * 2 ** attempt;
}

/** "sent": Graph confirmed the last fragment, or retired the session after it.
 * "unconfirmed": the last fragment kept failing; only completion can tell.
 * "fallback": the first cross-origin request failed, so the backend can
 * safely relay the object instead. */
export type DirectTransferResult = "sent" | "unconfirmed" | "fallback";

/** Send only ciphertext to Graph. */
export async function transferDirectUpload(
  session: DirectUploadSession,
  body: Blob,
  deadline: number,
): Promise<DirectTransferResult> {
  if (!ONE_DRIVE_UPLOAD_URL.test(session.uploadUrl)) throw new Error("Invalid OneDrive upload host");
  const graphFetch = async (init: RequestInit) => {
    if (!isBackupSessionCurrent()) throw new Error("Backup changed during direct upload");
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("OneDrive upload session expired");
    return fetch(session.uploadUrl, {
      ...init,
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(remaining),
    }).catch(() => undefined);
  };

  for (let offset = 0; offset < body.size;) {
    const end = Math.min(offset + DIRECT_UPLOAD_FRAGMENT, body.size);
    const final = end === body.size;
    for (let attempt = 0; ; attempt++) {
      const response = await graphFetch({
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Range": `bytes ${offset}-${end - 1}/${body.size}`,
        },
        body: body.slice(offset, end),
      });
      if (final && (response?.status === 200 || response?.status === 201)) return "sent";
      if (!final && response?.status === 202) break;
      if (!response && offset === 0 && attempt === 0) {
        // The first fragment can't complete a file larger than one chunk.
        // A blocked CORS response can still mean Graph received the fragment.
        return "fallback";
      }
      const status = response?.status;
      const retryable = !status || status === 416 || status === 429 || status >= 500;
      if (!retryable) throw new Error(`OneDrive upload failed (HTTP ${status})`);
      const delay = uploadRetryDelay(response, attempt);
      if (Date.now() + delay >= deadline) throw new Error("OneDrive is taking too long to accept the upload");
      await new Promise<void>((resolve) => setTimeout(resolve, delay));

      if (status !== 429) {
        const progress = await graphFetch({ method: "GET" });
        if (progress?.ok) {
          const state = (await progress.json().catch(() => null)) as { nextExpectedRanges?: string[] } | null;
          if (!final && state?.nextExpectedRanges?.[0]?.split("-")[0] === String(end)) break;
        } else if (final && (!progress || progress.status === 404 || progress.status === 410)) {
          // The last PUT may have completed and retired the session.
          return "sent";
        }
      }
      if (attempt === 2) {
        if (final && status !== 429) return "unconfirmed";
        throw new Error("OneDrive upload interrupted");
      }
    }
    offset = end;
  }
  return "sent";
}
