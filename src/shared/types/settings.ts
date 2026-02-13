// Centralized settings types for better organization and maintainability

// Layout settings
export type { LayoutMode } from '@/shell/context/LayoutContext';

// Theme settings
export type { Theme } from '@/shell/context/ThemeContext';

// Background settings
export type { 
  BackgroundPack, 
  BackgroundSetting,
  BackgroundItem 
} from '@/shell/context/BackgroundContext';

// Profile settings
export type { 
  ProfileSettings
} from '@/features/settings/context/ProfileContext';
