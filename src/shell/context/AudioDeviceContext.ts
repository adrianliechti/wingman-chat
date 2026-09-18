import { createContext } from "react";

export interface AudioDeviceSettings {
  inputDeviceId?: string;
  outputDeviceId?: string;
}

export type MicPermissionState = "unknown" | "prompt" | "granted" | "denied";

export interface AudioDeviceContextType {
  inputDeviceId: string | undefined;
  outputDeviceId: string | undefined;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  micPermission: MicPermissionState;
  setInputDevice: (id: string | undefined) => void;
  setOutputDevice: (id: string | undefined) => void;
  requestPermission: () => Promise<void>;
}

export const AudioDeviceContext = createContext<AudioDeviceContextType | undefined>(undefined);
