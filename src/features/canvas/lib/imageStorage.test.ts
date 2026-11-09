import { describe, expect, it } from "vitest";
import { DEFAULTS } from "./recipe";
import { currentVersionId, hydrateImage, legacyVersion } from "./imageStorage";

describe("image storage", () => {
  it("reads images saved before versions and recipes existed", () => {
    const image = hydrateImage(
      "abc",
      { id: "abc", created: "2026-01-02T00:00:00.000Z", updated: null, model: "painter", prompt: "A fox" },
      "data:image/png;base64,AA==",
    );
    expect(image.versions).toEqual([
      legacyVersion({ created: "2026-01-02T00:00:00.000Z", model: "painter", prompt: "A fox" }),
    ]);
    expect(image.versions[0]).toMatchObject({ kind: "generated", prompt: "A fox", model: "painter" });
    expect(image.recipe).toEqual(DEFAULTS);
    expect(image.created?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    expect(currentVersionId(image)).toBe("v1");
  });

  it("normalizes a stored recipe and keeps the version history", () => {
    const versions = [
      { id: "one", kind: "generated" as const, created: "2026-01-01T00:00:00.000Z" },
      { id: "two", kind: "edit" as const, prompt: "Remove the sign", created: "2026-01-03T00:00:00.000Z" },
    ];
    const image = hydrateImage(
      "abc",
      { id: "abc", created: null, updated: null, model: "", prompt: "", versions, recipe: { exposure: 0.5, bogus: 1 } },
      "",
    );
    expect(image.versions).toBe(versions);
    expect(currentVersionId(image)).toBe("two");
    expect(image.recipe.exposure).toBe(0.5);
    expect(image.recipe.mixer).toHaveLength(8);
  });
});
