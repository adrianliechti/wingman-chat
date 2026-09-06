import { stopAudioTracks } from "@/shared/lib/audioResources";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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

  const mounted = useRef(false);
  const enumeration = useRef(0);
  const knownDevices = useRef(new Set<string>());
  const permissionRequest = useRef<Promise<void> | null>(null);
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);

  const enumerateDevices = useCallback(async () => {
    const request = ++enumeration.current;
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current || request !== enumeration.current) return;
      const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId);
      const outputs = devices.filter((d) => d.kind === "audiooutput" && d.deviceId);

      setInputDevices(inputs);
      setOutputDevices(outputs);

      // Permission can hide IDs, especially on initial load. Only forget a
      // device we've actually seen disappear from a labelled device list.
      const labelled = devices.some((device) => device.label);
      const previouslyKnown = new Set(knownDevices.current);
      if (labelled) knownDevices.current = new Set(devices.map((device) => device.deviceId));
      setSettings((prev) => {
        const inputValid =
          !labelled ||
          !prev.inputDeviceId ||
          !previouslyKnown.has(prev.inputDeviceId) ||
          inputs.some((d) => d.deviceId === prev.inputDeviceId);
        const outputValid =
          !labelled ||
          !prev.outputDeviceId ||
          !previouslyKnown.has(prev.outputDeviceId) ||
          outputs.some((d) => d.deviceId === prev.outputDeviceId);

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
  const requestPermission = useCallback(() => {
    if (permissionRequest.current) return permissionRequest.current;
    const pending = Promise.resolve()
      .then(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          // This permission probe never owns a live recording, even after unmount.
          stopAudioTracks(stream);
          if (mounted.current) await enumerateDevices();
        } catch {
          /* Permission denied or media devices unavailable. */
        }
      })
      .finally(() => {
        permissionRequest.current = null;
      });
    permissionRequest.current = pending;
    return pending;
  }, [enumerateDevices]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    mounted.current = true;
    void enumerateDevices();
    navigator.mediaDevices?.addEventListener("devicechange", enumerateDevices);
    return () => {
      mounted.current = false;
      enumeration.current++;
      navigator.mediaDevices?.removeEventListener("devicechange", enumerateDevices);
    };
  }, [enumerateDevices]);

  const setInputDevice = useCallback((id: string | undefined) => {
    enumeration.current++;
    setSettings((prev) => ({ ...prev, inputDeviceId: id }));
  }, []);

  const setOutputDevice = useCallback((id: string | undefined) => {
    enumeration.current++;
    setSettings((prev) => ({ ...prev, outputDeviceId: id }));
  }, []);

  return (
    <AudioDeviceContext
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
    </AudioDeviceContext>
  );
}
