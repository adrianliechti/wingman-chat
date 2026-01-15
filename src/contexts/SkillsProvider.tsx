import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { SkillsContext } from './SkillsContext';
import type { Skill } from './SkillsContext';
import { setValue, getValue } from '../lib/db';

interface SkillsProviderProps {
  children: ReactNode;
}

const STORAGE_KEY = 'skills';

export function SkillsProvider({ children }: SkillsProviderProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load skills from database on mount
  useEffect(() => {
    const loadSkills = async () => {
      try {
        const saved = await getValue<Skill[]>(STORAGE_KEY);
        if (saved && Array.isArray(saved)) {
          setSkills(saved);
        }
      } catch (error) {
        console.warn('Failed to load skills:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    
    loadSkills();
  }, []);

  // Save skills to database when they change (after initial load)
  useEffect(() => {
    if (!isLoaded) return;
    
    const saveSkills = async () => {
      try {
        await setValue(STORAGE_KEY, skills);
      } catch (error) {
        console.warn('Failed to save skills:', error);
      }
    };
    
    saveSkills();
  }, [skills, isLoaded]);

  const addSkill = (skillData: Omit<Skill, 'id'>): Skill => {
    const newSkill: Skill = {
      ...skillData,
      id: crypto.randomUUID(),
    };
    
    // Check for duplicate name and overwrite if exists
    setSkills(prev => {
      const existingIndex = prev.findIndex(s => s.name === skillData.name);
      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = { ...newSkill, id: prev[existingIndex].id };
        return updated;
      }
      return [...prev, newSkill];
    });
    
    return newSkill;
  };

  const updateSkill = (id: string, updates: Partial<Omit<Skill, 'id'>>) => {
    setSkills(prev => 
      prev.map(skill => 
        skill.id === id ? { ...skill, ...updates } : skill
      )
    );
  };

  const removeSkill = (id: string) => {
    setSkills(prev => prev.filter(skill => skill.id !== id));
  };

  const getSkill = (name: string): Skill | undefined => {
    return skills.find(skill => skill.name === name);
  };

  const toggleSkill = (id: string) => {
    setSkills(prev => 
      prev.map(skill => 
        skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
      )
    );
  };

  const getEnabledSkills = (): Skill[] => {
    return skills.filter(skill => skill.enabled);
  };

  return (
    <SkillsContext.Provider
      value={{
        skills,
        addSkill,
        updateSkill,
        removeSkill,
        getSkill,
        toggleSkill,
        getEnabledSkills,
      }}
    >
      {children}
    </SkillsContext.Provider>
  );
}
