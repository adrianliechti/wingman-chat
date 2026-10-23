import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadImageStyles } from "./useImageStyles";

const mocks = vi.hoisted(() => ({ templates: vi.fn(), skill: vi.fn(), resource: vi.fn() }));
vi.mock("@/features/skills/lib/templates", () => ({
  loadSkillTemplates: mocks.templates,
  loadSkillTemplate: mocks.skill,
  loadSkillResource: mocks.resource,
}));
beforeEach(() => vi.resetAllMocks());

describe("Canvas image style catalog", () => {
  it("reads the shipped optional reference without loading skill instructions", async () => {
    const path = "/skills/studio/canvas-design/SKILL.md";
    const reference = "references/image-styles.md";
    mocks.templates.mockResolvedValue([{ name: "canvas-design", path, resources: [reference] }]);
    mocks.resource.mockResolvedValue(readFileSync(`skills/studio/canvas-design/${reference}`, "utf8"));
    const styles = (await loadImageStyles())!;
    expect(styles.length).toBeGreaterThan(20);
    expect(new Set(styles.map((style) => style.name)).size).toBe(styles.length);
    expect(styles).toContainEqual({
      name: "Watercolor",
      category: "Artistic",
      prompt: expect.stringContaining("washes"),
    });
    expect(styles.every((style) => style.name && style.prompt && style.category)).toBe(true);
    expect(mocks.resource).toHaveBeenCalledExactlyOnceWith(path, reference);
    expect(mocks.skill).not.toHaveBeenCalled();
  });

  it("supports a deployment still supplying the standalone catalog", async () => {
    const path = "/skills/image-styles/SKILL.md";
    mocks.templates.mockResolvedValue([{ name: "image-styles", path }]);
    mocks.skill.mockResolvedValue({ content: "## Custom\n- **Ink** — crisp ink outlines" });
    expect(await loadImageStyles()).toEqual([{ name: "Ink", category: "Custom", prompt: "crisp ink outlines" }]);
    expect(mocks.skill).toHaveBeenCalledExactlyOnceWith(path);
    expect(mocks.resource).not.toHaveBeenCalled();
  });

  it("returns no presets when the deployment supplies no catalog", async () => {
    mocks.templates.mockResolvedValue([]);
    expect(await loadImageStyles()).toBeNull();
    expect(mocks.skill).not.toHaveBeenCalled();
    expect(mocks.resource).not.toHaveBeenCalled();
  });
});
