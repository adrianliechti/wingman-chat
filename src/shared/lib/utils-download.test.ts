import { afterEach, expect, it, vi } from "vitest";
import { downloadBlob } from "./utils";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["available", "unavailable"])(
  "downloads unchanged bytes through the browser when the save picker is %s",
  async (mode) => {
    vi.useFakeTimers();
    const bytes = new Uint8Array([0x50, 0x4b, 0, 0xff, 0x80, 1]);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const filename = "presentation.pptx";
    const click = vi.fn();
    const link = { click, href: "", download: "" };
    const appendChild = vi.fn();
    const removeChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => link,
      body: { appendChild, removeChild },
    });
    const picker = vi.fn(() => {
      throw new Error("Everyday downloads must not open the save picker");
    });
    vi.stubGlobal("window", { showSaveFilePicker: mode === "available" ? picker : undefined });
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await downloadBlob(blob, filename);

    expect(picker).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledExactlyOnceWith(blob);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
    expect(link).toMatchObject({ href: "blob:download", download: filename });
    expect(appendChild).toHaveBeenCalledExactlyOnceWith(link);
    expect(click).toHaveBeenCalledOnce();
    expect(removeChild).toHaveBeenCalledExactlyOnceWith(link);
    // Keep the URL alive long enough for the browser to read large downloads.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:download");
  },
);
