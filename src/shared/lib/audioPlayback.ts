import { AudioResources } from "./audioResources";

export interface AudioPlaybackOptions {
  sinkId?: string;
  signal?: AbortSignal;
  onPlaying?: () => void;
}

/** Own the element and blob URL until playback ends, fails, or its caller cancels. */
export async function playAudioBlob(
  blob: Blob,
  { sinkId, signal, onPlaying }: AudioPlaybackOptions = {},
): Promise<void> {
  signal?.throwIfAborted();
  const scope = new AudioResources();
  if (signal)
    scope.listen(signal, "abort", () => {
      void scope.close(signal.reason);
    });
  try {
    const url = scope.own(URL.createObjectURL(blob), (url) => URL.revokeObjectURL(url));
    const audio = new Audio(url);
    scope.own(audio, (audio) => {
      audio.removeAttribute("src");
      audio.load();
    });
    scope.own(audio, (audio) => audio.pause());
    const ended = new Promise<void>((resolve) => scope.listen(audio, "ended", resolve));
    scope.listen(audio, "error", () => {
      void scope.close(new Error("Audio playback failed"));
    });
    if (sinkId && "setSinkId" in audio) await scope.wait(audio.setSinkId(sinkId));
    scope.signal.throwIfAborted();
    await scope.wait(audio.play());
    scope.signal.throwIfAborted();
    onPlaying?.();
    await scope.wait(ended);
  } finally {
    await scope.close();
  }
}
