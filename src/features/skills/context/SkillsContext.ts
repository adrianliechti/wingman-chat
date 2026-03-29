import { createContext } from "react";
import type { Skill } from "@/features/skills/lib/skillParser";

export type { Skill } from "@/features/skills/lib/skillParser";

export interface SkillsContextType {
  skills: Skill[];
  addSkill: (skill: Omit<Skill, "id">) => Skill;
  updateSkill: (id: string, updates: Partial<Omit<Skill, "id">>) => void;
  removeSkill: (id: string) => void;
  getSkill: (name: string) => Skill | undefined;
}

export const SkillsContext = createContext<SkillsContextType | undefined>(undefined);
