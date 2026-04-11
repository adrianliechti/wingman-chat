import { RouterProvider } from "@tanstack/react-router";
import { ThemeProvider } from "./shell/context/ThemeProvider";
import { LayoutProvider } from "./shell/context/LayoutProvider";
import { EmojiProvider } from "./shell/context/EmojiProvider";
import { BackgroundProvider } from "./shell/context/BackgroundProvider";
import { ProfileProvider } from "./features/settings/context/ProfileProvider";
import { SkillsProvider } from "./features/skills/context/SkillsProvider";
import { SidebarProvider } from "./shell/context/SidebarProvider";
import { NavigationProvider } from "./shell/context/NavigationProvider";
import { ArtifactsProvider } from "./features/artifacts/context/ArtifactsProvider";
import { AppProvider } from "./shell/context/AppProvider";
import { AgentProvider } from "./features/agent/context/AgentProvider";
import { ScreenCaptureProvider } from "./features/chat/context/ScreenCaptureProvider";
import { ToolsProvider } from "./features/tools/context/ToolsProvider";
import { ChatProvider } from "./features/chat/context/ChatProvider";
import { VoiceProvider } from "./features/voice/context/VoiceProvider";
import { TranslateProvider } from "./features/translate/context/TranslateProvider";
import { router } from "./router";

// Compose providers to avoid deep nesting
const providers = [
  { key: "ThemeProvider", Provider: ThemeProvider },
  { key: "LayoutProvider", Provider: LayoutProvider },
  { key: "EmojiProvider", Provider: EmojiProvider },
  { key: "BackgroundProvider", Provider: BackgroundProvider },
  { key: "ProfileProvider", Provider: ProfileProvider },
  { key: "SkillsProvider", Provider: SkillsProvider },
  { key: "SidebarProvider", Provider: SidebarProvider },
  { key: "NavigationProvider", Provider: NavigationProvider },
  { key: "ArtifactsProvider", Provider: ArtifactsProvider },
  { key: "AppProvider", Provider: AppProvider },
  { key: "AgentProvider", Provider: AgentProvider },
  { key: "ScreenCaptureProvider", Provider: ScreenCaptureProvider },
  { key: "ToolsProvider", Provider: ToolsProvider },
  { key: "ChatProvider", Provider: ChatProvider },
  { key: "VoiceProvider", Provider: VoiceProvider },
  { key: "TranslateProvider", Provider: TranslateProvider },
];

function App() {
  return providers.reduceRight(
    (acc, { key, Provider }) => <Provider key={key}>{acc}</Provider>,
    <RouterProvider router={router} />,
  );
}

export default App;
