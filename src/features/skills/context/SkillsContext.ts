import { createContext } from "react";
import type { Skill } from "@/features/skills/lib/skillParser";
import type { LibrarySection } from "@/features/agent/components/LibraryDialog";

export type { Skill } from "@/features/skills/lib/skillParser";

export interface SkillsContextType {
  skills: Skill[];
  addSkill: (skill: Omit<Skill, "id">) => Skill;
  updateSkill: (id: string, updates: Partial<Omit<Skill, "id">>) => void;
  removeSkill: (id: string) => void;
  getSkill: (name: string) => Skill | undefined;
  showSkillCatalog: boolean;
  skillCatalogTarget: string | null;
  skillCatalogSection: LibrarySection;
  skillCatalogReadOnly: boolean;
  openSkillCatalog: (name?: string, readOnly?: boolean, section?: LibrarySection) => void;
  closeSkillCatalog: () => void;
}

export const SkillsContext = createContext<SkillsContextType | undefined>(undefined);
