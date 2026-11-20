import { afterEach, expect, it, vi } from "vitest";
import { DIRECT_UPLOAD_CHUNK, DIRECT_UPLOAD_FRAGMENT, ONE_DRIVE_UPLOAD_URL, directUploadHashes } from "./directUpload";

vi.mock("./backupLifecycle", () => ({ isBackupSessionCurrent: () => true }));

const url = "https://upload.1drv.com/session?secret=test";
const path = "/api/v1/store/files/workspace-file";
const session = () =>
  Response.json({ uploadUrl: url, ticket: "signed-ticket", expiresAt: new Date(Date.now() + 60_000).toISOString() });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("sends only metadata to Wingman, commits a file, and retries ambiguous completion", async () => {
  const data = new Uint8Array(DIRECT_UPLOAD_FRAGMENT + 23).fill(0x22);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(session())
    .mockResolvedValueOnce(new Response(null, { status: 202 }))
    .mockRejectedValueOnce(new TypeError("lost last chunk response"))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockRejectedValueOnce(new TypeError("lost completion response"))
    .mockResolvedValueOnce(new Response(null, { status: 204, headers: { ETag: '"complete"' } }));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);
  api.setBackupGeneration("generation");

  await expect(api.putFile("workspace-file", data, { ifMatch: "previous" })).resolves.toBe("complete");
  const [start, first, last, status, complete, retry] = fetch.mock.calls;
  if (!start[1] || !first[1] || !last[1] || !complete[1]) throw new Error("missing fetch call");
  expect(start[0]).toBe(`${path}/upload-session`);
  expect(new Headers(start[1].headers).get("If-Match")).toBe('"previous"');
  expect(JSON.parse(start[1].body as string)).toEqual({ size: data.length });
  expect(first[0]).toBe(url);
  expect(first[1].credentials).toBe("omit");
  expect(new Headers(first[1].headers).get("Authorization")).toBeNull();
  expect(new Headers(first[1].headers).get("Content-Range")).toBe(
    `bytes 0-${DIRECT_UPLOAD_FRAGMENT - 1}/${data.length}`,
  );
  expect((first[1].body as Blob).size).toBe(DIRECT_UPLOAD_FRAGMENT);
  expect((last[1].body as Blob).size).toBe(23);
  expect(status[0]).toBe(url);
  expect(status[1]?.method).toBe("GET");
  expect(complete[0]).toBe(`${path}/upload-complete`);
  expect(new Headers(complete[1].headers).get("X-Backup-Generation")).toBe("generation");
  expect(JSON.parse(complete[1].body as string)).toMatchObject({
    ticket: "signed-ticket",
    sha256: /^[0-9a-f]{64}$/,
    quickXor: /^[A-Za-z0-9+/]{27}=$/,
  });
  expect(retry[1]?.body).toBe(complete[1]?.body);
});

it("falls back to the normal upload after the first cross-origin request fails", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(session())
    .mockRejectedValueOnce(new TypeError("CORS"))
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);
  const attachment = new Blob([new Uint8Array(DIRECT_UPLOAD_CHUNK + 1)]);

  await api.putBlob("attachment", attachment);
  await api.putBlob("attachment-two", attachment);
  expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
    ["/api/v1/store/blobs/attachment/upload-session", "POST"],
    [url, "PUT"],
    ["/api/v1/store/blobs/attachment", "PUT"],
    ["/api/v1/store/blobs/attachment-two", "PUT"],
  ]);
});

it("computes the SHA-256 and QuickXorHash for the same ciphertext", async () => {
  expect(await directUploadHashes(new Blob(["abc"]))).toEqual({
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    quickXor: "YRDDGAAAAAAAAAAAAwAAAAAAAAA=",
  });
});

it("reports an unconfirmed final fragment when completion never sees the object", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const target = input as string;
    if (target.endsWith("/upload-session")) {
      return Response.json({
        uploadUrl: url,
        ticket: "signed-ticket",
        expiresAt: new Date(Date.now() + 2500).toISOString(),
      });
    }
    if (target.endsWith("/upload-complete")) return new Response(null, { status: 425 });
    const range = new Headers(init?.headers).get("Content-Range");
    if (range?.startsWith("bytes 0-")) return new Response(null, { status: 202 });
    return new Response(null, { status: 503 });
  });
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);

  await expect(api.putBlob("attachment", new Blob([new Uint8Array(DIRECT_UPLOAD_FRAGMENT + 1)]))).rejects.toThrow(
    "OneDrive did not confirm the final upload fragment",
  );
});

it("retries a busy backend, then reports it as BackupBusyError", async () => {
  const busy = () => new Response("busy", { status: 503, headers: { "Retry-After": "0" } });
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(busy())
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValue(busy());
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  const { BackupBusyError } = await import("./backupBusy");

  await api.putBlob("attachment", new Uint8Array(1));
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(api.putBlob("attachment-two", new Uint8Array(1))).rejects.toBeInstanceOf(BackupBusyError);
  expect(fetch).toHaveBeenCalledTimes(5);
});

// Vectors from rclone's QuickXorHash tests, which are checked against OneDrive.
it.each([
  ["", "AAAAAAAAAAAAAAAAAAAAAAAAAAA="],
  ["Sg==", "SgAAAAAAAAAAAAAAAQAAAAAAAAA="],
  ["2fuxhBJXtpWFe8dOfdGeHw==", "O9tHLAghgSvYohKFyMMxnNCHaHg="],
  [
    "Mb7EGva2rEE5fENDL85P+BsapHEEjv2/siVhKjvAQe02feExVOQSkfmuYzU/kTF1MaKjPmKF/w+cbvwfdWL8aQ==",
    "n1anP5NfvD4XDYWIeRPW3ZkPv1Y=",
  ],
])("computes OneDrive's QuickXorHash for %s", async (input, quickXor) => {
  const bytes = Uint8Array.from(atob(input), (c) => c.charCodeAt(0));
  expect((await directUploadHashes(new Blob([bytes]))).quickXor).toBe(quickXor);
});

it("carries hash state across upload-sized slices", async () => {
  const data = new Uint8Array(DIRECT_UPLOAD_CHUNK + 5).map((_, i) => i % 251);
  // Computed by the Go implementation the fake Graph API uses.
  expect(await directUploadHashes(new Blob([data]))).toEqual({
    sha256: "b3584865b8524960d80641e44554a698e299b609021ddf2ae64c30a8ba514f67",
    quickXor: "9FGd0TxJEVeGHsvnfiLLI+WiCqw=",
  });
});

it("relays uploads for the rest of the page when the backend lacks direct uploads", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 501 }))
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);
  const large = new Blob([new Uint8Array(DIRECT_UPLOAD_CHUNK + 1)]);

  await api.putBlob("attachment", large);
  await api.putBlob("attachment-two", large);
  expect(fetch.mock.calls.map(([target]) => target)).toEqual([
    "/api/v1/store/blobs/attachment/upload-session",
    "/api/v1/store/blobs/attachment",
    "/api/v1/store/blobs/attachment-two",
  ]);
});

it("reports a stale file as a 412 conflict before sending data to OneDrive", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("conflict", { status: 412 }));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);

  await expect(
    api.putFile("workspace-file", new Uint8Array(DIRECT_UPLOAD_CHUNK + 1), { ifMatch: "stale" }),
  ).rejects.toMatchObject({ status: 412 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("never sends ciphertext to an upload URL outside OneDrive", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json({
      uploadUrl: "https://1drv.com.attacker.example/upload",
      ticket: "t",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }),
  );
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);

  await expect(api.putBlob("attachment", new Uint8Array(DIRECT_UPLOAD_CHUNK + 1))).rejects.toThrow(
    "Invalid OneDrive upload host",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("uses the relay for small objects and when direct uploads are off", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const api = await import("./storeClient");
  api.setDirectUploads(true);
  await api.putBlob("small", new Uint8Array(DIRECT_UPLOAD_CHUNK));
  api.setDirectUploads(false);
  await api.putBlob("large", new Uint8Array(DIRECT_UPLOAD_CHUNK + 1));
  expect(fetch.mock.calls.map(([target]) => target)).toEqual([
    "/api/v1/store/blobs/small",
    "/api/v1/store/blobs/large",
  ]);
});

it.each([
  ["https://api.onedrive.com/rup/abc", true],
  ["https://contoso-my.sharepoint.com/personal/upload", true],
  ["https://upload.1drv.com/session", true],
  ["https://my.microsoftpersonalcontent.com/personal/abc/uploadSession", true],
  ["https://microsoftpersonalcontent.com.attacker.example/upload", false],
  ["https://1drv.com.attacker.example/upload", false],
  ["https://attacker.example/1drv.com", false],
  ["http://upload.1drv.com/session", false],
])("treats %s as a OneDrive upload URL: %s", (target, allowed) => {
  expect(ONE_DRIVE_UPLOAD_URL.test(target)).toBe(allowed);
});
