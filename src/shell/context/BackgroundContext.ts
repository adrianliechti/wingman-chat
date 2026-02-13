import { createContext } from 'react';

export interface BackgroundItem {
  url: string;
}

export interface BackgroundPack {
  name: string;
  items: BackgroundItem[];
}

export type BackgroundSetting = string | null;

export interface BackgroundContextValue {
  backgroundPacks: BackgroundPack[];
  backgroundSetting: BackgroundSetting;
  setBackground: (setting: BackgroundSetting) => void;
  backgroundImage: string;
}

export const BackgroundContext = createContext<BackgroundContextValue | undefined>(undefined);
