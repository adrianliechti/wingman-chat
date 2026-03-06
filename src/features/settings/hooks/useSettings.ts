import { useLayout } from '@/shell/hooks/useLayout';
import { useTheme } from '@/shell/hooks/useTheme';
import { useBackground } from '@/shell/hooks/useBackground';
import { useProfile } from './useProfile';

export const useSettings = () => {
  // Use existing context hooks
  const layoutContext = useLayout();
  const themeContext = useTheme();
  const backgroundContext = useBackground();
  const profileContext = useProfile();
  
  return {
    // Layout settings
    layoutMode: layoutContext.layoutMode,
    setLayoutMode: layoutContext.setLayoutMode,
    // Theme settings (re-export for convenience)
    theme: themeContext.theme,
    setTheme: themeContext.setTheme,
    isDark: themeContext.isDark,
    // Background settings
    backgroundPacks: backgroundContext.backgroundPacks,
    backgroundSetting: backgroundContext.backgroundSetting,
    setBackground: backgroundContext.setBackground,
    // Profile settings
    profile: profileContext.settings,
    updateProfile: profileContext.updateSettings,
    generateInstructions: profileContext.generateInstructions,
  };
};
