import { describe, expect, it, vi } from "vitest";
import { runSkillSourceConformance } from "@tanstack/ai-skills/testing";
import { createSkillSource } from "./skillSource";

runSkillSourceConformance(
  () =>
    createSkillSource([
      {
        name: "alpha",
        description: "Alpha",
        loadContent: () => "Alpha instructions",
        resources: ["references/note.md"],
        loadResource: () => "hello",
      },
      { name: "beta", description: "Beta", loadContent: () => "Beta instructions" },
    ]),
  "browser skills",
);

describe("browser skill source", () => {
  it("keeps template bodies lazy and rejects missing, unlisted, and unsafe resources", async () => {
    const loadContent = vi.fn(async () => "Instructions");
    const loadResource = vi.fn(async () => null);
    const source = createSkillSource([
      { name: "pdf", description: "PDF", loadContent, loadResource, resources: ["missing.txt", "../escape.txt"] },
    ]);
    await source.list();
    await source.listResources("pdf");
    expect(loadContent).not.toHaveBeenCalled();
    expect(loadResource).not.toHaveBeenCalled();
    await expect(source.readResource("pdf", "unlisted.txt")).rejects.toThrow("has no resource");
    await expect(source.readResource("pdf", "../escape.txt")).rejects.toThrow("unsafe resource path");
    expect(loadResource).not.toHaveBeenCalled();
    await expect(source.readResource("pdf", "missing.txt")).rejects.toThrow("Failed to load resource");
    await expect(source.load("pdf")).resolves.toBe("Instructions");
  });

  it("keeps plugin identities distinct from personal skills and each other", async () => {
    const source = createSkillSource(
      [undefined, "first", "second", "org/plugin"].map((plugin) => ({
        name: "reports",
        plugin,
        description: "Reports",
        loadContent: () => plugin ?? "Personal",
      })),
    );
    expect((await source.list()).map((skill) => skill.name)).toEqual([
      "reports",
      "first:reports",
      "second:reports",
      "org%2Fplugin:reports",
    ]);
    await expect(source.load("reports")).resolves.toBe("Personal");
    await expect(source.load("first:reports")).resolves.toBe("first");
    await expect(source.load("second:reports")).resolves.toBe("second");
    await expect(source.load("org%2Fplugin:reports")).resolves.toBe("org/plugin");
  });
});
