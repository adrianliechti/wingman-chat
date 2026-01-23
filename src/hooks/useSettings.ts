import { useLayout } from './useLayout';
import { useTheme } from './useTheme';
import { useBackground } from './useBackground';
import { useProfile } from './useProfile';
import { useSkills } from './useSkills';
import { useBridge } from './useBridge';

export const useSettings = () => {
  // Use existing context hooks
  const layoutContext = useLayout();
  const themeContext = useTheme();
  const backgroundContext = useBackground();
  const profileContext = useProfile();
  const skillsContext = useSkills();
  const bridgeContext = useBridge();
  
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
    // Skills settings
    skills: skillsContext.skills,
    addSkill: skillsContext.addSkill,
    updateSkill: skillsContext.updateSkill,
    removeSkill: skillsContext.removeSkill,
    getSkill: skillsContext.getSkill,
    toggleSkill: skillsContext.toggleSkill,
    getEnabledSkills: skillsContext.getEnabledSkills,
    // Bridge settings
    servers: bridgeContext.servers,
    addServer: bridgeContext.addServer,
    updateServer: bridgeContext.updateServer,
    removeServer: bridgeContext.removeServer,
    toggleServer: bridgeContext.toggleServer,
    getEnabledServers: bridgeContext.getEnabledServers,
  };
};
