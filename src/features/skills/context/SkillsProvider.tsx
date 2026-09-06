import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import * as opfs from "@/shared/lib/opfs";
import { usePersistentCollection } from "@/shared/hooks/usePersistentCollection";
import type { Skill } from "./SkillsContext";
import { SkillsContext } from "./SkillsContext";

const storage = {
  load: opfs.loadAllSkills,
  store: opfs.saveSkill,
  remove: async (id: string) => {
    const entry = (await opfs.readIndex("skills")).find((entry) => entry.id === id);
    if (entry?.title) await opfs.deleteSkill(entry.title);
  },
};

export function SkillsProvider({ children }: { children: ReactNode }) {
  const { items: skills, put, update, remove, getItems } = usePersistentCollection(storage);
  const addSkill = useCallback(
    (data: Omit<Skill, "id">): Skill => {
      const previous = getItems().find((skill) => skill.name === data.name);
      const skill = { ...data, id: previous?.id ?? crypto.randomUUID() };
      return put(skill);
    },
    [put, getItems],
  );
  const updateSkill = useCallback(
    (id: string, updates: Partial<Omit<Skill, "id">>) => {
      update(id, (skill) => ({ ...skill, ...updates }));
    },
    [update],
  );
  const removeSkill = useCallback(
    (id: string) => {
      void remove(id).catch(() => {});
    },
    [remove],
  );
  const getSkill = useCallback((name: string) => skills.find((skill) => skill.name === name), [skills]);

  const [showSkillCatalog, setShowSkillCatalog] = useState(false);
  const [skillCatalogTarget, setSkillCatalogTarget] = useState<string | null>(null);
  const [skillCatalogReadOnly, setSkillCatalogReadOnly] = useState(false);

  const openSkillCatalog = useCallback((name?: string, readOnly?: boolean) => {
    setSkillCatalogTarget(name ?? null);
    setSkillCatalogReadOnly(readOnly ?? false);
    setShowSkillCatalog(true);
  }, []);

  const closeSkillCatalog = useCallback(() => {
    setShowSkillCatalog(false);
    setSkillCatalogTarget(null);
    setSkillCatalogReadOnly(false);
  }, []);

  return (
    <SkillsContext
      value={{
        skills,
        addSkill,
        updateSkill,
        removeSkill,
        getSkill,
        showSkillCatalog,
        skillCatalogTarget,
        skillCatalogReadOnly,
        openSkillCatalog,
        closeSkillCatalog,
      }}
    >
      {children}
    </SkillsContext>
  );
}
