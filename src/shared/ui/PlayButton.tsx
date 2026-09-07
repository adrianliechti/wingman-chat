import { Loader2, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { notify } from "@/shared/lib/notify";
import { getConfig } from "@/shared/config";
import { useAudioDevices } from "@/shell/hooks/useAudioDevices";

type PlayButtonProps = {
  text: string;
  voice?: string;
  className?: string;
};

export function PlayButton({ text, voice, className }: PlayButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing">("idle");
  const controllerRef = useRef<AbortController | null>(null);
  const isPlaying = status === "playing";
  const isLoading = status === "loading";
  const { outputDeviceId } = useAudioDevices();

  useEffect(() => {
    setStatus("idle");
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [text, voice, outputDeviceId]);

  const handlePlay = async () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("loading");
    try {
      const config = getConfig();
      const model = config.tts?.model ?? "";
      const resolvedVoice = voice ? (config.tts?.voices?.[voice] ?? voice) : undefined;
      await config.client.speakText(model, text, resolvedVoice, outputDeviceId, {
        signal: controller.signal,
        onPlaying: () => {
          if (controllerRef.current === controller) setStatus("playing");
        },
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Failed to play text:", error);
        notify.error("Couldn't play message", "Check your audio output and try again.");
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setStatus("idle");
      }
    }
  };

  const buttonClasses =
    "text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 disabled:opacity-30 p-2 -m-1";

  return (
    <button
      type="button"
      onClick={handlePlay}
      className={buttonClasses}
      title={isLoading ? "Cancel audio generation" : isPlaying ? "Stop playback" : "Play message"}
    >
      {isLoading ? (
        <Loader2 className={`${className || "h-3 w-3"} animate-spin`} />
      ) : isPlaying ? (
        <Square className={className || "h-3 w-3"} />
      ) : (
        <Play className={className || "h-3 w-3"} />
      )}
    </button>
  );
}
