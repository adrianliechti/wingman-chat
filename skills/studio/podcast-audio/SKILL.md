---
name: podcast-audio
description: "Create a spoken WAV narration or podcast from supplied material, with one voice or distinct configured voices. Use when the user requests an audio deliverable."
---

# Podcast audio

Read the material and match the requested format, length and tone. If unspecified, use a concise single-narrator overview. Write spoken prose with natural transitions; avoid reading Markdown markup or inventing speakers' claims. Preserve qualifications and attribution that matter to the content.

The interpreter helper `await synthesize(text, output, voice=None)` writes WAV and returns its path. It requires a configured speech service. If unavailable, explain the limit and provide the script when useful; do not report completed audio.

Use only supplied/configured voice IDs, or omit voice for the default. Distinct speakers require distinct supported voices; do not invent IDs like "host" or "guest". Split long scripts into coherent passages/turns and synthesize each.

For concatenation with Python's `wave`, verify matching channel count, sample width, sample rate and compression type across segments before writing frames. Do not assume all returned audio has the same format. Use an available conversion method if needed, or report the mismatch. Preserve turn order and natural pauses. Remove only temporary files created by this task after the final WAV is saved and verified.

Reopen the final WAV, verify nonzero frames and calculate duration from frames/sample rate. Listen to representative segments if playback is available; structural validation alone does not establish pronunciation quality. Hand off the audio with its duration and any material generation limit.
