import { useContext } from 'react';
import { SkillsContext } from '@/features/settings/context/SkillsContext';

export function useSkills() {
  const context = useContext(SkillsContext);
  if (context === undefined) {
    throw new Error('useSkills must be used within a SkillsProvider');
  }
  return context;
}
