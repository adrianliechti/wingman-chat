import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { usePersistedState } from "@/shared/hooks/usePersistedState";
import type { AudioDeviceSettings } from "./AudioDeviceContext";
import { AudioDeviceContext } from "./AudioDeviceContext";

interface AudioDeviceProviderProps {
  children: ReactNode;
}

export function AudioDeviceProvider({ children }: AudioDeviceProviderProps) {
  const { value: settings, setValue: setSettings } = usePersistedState<AudioDeviceSettings>({
    key: "audioDevices.json",
    defaultValue: {},
    debounceMs: 300,
  });

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(devices.filter((d) => d.kind === "audioinput" && d.deviceId));
      setOutputDevices(devices.filter((d) => d.kind === "audiooutput" && d.deviceId));
    } catch (error) {
      console.warn("Failed to enumerate audio devices:", error);
    }
  }, []);

  // Request microphone permission to unlock full device labels/IDs,
  // then re-enumerate. Call this from UI when the user wants device selection.
  const requestPermission = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => {
        t.stop();
      });
      await enumerateDevices();
    } catch {
      // Permission denied
    }
  }, [enumerateDevices]);

  useEffect(() => {
    void enumerateDevices();

    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
    };
  }, [enumerateDevices]);

  const setInputDevice = useCallback(
    (id: string | undefined) => {
      setSettings((prev) => ({ ...prev, inputDeviceId: id }));
    },
    [setSettings],
  );

  const setOutputDevice = useCallback(
    (id: string | undefined) => {
      setSettings((prev) => ({ ...prev, outputDeviceId: id }));
    },
    [setSettings],
  );

  return (
    <AudioDeviceContext.Provider
      value={{
        inputDeviceId: settings.inputDeviceId,
        outputDeviceId: settings.outputDeviceId,
        inputDevices,
        outputDevices,
        setInputDevice,
        setOutputDevice,
        requestPermission,
      }}
    >
      {children}
    </AudioDeviceContext.Provider>
  );
}
