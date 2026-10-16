import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { notify } from "./notify";
import { downloadBlob } from "./utils";
import { downloadZip } from "./zipStreams";

vi.mock("./utils", () => ({ downloadBlob: vi.fn() }));
vi.mock("./notify", () => ({ notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("opens the picker before building the ZIP and streams a valid archive with backpressure", async () => {
  const data = new Uint8Array(256 * 1024);
  for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536));
  const zip = new JSZip().file("large.bin", data);
  const helper = zip.generateInternalStream({ type: "uint8array", compression: "DEFLATE", streamFiles: true });
  let emitted = 0;
  helper.on("data", (chunk) => {
    emitted += chunk.byteLength;
  });
  vi.spyOn(zip, "generateInternalStream").mockReturnValue(helper);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const close = vi.fn();
  const writable = new WritableStream<Uint8Array<ArrayBuffer>>({
    async write(chunk) {
      chunks.push(chunk);
      await held;
    },
    close,
  });
  let choose!: (handle: unknown) => void;
  const picker = vi.fn(
    () =>
      new Promise((resolve) => {
        choose = resolve;
      }),
  );
  vi.stubGlobal("window", { showSaveFilePicker: picker });
  const createZip = vi.fn(async () => zip);
  const downloading = downloadZip("backup.zip", createZip);
  expect(picker).toHaveBeenCalledOnce();
  expect(createZip).not.toHaveBeenCalled();
  choose({ createWritable: async () => writable });
  await vi.waitFor(() => expect(chunks.length).toBeGreaterThan(0));
  expect(emitted).toBeLessThan(65536);
  release();
  await downloading;
  expect(close).toHaveBeenCalledOnce();
  expect(downloadBlob).not.toHaveBeenCalled();
  const archive = await JSZip.loadAsync(await new Blob(chunks).arrayBuffer(), { checkCRC32: true });
  expect(await archive.file("large.bin")!.async("uint8array")).toEqual(data);
});

it("falls back to a Blob download when the picker is unavailable", async () => {
  vi.stubGlobal("window", {});
  await downloadZip("backup.zip", async () => new JSZip().file("a.txt", "content"));
  const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
  expect(filename).toBe("backup.zip");
  expect(blob.type).toBe("application/zip");
  const archive = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
  expect(await archive.file("a.txt")!.async("string")).toBe("content");
});

it("uses the download fallback without reopening a restricted picker", async () => {
  const picker = vi.fn(async () => {
    throw new DOMException("Not permitted in this context", "SecurityError");
  });
  vi.stubGlobal("window", { showSaveFilePicker: picker });
  await downloadZip("backup.zip", async () => new JSZip().file("a.txt", "content"));
  expect(picker).toHaveBeenCalledOnce();
  expect(downloadBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), "backup.zip", { usePicker: false });
});

it("does no snapshot work or fallback download after picker cancellation", async () => {
  vi.stubGlobal("window", {
    showSaveFilePicker: async () => {
      throw new DOMException("Cancelled", "AbortError");
    },
  });
  const createZip = vi.fn(async () => new JSZip());
  await downloadZip("backup.zip", createZip);
  expect(createZip).not.toHaveBeenCalled();
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("leaves the chosen file untouched if taking the snapshot fails", async () => {
  const createWritable = vi.fn();
  vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable }) });
  const error = new Error("Storage read failed");
  await expect(
    downloadZip("backup.zip", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(createWritable).not.toHaveBeenCalled();
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("reports a disk write failure without starting a fallback download", async () => {
  const error = new Error("Disk full");
  const writable = new WritableStream({
    write() {
      throw error;
    },
  });
  vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable: async () => writable }) });
  await expect(downloadZip("backup.zip", async () => new JSZip().file("a.txt", "content"))).rejects.toBe(error);
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("retries a locked file once and keeps the archive the user chose", async () => {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const createWritable = vi
    .fn<() => Promise<WritableStream>>()
    .mockRejectedValueOnce(new DOMException("The file is locked", "NoModificationAllowedError"))
    .mockResolvedValueOnce(
      new WritableStream({
        write(chunk) {
          chunks.push(chunk);
        },
      }),
    );
  vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable }) });
  const progress: number[] = [];
  await downloadZip(
    "backup.zip",
    async () => new JSZip().file("a.txt", "content"),
    (fraction) => progress.push(fraction),
  );
  expect(createWritable).toHaveBeenCalledTimes(2);
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(notify.warning).not.toHaveBeenCalled();
  // The retry restarts the archive, so progress must restart with it.
  expect(progress.at(-1)).toBe(1);
  const archive = await JSZip.loadAsync(await new Blob(chunks).arrayBuffer(), { checkCRC32: true });
  expect(await archive.file("a.txt")!.async("string")).toBe("content");
});

it("downloads the backup when the chosen folder stays unwritable", async () => {
  const error = new DOMException("The file is locked", "NoModificationAllowedError");
  const createWritable = vi.fn(async () => new WritableStream({ write: () => Promise.reject(error) }));
  vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable }) });
  await downloadZip("backup.zip", async () => new JSZip().file("a.txt", "content"));
  expect(createWritable).toHaveBeenCalledTimes(2);
  expect(notify.warning).toHaveBeenCalledOnce();
  const [blob, filename, options] = vi.mocked(downloadBlob).mock.calls[0];
  expect([filename, options]).toEqual(["backup.zip", { usePicker: false }]);
  const archive = await JSZip.loadAsync(await blob.arrayBuffer(), { checkCRC32: true });
  expect(await archive.file("a.txt")!.async("string")).toBe("content");
});

it("does not announce a fallback download when generating or delivering it fails", async () => {
  const error = new Error("Download failed");
  vi.mocked(downloadBlob).mockRejectedValueOnce(error);
  vi.stubGlobal("window", {
    showSaveFilePicker: async () => ({
      createWritable: async () => {
        throw new DOMException("The file is locked", "NoModificationAllowedError");
      },
    }),
  });
  await expect(downloadZip("backup.zip", async () => new JSZip().file("a.txt", "content"))).rejects.toBe(error);
  expect(notify.warning).not.toHaveBeenCalled();
});
