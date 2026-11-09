import { describe, expect, it } from "vitest";
import { exportFilename } from "./exportImage";

describe("exportFilename", () => {
  it("slugs the title or prompt and picks the extension", () => {
    expect(exportFilename("A misty forest at dawn, watercolor", "png")).toBe("a-misty-forest-at-dawn-watercolor.png");
    expect(exportFilename("Holiday 2024 (edit)", "jpeg")).toBe("holiday-2024-edit.jpg");
    expect(exportFilename("Zürich am See", "webp")).toBe("zürich-am-see.webp");
  });

  it("falls back to a generic name", () => {
    expect(exportFilename(undefined, "png")).toBe("image.png");
    expect(exportFilename("   ", "jpeg")).toBe("image.jpg");
  });
});
