import { useLayout } from "@/shell/hooks/useLayout";
import { useTheme } from "@/shell/hooks/useTheme";
import { useBackground } from "@/shell/hooks/useBackground";
import { useEmoji } from "@/shell/hooks/useEmoji";
import { useProfile } from "./useProfile";

export const useSettings = () => {
  const layoutContext = useLayout();
  const themeContext = useTheme();
  const backgroundContext = useBackground();
  const emojiContext = useEmoji();
  const profileContext = useProfile();

  return {
    // Layout settings
    layoutMode: layoutContext.layoutMode,
    setLayoutMode: layoutContext.setLayoutMode,
    // Theme settings
    theme: themeContext.theme,
    setTheme: themeContext.setTheme,
    isDark: themeContext.isDark,
    // Background settings
    backgroundPacks: backgroundContext.backgroundPacks,
    backgroundSetting: backgroundContext.backgroundSetting,
    setBackground: backgroundContext.setBackground,
    // Emoji settings
    emojiMode: emojiContext.emojiMode,
    setEmojiMode: emojiContext.setEmojiMode,
    // Profile settings
    profile: profileContext.settings,
    updateProfile: profileContext.updateSettings,
    generateInstructions: profileContext.generateInstructions,
  };
};
