import { afterEach, describe, expect, it } from "vitest";
import { mountSkillFiles, setSkillResourceResolver } from "@/features/tools/lib/skillResourceMount";
import { createSkillsProvider } from "./skillsProvider";

afterEach(() => setSkillResourceResolver("test-skills", null));

describe("selected skill resource mounts", () => {
  it("mounts resources from the provider-selected entries without model arguments", async () => {
    createSkillsProvider(
      [
        {
          name: "selected-pdf",
          description: "Selected PDF helper",
          resources: ["scripts/check.py"],
          loadContent: () => "instructions",
          loadResource: (path) => (path === "scripts/check.py" ? "print('ok')" : null),
        },
        {
          name: "selected-data",
          description: "Selected data helper",
          resources: ["assets/schema.json"],
          loadContent: () => "instructions",
          loadResource: (path) => (path === "assets/schema.json" ? '{"type":"object"}' : null),
        },
      ],
      { id: "test-skills", name: "Test skills", description: "Fixture" },
    );

    await expect(mountSkillFiles()).resolves.toEqual({
      "/skills/selected-pdf/scripts/check.py": { content: "print('ok')" },
      "/skills/selected-data/assets/schema.json": { content: '{"type":"object"}' },
    });
  });

  it("returns no mounts when the selected entries have no resources", async () => {
    createSkillsProvider([{ name: "prompt-only", description: "No resources", loadContent: () => "instructions" }], {
      id: "test-skills",
      name: "Test skills",
      description: "Fixture",
    });

    await expect(mountSkillFiles()).resolves.toEqual({});
  });
});
