import { createContext } from 'react';

export interface ProfileSettings {
  name?: string;
  role?: string;
  persona?: string;
  profile?: string;
}

export interface ProfileContextType {
  settings: ProfileSettings;
  updateSettings: (updates: Partial<ProfileSettings>) => void;
  generateInstructions: () => string;
  isLoaded: boolean;
}

export const ProfileContext = createContext<ProfileContextType | undefined>(undefined);
