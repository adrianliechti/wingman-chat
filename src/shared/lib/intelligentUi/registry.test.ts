import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { describeRegistry } from "./registry";
import { COMPONENT_TYPES } from "./schema";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("describeRegistry", () => {
  const registry = describeRegistry();

  it("describes every component with typed props", () => {
    expect(Object.keys(registry.components).sort()).toEqual([...COMPONENT_TYPES].sort());
    for (const [name, component] of Object.entries(registry.components)) {
      expect(["layout", "content", "data", "control", "action"], name).toContain(component.category);
      for (const [prop, description] of Object.entries(component.props)) {
        expect(description.type, `${name}.${prop}`).toMatch(/^[a-z|]+$/);
        expect(typeof description.optional, `${name}.${prop}`).toBe("boolean");
      }
    }
    expect(registry.components.slider).toMatchObject({
      category: "control",
      bind: true,
      children: "none",
      props: {
        min: { type: "number", optional: true, template: true },
        unit: { type: "string", optional: true, template: true },
      },
    });
    expect(registry.components.callout.props.tone).toMatchObject({
      type: "enum",
      values: ["info", "success", "warning", "error"],
      optional: true,
    });
    expect(registry.components.each).toMatchObject({ children: "nodes", bind: false });
    expect(registry.components.chart.props.data).toMatchObject({ type: "array", template: true });
    expect(registry.helpers).toContain("histogram");
  });

  // The language has three descriptions the model may see: the skill reference,
  // the compact chat prompt, and this registry. They must agree.
  it("is fully documented in the skill reference and the chat prompt", () => {
    const reference = read("skills/studio/intelligent-ui/references/components.md");
    const prompt = read("src/features/chat/prompts/intelligent-ui.txt");
    for (const name of COMPONENT_TYPES) {
      expect(reference, `components.md lacks ${name}`).toContain(`\`${name}\``);
      expect(prompt, `prompt lacks ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
    }
    for (const helper of registry.helpers) {
      expect(reference, `components.md lacks helper ${helper}`).toContain(`\`${helper}`);
    }
    for (const action of registry.actions) {
      expect(reference, `components.md lacks action ${action}`).toContain(`"${action}"`);
      expect(prompt, `prompt lacks action ${action}`).toContain(action);
    }
  });
});
