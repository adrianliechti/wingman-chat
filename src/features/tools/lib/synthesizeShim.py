# Defines the `synthesize` helper exposed to user code. The speech call is
# bridged to the main thread via `_wingman_synthesize` (set as a Pyodide global
# by interpreter.worker.ts), which writes the resulting audio back to the FS.
import os as _os


async def synthesize(text, output, voice=None):
    """Convert text to spoken audio via the configured speech synthesis service.

    The audio is always WAV-encoded, so use a ".wav" output path. This is a
    network round trip to a remote model; for long texts prefer one call over
    many small ones.

    Args:
        text: The text to speak.
        output: Path where the audio file is written (e.g. "speech.wav").
        voice: Optional voice id or configured voice name.

    Returns:
        The path of the written audio file.
    """
    return await _wingman_synthesize(
        str(text), _os.path.abspath(str(output)), None if voice is None else str(voice)
    )
