import { RouterProvider } from "@tanstack/react-router";
import { AgentProvider } from "./features/agent/context/AgentProvider";
import { ArtifactsProvider } from "./features/artifacts/context/ArtifactsProvider";
import { ChatProvider } from "./features/chat/context/ChatProvider";
import { ScreenCaptureProvider } from "./features/chat/context/ScreenCaptureProvider";
import { ProfileProvider } from "./features/settings/context/ProfileProvider";
import { SkillsProvider } from "./features/skills/context/SkillsProvider";
import { ToolsProvider } from "./features/tools/context/ToolsProvider";
import { TranslateProvider } from "./features/translate/context/TranslateProvider";
import { VoiceProvider } from "./features/voice/context/VoiceProvider";
import { router } from "./router";
import { AppProvider } from "./shell/context/AppProvider";
import { AudioDeviceProvider } from "./shell/context/AudioDeviceProvider";
import { BackgroundProvider } from "./shell/context/BackgroundProvider";
import { EmojiProvider } from "./shell/context/EmojiProvider";
import { LayoutProvider } from "./shell/context/LayoutProvider";
import { NavigationProvider } from "./shell/context/NavigationProvider";
import { SidebarProvider } from "./shell/context/SidebarProvider";
import { ThemeProvider } from "./shell/context/ThemeProvider";

// Compose providers to avoid deep nesting
const providers = [
  { key: "ThemeProvider", Provider: ThemeProvider },
  { key: "LayoutProvider", Provider: LayoutProvider },
  { key: "EmojiProvider", Provider: EmojiProvider },
  { key: "AudioDeviceProvider", Provider: AudioDeviceProvider },
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
