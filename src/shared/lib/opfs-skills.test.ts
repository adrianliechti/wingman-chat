import { beforeEach, expect, it, vi } from "vitest";
import { MemoryOpfs } from "./test-support/memoryOpfs";
import { saveSkill, loadAllSkills, loadSkill } from "./opfs-skills";
import { readIndex, readText } from "./opfs-core";

const memory = new MemoryOpfs();
beforeEach(() => {
  memory.reset();
  vi.stubGlobal("navigator", { storage: { getDirectory: async () => memory.root } });
});

it("a late skill write failure preserves its definition and resources", async () => {
  const skill = {
    id: "id",
    name: "skill",
    description: 'Description: "quoted"\nSecond line',
    content: "Before",
    resources: [{ path: "scripts/old.py", content: "old" }],
  };
  await saveSkill(skill);
  let failed = false;
  memory.beforeWrite = async (path) => {
    if (path.endsWith("SKILL.md") && !failed) {
      failed = true;
      throw new Error("quota");
    }
  };
  await expect(
    saveSkill({ ...skill, content: "After", resources: [{ path: "scripts/new.py", content: "new" }] }),
  ).rejects.toThrow("quota");
  expect(await loadSkill("skill")).toMatchObject(skill);
  expect(await readText("skills/skill/scripts/new.py")).toBeUndefined();
});

it("rapid persisted renames preserve identity and leave one loadable skill", async () => {
  const skill = { id: "id", name: "first", description: "Description", content: "Body" };
  await saveSkill(skill);
  await Promise.all([saveSkill({ ...skill, name: "second" }), saveSkill({ ...skill, name: "third" })]);
  expect((await loadAllSkills()).map(({ id, name }) => ({ id, name }))).toEqual([{ id: "id", name: "third" }]);
  expect(await readText("skills/first/SKILL.md")).toBeUndefined();
  expect(await readText("skills/second/SKILL.md")).toBeUndefined();
});

it("rejects colliding names and resource paths before changing existing skills", async () => {
  const first = { id: "one", name: "first", description: "Description", content: "Body" };
  await saveSkill(first);
  await saveSkill({ ...first, id: "two", name: "second" });
  const before = await readIndex("skills");
  await expect(saveSkill({ ...first, name: "second" })).rejects.toThrow("already exists");
  await expect(saveSkill({ ...first, resources: [{ path: "../second/SKILL.md", content: "broken" }] })).rejects.toThrow(
    "Invalid skill resource",
  );
  expect(await readIndex("skills")).toEqual(before);
});
