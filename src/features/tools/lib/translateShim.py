# Defines the `translate` / `translate_file` helpers exposed to user code. Text
# translation bridges to the main thread via `_wingman_translate_text`; file
# translation reads the input bytes from the Pyodide FS via
# `_wingman_translate_file`, which writes the translated file back. Both globals
# are set by interpreter.worker.ts and need the chat client/config.
import os as _os


async def translate(text, lang):
    """Translate text into another language via the configured translation service.

    This is a network round trip to a remote service — pass the whole text in
    one call. For tone or style rewrites (rather than translation) use the
    `llm` helper instead.

    Args:
        text: The text to translate.
        lang: Target language code (e.g. "de", "fr", "es").

    Returns:
        The translated text as a string.
    """
    return await _wingman_translate_text(str(lang), str(text))


async def translate_file(input, lang, output):
    """Translate a whole file into another language, preserving its format.

    Handles document formats like PDF, DOCX, and plain text. This is a network
    round trip — pass the whole file in one call.

    Args:
        input: Path to the file to translate in the sandbox filesystem.
        lang: Target language code (e.g. "de", "fr", "es").
        output: Path where the translated file is written.

    Returns:
        The path of the written file.
    """
    return await _wingman_translate_file(
        str(lang), _os.path.abspath(str(output)), _os.path.abspath(str(input))
    )
