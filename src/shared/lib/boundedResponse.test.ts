import { afterEach, describe, expect, it, vi } from "vitest";
import { readResponseBlobWithLimit, ResponseSizeLimitError } from "./boundedResponse";
import { downloadDriveFile } from "./drives";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bounded response materialization", () => {
  it("rejects a reliable oversized Content-Length before reading", async () => {
    let pulled = false;
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled = true;
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { "content-length": "6" } },
    );

    await expect(readResponseBlobWithLimit(response, 5, "Report")).rejects.toMatchObject({
      name: "ResponseSizeLimitError",
      limit: 5,
      observed: 6,
    });
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("counts streamed bytes and cancels as soon as the ceiling is crossed", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );

    await expect(readResponseBlobWithLimit(response, 5)).rejects.toBeInstanceOf(ResponseSizeLimitError);
    expect(cancelled).toBe(true);
  });

  it("does not confuse compressed transport length with decoded body length", async () => {
    const response = new Response("small", {
      headers: {
        "content-encoding": "gzip",
        "content-length": "500",
        "content-type": "text/plain",
      },
    });

    const blob = await readResponseBlobWithLimit(response, 5);
    expect(await blob.text()).toBe("small");
    expect(blob.type).toBe("text/plain");
  });
});

describe("Drive file downloads", () => {
  it("uses provider size metadata to reject before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadDriveFile({ id: "item", driveId: "drive", name: "large.csv", size: 6 }, 5),
    ).rejects.toBeInstanceOf(ResponseSizeLimitError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsuccessful responses instead of wrapping their body as a file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("missing", { status: 404, statusText: "Not Found" })),
    );

    await expect(downloadDriveFile({ id: "item", driveId: "drive", name: "report.csv" }, 100)).rejects.toThrow(
      "Failed to download “report.csv”: 404 Not Found",
    );
  });

  it("returns a typed File after bounded streaming", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("a,b", { headers: { "content-type": "application/octet-stream" } }));
    vi.stubGlobal("fetch", fetchMock);

    const file = await downloadDriveFile(
      { id: "item/1", driveId: "drive", name: "report.csv", mime: "text/csv", size: 3 },
      3,
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/drives/drive/content?id=item%2F1");
    expect(file.name).toBe("report.csv");
    expect(file.type).toBe("text/csv");
    expect(await file.text()).toBe("a,b");
  });
});
