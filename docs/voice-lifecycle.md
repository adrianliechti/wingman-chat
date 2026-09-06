# Voice, dictation and read-aloud

Each audio operation owns its resources from the moment startup is requested.
`AudioResources` handles cancellation, late acquisition, event listeners and
independent cleanup. Ending an operation detaches its owner synchronously;
slow browser cleanup cannot close a replacement operation. Browser microphone
permission prompts cannot be dismissed programmatically. Cancellation stops
waiting, and any stream granted later is immediately stopped.

## Realtime voice

- The recorder and player coalesce duplicate initialization. Every failure
  releases acquired streams, nodes, ports, contexts and worklet blob URLs.
- A session includes pending startup, not just an open socket. Stopping,
  navigation, unmount and switching either device invalidate that session.
  Device changes restart with the newest selection.
- Recording starts after `session.updated`. Connection and configuration each
  have a 15-second deadline. A rejected/missing configuration releases the
  microphone instead of recording with unknown server settings.
- Track termination and worklet/output errors stop the session and notify its
  owner. A selected output that cannot be opened raises an error. Browsers
  without output-device selection continue using their system output.
- Elicitation pauses nest. Each resume belongs to its originating session, so
  an old tool cannot open an elicitation or resume a replacement microphone.
- Recorder chunks carry a recording generation, excluding queued chunks from
  before a pause. Spoken and typed interruptions correlate replies with requests,
  discard every queued interrupted track, and report samples actually played,
  including zero. Typed follow-ups wait for history truncation before requesting
  another response; concurrent submissions share that wait. An
  unanswered interrupt stops playback after two seconds.

## Dictation and speech helpers

Dictation belongs to a composer/chat and its selected microphone. Its recording
state includes pending permission so the button can cancel startup. Duplicate
stops share one upload. Capture closes before submitting mono PCM16 WAV to STT.
Navigation, device changes, switching to realtime and unmount cancel pending
capture/upload and suppress late transcripts. Permission and API failures reach
the composer; device/processor failures stop capture and show a notification.

File transcription passes cancellation through audio extraction and the HTTP
request. Extraction releases its decoder, conversion and output on success,
failure and cancellation. Video audio is resampled to mono 16 kHz; unavailable
compressed encoders fall back to WAV.

`stt.model` selects file/dictation STT; `tts.model` selects synthesis. The UI and
interpreter helpers both use these settings, or the backend default when absent.
They no longer guess a default from the order of `/models`. The speech client
validates empty audio and malformed STT responses and preserves cancellation.

Realtime uses **only** `voice.transcriber`, with the hook's realtime-compatible
default when absent. File STT and realtime transcribers are different API
contracts. For example, the local backend smoke test accepted
`gpt-live-transcribe` in realtime configuration but rejected it at
`/v1/audio/transcriptions`; `gpt-transcribe` successfully transcribed the
synthetic WAV there. File STT needs a backend default that supports that upload endpoint, or an
explicit `stt.model` override. Portable client defaults do not infer or substitute a different model.

## Read-aloud

The message button cancels pending generation and stops active playback. The
element, blob URL and listeners are released after completion, playback/sink
failure, cancellation, content/device change or unmount. Loading changes to
playing only after `play()` succeeds. Configured voice aliases also work in the
message UI.

## Verification

Unit tests use the real recorder/player with controlled browser primitives,
execute the actual worklet source, and cover HTTP payloads and cancellation.
`tests/browser/voice.spec.ts` mounts the real provider/hooks/button in StrictMode
and runs real AudioContexts, AudioWorklets, WAV playback and WebM conversion.
Chromium uses synthetic media devices and muted output. Native OS permission
dialogs, physical unplugging and Safari/Firefox audio behavior still need manual
device testing; injected delays/errors prove ownership and cleanup independently
of those hardware behaviors.
