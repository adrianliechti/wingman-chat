import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import type { AudioDeviceSettings } from "./AudioDeviceContext";
import { AudioDeviceContext } from "./AudioDeviceContext";

function loadSettings(): AudioDeviceSettings {
  return {
    inputDeviceId: localStorage.getItem("app_audio_input") ?? undefined,
    outputDeviceId: localStorage.getItem("app_audio_output") ?? undefined,
  };
}

function saveSettings(settings: AudioDeviceSettings) {
  if (settings.inputDeviceId) {
    localStorage.setItem("app_audio_input", settings.inputDeviceId);
  } else {
    localStorage.removeItem("app_audio_input");
  }
  if (settings.outputDeviceId) {
    localStorage.setItem("app_audio_output", settings.outputDeviceId);
  } else {
    localStorage.removeItem("app_audio_output");
  }
}

interface AudioDeviceProviderProps {
  children: ReactNode;
}

export function AudioDeviceProvider({ children }: AudioDeviceProviderProps) {
  const [settings, setSettings] = useState<AudioDeviceSettings>(loadSettings);

  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
      const outputs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId);

      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Clear stored device if it no longer exists, falling back to system default
      setSettings((prev) => {
        const inputValid = !prev.inputDeviceId || inputs.some((d) => d.deviceId === prev.inputDeviceId);
        const outputValid = !prev.outputDeviceId || outputs.some((d) => d.deviceId === prev.outputDeviceId);

        if (inputValid && outputValid) return prev;

        return {
          inputDeviceId: inputValid ? prev.inputDeviceId : undefined,
          outputDeviceId: outputValid ? prev.outputDeviceId : undefined,
        };
      });
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
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    void enumerateDevices();

    navigator.mediaDevices.addEventListener("devicechange", enumerateDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", enumerateDevices);
    };
  }, [enumerateDevices]);

  const setInputDevice = useCallback((id: string | undefined) => {
    setSettings((prev) => ({ ...prev, inputDeviceId: id }));
  }, []);

  const setOutputDevice = useCallback((id: string | undefined) => {
    setSettings((prev) => ({ ...prev, outputDeviceId: id }));
  }, []);

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
