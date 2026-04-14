import { useContext } from "react";
import { AudioDeviceContext } from "@/shell/context/AudioDeviceContext";

export function useAudioDevices() {
  const context = useContext(AudioDeviceContext);
  if (context === undefined) {
    throw new Error("useAudioDevices must be used within an AudioDeviceProvider");
  }
  return context;
}
