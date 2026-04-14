// Centralized settings types for better organization and maintainability

// Profile settings
export type { ProfileSettings } from "@/features/settings/context/ProfileContext";
// Background settings
export type {
  BackgroundItem,
  BackgroundPack,
  BackgroundSetting,
} from "@/shell/context/BackgroundContext";

// Emoji settings
export type { EmojiMode } from "@/shell/context/EmojiContext";
// Layout settings
export type { LayoutMode } from "@/shell/context/LayoutContext";
// Theme settings
export type { Theme } from "@/shell/context/ThemeContext";
