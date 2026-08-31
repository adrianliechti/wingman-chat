import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  assertOoxmlInputSize,
  loadMediaDataUrl,
  normalizeHexColor,
  OoxmlPackageReader,
  sanitizeCssColor,
  sanitizeHyperlinkUrl,
} from "./ooxml";

async function loadedZip(entries: Record<string, Uint8Array | string>): Promise<JSZip> {
  const authored = new JSZip();
  for (const [path, content] of Object.entries(entries)) authored.file(path, content);
  return JSZip.loadAsync(await authored.generateAsync({ type: "uint8array", compression: "STORE" }));
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("OOXML preview resource policy", () => {
  it("rejects oversized compressed input before archive parsing", () => {
    expect(() => assertOoxmlInputSize(new ArrayBuffer(6), 5)).toThrow("compressed input limit");
  });

  it("rejects oversized entries and cumulative declared inflation before parsing", async () => {
    const zip = await loadedZip({ "one.xml": "123456", "two.xml": "abcdef" });

    expect(() => new OoxmlPackageReader(zip, { maxArchiveEntryBytes: 5 })).toThrow("archive entry limit");
    expect(() => new OoxmlPackageReader(zip, { maxTotalInflatedBytes: 10 })).toThrow("total inflated limit");
  });

  it("bounds decoded image pixels before producing a data URL", async () => {
    const zip = await loadedZip({ "word/media/image1.png": pngHeader(3, 2) });
    const reader = new OoxmlPackageReader(zip, { maxImagePixels: 4 });

    await expect(loadMediaDataUrl(reader, new Map(), "word/media/image1.png")).rejects.toThrow("pixel image limit");
  });

  it("rejects raster data whose header does not match its media type", async () => {
    const zip = await loadedZip({ "word/media/image1.jpg": pngHeader(3, 2) });

    await expect(loadMediaDataUrl(new OoxmlPackageReader(zip), new Map(), "word/media/image1.jpg")).rejects.toThrow(
      "malformed raster image header",
    );
  });

  it("rejects active or externally-referencing SVG image content", async () => {
    const zip = await loadedZip({
      "ppt/media/image1.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    });

    await expect(loadMediaDataUrl(new OoxmlPackageReader(zip), new Map(), "ppt/media/image1.svg")).rejects.toThrow(
      "forbidden SVG content",
    );
  });
});

describe("OOXML hyperlink policy", () => {
  it("allows ordinary navigation schemes and blocks browser-normalized script schemes", () => {
    expect(sanitizeHyperlinkUrl("https://example.com/report")).toBe("https://example.com/report");
    expect(sanitizeHyperlinkUrl("mailto:person@example.com")).toBe("mailto:person@example.com");
    expect(sanitizeHyperlinkUrl("#Sheet1!A1")).toBe("#Sheet1!A1");
    expect(sanitizeHyperlinkUrl("java\nscript:alert(1)")).toBeUndefined();
    expect(sanitizeHyperlinkUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(sanitizeHyperlinkUrl("file:///etc/passwd")).toBeUndefined();
  });
});

describe("OOXML generated-style policy", () => {
  it("accepts ordinary colors and rejects attribute/style injection", () => {
    expect(normalizeHexColor("44aaCC")).toBe("44AACC");
    expect(normalizeHexColor('fff" onpointerenter="alert(1)')).toBeUndefined();
    expect(sanitizeCssColor("rgba(12, 34, 56, 0.5)")).toBe("rgba(12, 34, 56, 0.5)");
    expect(sanitizeCssColor('red; background:url("https://example.com")')).toBeUndefined();
  });
});
