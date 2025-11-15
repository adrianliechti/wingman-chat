import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { ProfileContext } from './ProfileContext';
import type { ProfileSettings } from './ProfileContext';
import { setValue, getValue, deleteValue } from '../lib/db';

interface ProfileProviderProps {
  children: ReactNode;
}

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

  // Load settings from database on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const saved = await getValue<ProfileSettings>('profile');
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
                // Save migrated settings to database
                await setValue('profile', cleanedSettings);
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

  // Save settings to database when they change
  useEffect(() => {
    const saveSettings = async () => {
      try {
        const filteredSettings = filterEmptySettings(settings);
        // Only save if there are non-empty settings
        if (Object.keys(filteredSettings).length > 0) {
          await setValue('profile', filteredSettings);
        } else {
          // If all settings are empty, remove the profile from storage
          await deleteValue('profile');
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
    const parts: string[] = [];
    
    // Add basic info
    if (settings.name) parts.push(`- **Name**: ${settings.name.trim()}`);
    if (settings.role) parts.push(`- **Role**: ${settings.role.trim()}`);
    if (settings.profile) parts.push(`- **About**: ${settings.profile.trim()}`);
    
    // Add traits
    if (settings.traits?.length) {
      parts.push(`\n### Communication Style\n\nPlease be ${settings.traits.join(', ')} when responding to the user.`);
    }
    
    return parts.length ? `## User Profile\n\n${parts.join('\n')}` : '';
  };

  return (
    <ProfileContext.Provider value={{ settings, updateSettings, generateInstructions }}>
      {children}
    </ProfileContext.Provider>
  );
}
