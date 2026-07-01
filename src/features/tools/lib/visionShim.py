# Defines the `vision` helper exposed to user code. The worker reads the image
# bytes from the Pyodide FS and bridges the model call to the main thread via
# `_wingman_vision` (set as a Pyodide global by interpreter.worker.ts).
import os as _os


async def vision(path, prompt=None):
    """Analyze an image with a vision language model and return its text response.

    Use it to describe photos, read charts and diagrams, or answer questions
    about UI screenshots. Without a prompt it transcribes any text in the image,
    or describes the image if there is none. For scanned documents prefer
    `ocr`, which is specialized for text extraction. This is a network round
    trip to a remote model.

    Args:
        path: Path to the image file in the sandbox filesystem.
        prompt: Optional instruction for the model (e.g. "List the chart's
            data points as CSV").

    Returns:
        The model's text response as a string.
    """
    return await _wingman_vision(_os.path.abspath(str(path)), None if prompt is None else str(prompt))
