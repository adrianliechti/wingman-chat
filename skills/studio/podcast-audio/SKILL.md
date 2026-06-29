---
name: podcast-audio
description: Turn the conversation and workspace material into a spoken podcast-style audio file (.wav), single- or multi-voice. Trigger with "make a podcast", "create an audio overview", "turn this into a podcast", "narrate this", or whenever the user wants an audio version of the material.
---

# Podcast Audio

Produce a listenable audio episode as a real `.wav` file in the workspace. You write the script,
synthesize it with the interpreter's `synthesize()` helper, and merge the segments — the file
shows up in the artifacts panel with an inline player.

> Requires a configured speech service. If `synthesize()` reports none is configured, tell the
> user audio generation isn't available and offer the written script instead.

## 1. Gather the material and pick a format

If the user named a format ("overview", "deep-dive", "briefing", "debate", "story"), match its voice
count and tone. Default: a single warm narrator giving a clear overview, ~3–5 minutes (roughly
500–800 words).

## 2. Write the script

- Natural, conversational, spoken prose — no markdown, no bullet points, no headers (it is read
  aloud verbatim).
- Don't open with "Welcome to…" or close with a recap; start in the content and end when it's
  done.
- Weave the key findings into a narrative with real transitions.
- For a **multi-voice** format, split the script into a list of `(speaker, text)` turns and assign
  each speaker a distinct voice.

## 3. Synthesize and merge

`synthesize(text, output, voice=None)` writes one WAV per call. Generate per segment, then
concatenate with Python's stdlib `wave` (all segments share the speech service's format):

```python
import wave

# Single or multi-voice: list of (voice, text) turns.
turns = [
    ("host",  "Here's the thing everyone misses about the Q3 numbers."),
    ("guest", "Right — and it's not the headline growth rate at all."),
]

paths = []
for i, (voice, text) in enumerate(turns):
    p = f"seg_{i:03d}.wav"
    await synthesize(text, p, voice=voice)   # voice may be a configured name or None
    paths.append(p)

with wave.open(paths[0], "rb") as w0:
    params = w0.getparams()
with wave.open("podcast.wav", "wb") as out:
    out.setparams(params)
    for p in paths:
        with wave.open(p, "rb") as w:
            out.writeframes(w.readframes(w.getnframes()))

print("wrote podcast.wav")
```

Notes:
- Keep each `synthesize` call to a reasonable chunk (a paragraph or a turn) rather than one giant
  call or hundreds of tiny ones.
- Voice ids/names come from the selected style skill or the user's request; pass `None` for the
  default voice. Use **distinct** voices for distinct speakers.

## 4. Deliver

Save `podcast.wav` to the workspace root and tell the user it's ready with a one-line description
and the approximate length. To revise, adjust the script and re-run.
