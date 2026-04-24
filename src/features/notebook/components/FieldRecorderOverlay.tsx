import { Loader2, Mic, Square, X } from "lucide-react";
import { useState } from "react";
import { useFieldRecorder } from "../hooks/useFieldRecorder";

interface FieldRecorderOverlayProps {
  onSave: (transcript: string, audioUrl: string) => Promise<void>;
  onClose: () => void;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function FieldRecorderOverlay({ onSave, onClose }: FieldRecorderOverlayProps) {
  const { isRecording, elapsedSec, error, start, stop } = useFieldRecorder({ chunkDurationSec: 120 });
  const [isStopping, setIsStopping] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const handleStart = async () => {
    setStartError(null);
    try {
      await start();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to start recording");
    }
  };

  const handleStop = async () => {
    setIsStopping(true);
    try {
      const { transcript, audioUrl } = await stop();
      await onSave(transcript, audioUrl);
      onClose();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : "Failed to save recording");
      setIsStopping(false);
    }
  };

  const handleCancel = async () => {
    if (isRecording) {
      try {
        await stop();
      } catch {
        // discard
      }
    }
    onClose();
  };

  const displayError = startError || error;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close field recorder"
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleCancel}
      />

      <div className="relative z-10 w-full max-w-sm bg-white dark:bg-neutral-900 rounded-xl shadow-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">Field Recorder</h3>
          <button
            type="button"
            onClick={handleCancel}
            className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
          >
            <X size={16} className="text-neutral-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-8 flex flex-col items-center gap-4">
          {/* Recording indicator + timer */}
          {isRecording || isStopping ? (
            <>
              <div className="flex items-center gap-3">
                {isStopping ? (
                  <Loader2 size={16} className="text-neutral-400 animate-spin" />
                ) : (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                )}
                <span className="text-3xl font-mono font-medium text-neutral-800 dark:text-neutral-100 tabular-nums">
                  {formatElapsed(elapsedSec)}
                </span>
              </div>

              {isStopping && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Finishing transcription...</p>
              )}
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center">
                <Mic size={24} className="text-neutral-500" />
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">Record a conversation</p>
            </>
          )}

          {displayError && (
            <div className="w-full px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 rounded-lg">
              {displayError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-200 dark:border-neutral-800 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isStopping}
            className="px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded-lg transition-colors disabled:opacity-40"
          >
            Cancel
          </button>

          {isRecording ? (
            <button
              type="button"
              onClick={handleStop}
              disabled={isStopping}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-40"
            >
              {isStopping ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Finishing...
                </>
              ) : (
                <>
                  <Square size={12} fill="currentColor" />
                  Stop Recording
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-neutral-800 dark:bg-neutral-200 text-white dark:text-neutral-900 rounded-lg hover:opacity-90 transition-opacity"
            >
              <Mic size={14} />
              Start Recording
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
