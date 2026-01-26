import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ProfileContext } from './ProfileContext';
import type { ProfileSettings } from './ProfileContext';
import * as opfs from '../lib/opfs';
import { getPersonaContent } from '../lib/personas';
import type { PersonaKey } from '../lib/personas';

interface ProfileProviderProps {
  children: ReactNode;
}

const STORAGE_FILE = 'profile.json';

// Helper function to filter out empty/null values from profile settings
const filterEmptySettings = (settings: ProfileSettings): ProfileSettings => {
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
  
  return filtered as ProfileSettings;
};

export function ProfileProvider({ children }: ProfileProviderProps) {
  const [settings, setSettings] = useState<ProfileSettings>({});

  // Load settings from OPFS on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const saved = await opfs.readJson<ProfileSettings>(STORAGE_FILE);
        if (saved) {
          setSettings(prev => ({ ...prev, ...saved }));
        } else {
          // Migration: Check if there are settings in localStorage
          const legacySettings = localStorage.getItem('profile-settings');
          if (legacySettings) {
            try {
              const parsed = JSON.parse(legacySettings);
              // Remove the instructions field if it exists (from old format)
              if ('instructions' in parsed) {
                delete parsed.instructions;
              }
              const cleanedSettings = filterEmptySettings(parsed);
              if (Object.keys(cleanedSettings).length > 0) {
                setSettings(prev => ({ ...prev, ...cleanedSettings }));
                // Save migrated settings to OPFS
                await opfs.writeJson(STORAGE_FILE, cleanedSettings);
              }
              // Remove the old localStorage entry
              localStorage.removeItem('profile-settings');
            } catch (error) {
              console.warn('Failed to migrate legacy profile settings:', error);
            }
          }
        }
      } catch (error) {
        console.warn('Failed to load profile settings:', error);
      }
    };
    
    loadSettings();
  }, []);

  // Save settings to OPFS when they change
  useEffect(() => {
    const saveSettings = async () => {
      try {
        const filteredSettings = filterEmptySettings(settings);
        // Only save if there are non-empty settings
        if (Object.keys(filteredSettings).length > 0) {
          await opfs.writeJson(STORAGE_FILE, filteredSettings);
        } else {
          // If all settings are empty, remove the profile from storage
          await opfs.deleteFile(STORAGE_FILE);
        }
      } catch (error) {
        console.warn('Failed to save profile settings:', error);
      }
    };
    
    saveSettings();
  }, [settings]);

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
    <ProfileContext.Provider value={{ settings, updateSettings, generateInstructions }}>
      {children}
    </ProfileContext.Provider>
  );
}
