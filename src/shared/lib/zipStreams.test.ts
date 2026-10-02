import JSZip from "jszip";
import { afterEach, expect, it, vi } from "vitest";
import { downloadBlob } from "./utils";
import { downloadZip } from "./zipStreams";

vi.mock("./utils", () => ({ downloadBlob: vi.fn() }));
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

it("aborts the output if taking the snapshot fails", async () => {
  const abort = vi.fn();
  const writable = new WritableStream({ abort });
  vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable: async () => writable }) });
  const error = new Error("Storage read failed");
  await expect(
    downloadZip("backup.zip", async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(abort).toHaveBeenCalledExactlyOnceWith(error);
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
