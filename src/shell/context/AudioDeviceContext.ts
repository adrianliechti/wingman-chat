import { createContext } from "react";

export interface AudioDeviceSettings {
  inputDeviceId?: string;
  outputDeviceId?: string;
}

export interface AudioDeviceContextType {
  inputDeviceId: string | undefined;
  outputDeviceId: string | undefined;
  inputDevices: MediaDeviceInfo[];
  outputDevices: MediaDeviceInfo[];
  setInputDevice: (id: string | undefined) => void;
  setOutputDevice: (id: string | undefined) => void;
  requestPermission: () => Promise<void>;
}

export const AudioDeviceContext = createContext<AudioDeviceContextType | undefined>(undefined);
