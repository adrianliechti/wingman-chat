# Defines the `llm` helper exposed to user code. The actual model call is
# bridged to the main thread via `_wingman_llm` (set as a Pyodide global by
# interpreter.worker.ts); kwargs travel as a JSON string because Pyodide does
# not forward Python keyword arguments to JS functions.
import json as _json


async def llm(prompt, *, model=None, system=None, effort=None):
    """Call a language model with fresh context and return its text response.

    Chat history and previous llm/vision calls are not included. Supply all
    necessary context in prompt and system.

    Args:
        prompt: The user prompt to send.
        model: Optional model id; defaults to the model of the current chat.
        system: Optional system instructions.
        effort: Optional reasoning effort: "none", "minimal", "low", "medium", "high" or "xhigh".
    """
    options = {k: v for k, v in {"model": model, "system": system, "effort": effort}.items() if v is not None}
    return await _wingman_llm(str(prompt), _json.dumps(options) if options else None)
