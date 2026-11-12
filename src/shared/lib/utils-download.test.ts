import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "./utils";

const bytes = new Uint8Array([0x50, 0x4b, 0, 0xff, 0x80, 1]);
const blob = new Blob([bytes], {
  type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
});
const filename = "presentation.pptx";
let click: ReturnType<typeof vi.fn>;
const createObjectURL = vi.fn(() => "blob:download");
const revokeObjectURL = vi.fn();

beforeEach(() => {
  click = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({ click, href: "", download: "" }),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  });
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native file saves", () => {
  it("calls the save picker with window as its receiver", async () => {
    const picker = vi.fn(async function (this: Window) {
      expect(this).toBe(window);
      return { createWritable: async () => new WritableStream() };
    });
    vi.stubGlobal("window", { showSaveFilePicker: picker });

    await downloadBlob(blob, filename);

    expect(picker).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
  });

  it.each([
    ["notes.md", "text/markdown;charset=utf-8", "text/markdown", ".md"],
    ["table.csv", "text/csv;charset=utf-8", "text/csv", ".csv"],
    ["notes.txt", "text/plain; charset=utf-8", "text/plain", ".txt"],
    ["source.c++", "text/plain", "text/plain", ".c++"],
    ["report.abcdefghijklmno", "text/plain", "text/plain", ".abcdefghijklmno"],
  ])("saves %s with parameter-free picker filters and unchanged bytes", async (name, type, mimeType, ext) => {
    const source = new Blob([bytes], { type });
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const picker = vi.fn(async () => ({
      createWritable: async () =>
        new WritableStream({
          write: (chunk) => {
            chunks.push(chunk);
          },
        }),
    }));
    vi.stubGlobal("window", { showSaveFilePicker: picker });

    await downloadBlob(source, name);

    expect(picker).toHaveBeenCalledExactlyOnceWith({
      suggestedName: name,
      types: [{ accept: { [mimeType]: [ext] } }],
    });
    expect(source.type).toBe(type);
    expect(new Uint8Array(await new Blob(chunks).arrayBuffer())).toEqual(bytes);
    expect(click).not.toHaveBeenCalled();
  });

  it.each(["query.sql~", "report.abcdefghijklmnop", "report.日本語", "file.", "README"])(
    "saves %s without an unsupported picker filter",
    async (name) => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      const picker = vi.fn(async () => ({
        createWritable: async () =>
          new WritableStream({
            write(chunk) {
              chunks.push(chunk);
            },
          }),
      }));
      vi.stubGlobal("window", { showSaveFilePicker: picker });

      await downloadBlob(blob, name);

      expect(picker).toHaveBeenCalledExactlyOnceWith({ suggestedName: name, types: undefined });
      expect(new Uint8Array(await new Blob(chunks).arrayBuffer())).toEqual(bytes);
      expect(click).not.toHaveBeenCalled();
    },
  );

  it("preserves binary bytes and waits for the destination to finish closing", async () => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let finishClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve;
    });
    const close = vi.fn(() => closing);
    const writable = new WritableStream({
      write(chunk) {
        chunks.push(chunk);
      },
      close,
    });
    const picker = vi.fn(async () => ({ createWritable: async () => writable }));
    vi.stubGlobal("window", { showSaveFilePicker: picker });
    const finished = vi.fn();
    const saving = downloadBlob(blob, filename).then(finished);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    finishClose();
    await saving;
    expect(new Uint8Array(await new Blob(chunks).arrayBuffer())).toEqual(bytes);
    expect(finished).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("quietly stops when the picker is cancelled without starting a download", async () => {
    vi.stubGlobal("window", {
      showSaveFilePicker: async () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    });
    await downloadBlob(blob, filename);
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["create-writable", "write", "close"] as const)(
    "propagates AbortError during %s instead of treating it as cancellation",
    async (stage) => {
      const failure = new DOMException("The save was blocked", "AbortError");
      const writable = new WritableStream({
        write() {
          if (stage === "write") throw failure;
        },
        close() {
          if (stage === "close") throw failure;
        },
      });
      vi.stubGlobal("window", {
        showSaveFilePicker: async () => ({
          createWritable: async () => {
            if (stage === "create-writable") throw failure;
            return writable;
          },
        }),
      });
      await expect(downloadBlob(blob, filename)).rejects.toBe(failure);
      expect(createObjectURL).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith("Failed to save file:", failure);
    },
  );

  it("propagates a disk failure without closing the stream or starting a fallback download", async () => {
    const failure = new Error("Disk full");
    const close = vi.fn();
    const writable = new WritableStream({
      write() {
        throw failure;
      },
      close,
    });
    vi.stubGlobal("window", { showSaveFilePicker: async () => ({ createWritable: async () => writable }) });
    await expect(downloadBlob(blob, filename)).rejects.toBe(failure);
    expect(close).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("reports unexpected picker errors instead of silently changing download paths", async () => {
    const failure = new TypeError("Invalid file type");
    vi.stubGlobal("window", { showSaveFilePicker: async () => Promise.reject(failure) });
    await expect(downloadBlob(blob, filename)).rejects.toBe(failure);
    expect(console.error).toHaveBeenCalledWith("Failed to open save dialog:", failure);
    expect(click).not.toHaveBeenCalled();
  });
});

describe("browser download fallback", () => {
  it.each(["unavailable", "SecurityError", "NotAllowedError"])(
    "downloads through an anchor when the picker is %s",
    async (mode) => {
      vi.useFakeTimers();
      vi.stubGlobal("window", {
        showSaveFilePicker:
          mode === "unavailable"
            ? undefined
            : async () => {
                throw new DOMException("Picker unavailable in this context", mode);
              },
      });
      await downloadBlob(blob, filename);
      expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
      expect(click).toHaveBeenCalledOnce();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:download");
    },
  );

  it("does not reopen the picker when the caller requests the fallback", async () => {
    vi.useFakeTimers();
    const picker = vi.fn();
    vi.stubGlobal("window", { showSaveFilePicker: picker });
    await downloadBlob(blob, filename, { usePicker: false });
    expect(picker).not.toHaveBeenCalled();
    expect(click).toHaveBeenCalledOnce();
  });
});
