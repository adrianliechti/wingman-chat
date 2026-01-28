import type { ReactNode } from 'react';
import { ProfileContext } from './ProfileContext';
import type { ProfileSettings } from './ProfileContext';
import { usePersistedState } from '../hooks/usePersistedState';
import { getPersonaContent } from '../lib/personas';
import type { PersonaKey } from '../lib/personas';

interface ProfileProviderProps {
  children: ReactNode;
}

// Helper function to filter out empty/null values from profile settings
const filterEmptySettings = (settings: ProfileSettings): ProfileSettings | undefined => {
  const filtered: Record<string, unknown> = {};
  
  Object.keys(settings).forEach(key => {
    const value = settings[key as keyof ProfileSettings];
    if (Array.isArray(value)) {
      const nonEmptyValues = value.filter(item => item?.trim());
      if (nonEmptyValues.length > 0) {
        filtered[key] = nonEmptyValues;
      }
    } else if (typeof value === 'string' && value.trim()) {
      filtered[key] = value;
    }
  });
  
  // Return undefined if empty (will delete file)
  return Object.keys(filtered).length > 0 ? filtered as ProfileSettings : undefined;
};

export function ProfileProvider({ children }: ProfileProviderProps) {
  const { value: settings, setValue: setSettings, isLoaded } = usePersistedState<ProfileSettings>({
    key: 'profile.json',
    defaultValue: {},
    debounceMs: 300,
    
    migrate: () => {
      const legacySettings = localStorage.getItem('profile-settings');
      if (legacySettings) {
        try {
          const parsed = JSON.parse(legacySettings);
          if ('instructions' in parsed) {
            delete parsed.instructions;
          }
          localStorage.removeItem('profile-settings');
          return filterEmptySettings(parsed) || {};
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    
    onLoad: (data) => filterEmptySettings(data) || {},
    onSave: (data) => filterEmptySettings(data),
  });

  const updateSettings = (updates: Partial<ProfileSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  };

  const generateInstructions = (): string => {
    const sections: string[] = [];
    
    // Add persona/personality first
    const personaContent = getPersonaContent(settings.persona as PersonaKey);
    
    if (personaContent) {
      sections.push(personaContent);
    }
    
    // Add user profile
    const profileParts: string[] = [];
    if (settings.name) profileParts.push(`- **Name**: ${settings.name.trim()}`);
    if (settings.role) profileParts.push(`- **Role**: ${settings.role.trim()}`);
    if (settings.profile) profileParts.push(`- **About**: ${settings.profile.trim()}`);
    
    if (profileParts.length > 0) {
      sections.push(`## User Profile\n\n${profileParts.join('\n')}`);
    }
    
    return sections.join('\n\n');
  };

  return (
    <ProfileContext.Provider value={{ settings, updateSettings, generateInstructions, isLoaded }}>
      {children}
    </ProfileContext.Provider>
  );
}
