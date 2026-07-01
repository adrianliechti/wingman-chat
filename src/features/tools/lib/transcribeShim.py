# Defines the `transcribe` helper exposed to user code. The worker reads the
# audio bytes from the Pyodide FS and bridges the transcription call to the
# main thread via `_wingman_transcribe` (set as a Pyodide global by
# interpreter.worker.ts).
import os as _os


async def transcribe(path):
    """Transcribe an audio (or video) file to text via the configured speech-to-text service.

    Handles common formats like WAV, MP3, M4A, OGG, MP4 and WebM. This is a
    network round trip to a remote service — pass the whole file in one call.

    Args:
        path: Path to the audio file in the sandbox filesystem.

    Returns:
        The transcribed text as a string.
    """
    return await _wingman_transcribe(_os.path.abspath(str(path)))
