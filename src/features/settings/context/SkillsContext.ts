import { createContext } from 'react';
import type { Skill } from '@/features/settings/lib/skillParser';

export type { Skill } from '@/features/settings/lib/skillParser';

export interface SkillsContextType {
  skills: Skill[];
  addSkill: (skill: Omit<Skill, 'id'>) => Skill;
  updateSkill: (id: string, updates: Partial<Omit<Skill, 'id'>>) => void;
  removeSkill: (id: string) => void;
  getSkill: (name: string) => Skill | undefined;
  toggleSkill: (id: string) => void;
  getEnabledSkills: () => Skill[];
}

export const SkillsContext = createContext<SkillsContextType | undefined>(undefined);
