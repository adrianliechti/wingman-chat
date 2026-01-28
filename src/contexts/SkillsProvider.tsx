import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { SkillsContext } from './SkillsContext';
import type { Skill } from './SkillsContext';
import * as opfs from '../lib/opfs';

interface SkillsProviderProps {
  children: ReactNode;
}

export function SkillsProvider({ children }: SkillsProviderProps) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Track pending saves for debouncing
  const pendingSaves = useRef<Set<string>>(new Set());
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeletes = useRef<Set<string>>(new Set());

  // Load skills from OPFS on mount
  useEffect(() => {
    const loadSkills = async () => {
      try {
        // Try new folder-based structure first
        const loaded = await opfs.loadAllSkills();
        if (loaded.length > 0) {
          setSkills(loaded);
        } else {
          // Fall back to legacy skills.json for migration
          const legacy = await opfs.readJson<Skill[]>('skills.json');
          if (legacy && Array.isArray(legacy)) {
            setSkills(legacy);
            // Migrate legacy skills to new structure
            for (const skill of legacy) {
              await opfs.saveSkill(skill);
            }
            // Remove legacy file after migration
            await opfs.deleteFile('skills.json');
          }
        }
      } catch (error) {
        console.warn('Failed to load skills:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    
    loadSkills();
  }, []);

  // Debounced save function
  const scheduleSave = useCallback((skillName: string) => {
    pendingSaves.current.add(skillName);
    
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    saveTimeoutRef.current = setTimeout(async () => {
      const namesToSave = Array.from(pendingSaves.current);
      pendingSaves.current.clear();
      
      // Process pending deletes first
      const namesToDelete = Array.from(pendingDeletes.current);
      pendingDeletes.current.clear();
      
      for (const name of namesToDelete) {
        try {
          await opfs.deleteSkill(name);
        } catch (error) {
          console.error(`Error deleting skill ${name}:`, error);
        }
      }
      
      // Get current skills state for saving
      setSkills(currentSkills => {
        // Save each pending skill
        for (const name of namesToSave) {
          const skill = currentSkills.find(s => s.name === name);
          if (skill) {
            opfs.saveSkill(skill).catch(error => {
              console.error(`Error saving skill ${name}:`, error);
            });
          }
        }
        return currentSkills;
      });
    }, 300);
  }, []);

  const addSkill = useCallback((skillData: Omit<Skill, 'id'>): Skill => {
    const newSkill: Skill = {
      ...skillData,
      id: crypto.randomUUID(),
    };
    
    setSkills(prev => {
      const existingIndex = prev.findIndex(s => s.name === skillData.name);
      if (existingIndex >= 0) {
        // Update existing skill
        const updated = [...prev];
        updated[existingIndex] = { ...newSkill, id: prev[existingIndex].id };
        return updated;
      }
      return [...prev, newSkill];
    });
    
    // Schedule save
    if (isLoaded) {
      scheduleSave(skillData.name);
    }
    
    return newSkill;
  }, [isLoaded, scheduleSave]);

  const updateSkill = useCallback((id: string, updates: Partial<Omit<Skill, 'id'>>) => {
    setSkills(prev => {
      const skill = prev.find(s => s.id === id);
      if (!skill) return prev;
      
      const oldName = skill.name;
      const newName = updates.name || oldName;
      
      // If name changed, schedule delete of old name
      if (updates.name && updates.name !== oldName && isLoaded) {
        pendingDeletes.current.add(oldName);
      }
      
      const updated = prev.map(s => 
        s.id === id ? { ...s, ...updates } : s
      );
      
      // Schedule save with new name
      if (isLoaded) {
        scheduleSave(newName);
      }
      
      return updated;
    });
  }, [isLoaded, scheduleSave]);

  const removeSkill = useCallback((id: string) => {
    setSkills(prev => {
      const skill = prev.find(s => s.id === id);
      if (skill && isLoaded) {
        pendingDeletes.current.add(skill.name);
        // Trigger save timeout to process deletes
        scheduleSave('__trigger__');
      }
      return prev.filter(s => s.id !== id);
    });
  }, [isLoaded, scheduleSave]);

  const getSkill = useCallback((name: string): Skill | undefined => {
    return skills.find(skill => skill.name === name);
  }, [skills]);

  const toggleSkill = useCallback((id: string) => {
    setSkills(prev => {
      const skill = prev.find(s => s.id === id);
      if (!skill) return prev;
      
      const updated = prev.map(s => 
        s.id === id ? { ...s, enabled: !s.enabled } : s
      );
      
      if (isLoaded) {
        scheduleSave(skill.name);
      }
      
      return updated;
    });
  }, [isLoaded, scheduleSave]);

  const getEnabledSkills = useCallback((): Skill[] => {
    return skills.filter(skill => skill.enabled);
  }, [skills]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

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
