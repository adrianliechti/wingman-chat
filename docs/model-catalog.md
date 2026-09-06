# Model catalogue and detection

`/api/v1/models` is the inventory of models this backend exposes to the current
client. It is not a worldwide list of vendor releases. `created` and `owned_by`
are not used to infer capabilities or freshness.

The catalogue resolves each available ID once, in this order:

1. Deployment entries in `config.models`, including an explicit `type`.
2. Optional backend `type`, `name`, and `description` fields.
3. ID cues for endpoint type and known profiles for missing capabilities.

Types are `completer`, `embedder`, `renderer`, `reranker`, `realtime`,
`synthesizer`, and `transcriber`. Realtime transcription is separate from file
transcription. Generic audio chat models remain completers. Unknown IDs remain
usable as chat models; unknown effort capabilities use the backend default.

For example, an opaque image deployment can be configured without adding a
name-matching rule:

```json
{
  "models": [
    {
      "id": "studio",
      "name": "Studio",
      "type": "renderer",
      "supportedQualities": []
    },
    {
      "id": "team-chat",
      "name": "Team chat",
      "type": "completer",
      "supportedEfforts": ["low", "medium", "xhigh"],
      "effort": "medium",
      "compactThreshold": 100000
    }
  ]
}
```

Configuration does not add unavailable IDs to the inventory. Empty capability
arrays hide their picker; an explicit zero compaction threshold disables
compaction. Configured chat models determine ordering and visibility in the chat
picker. Configuring only images does not hide chat models.

Chat, Canvas, and image helper selection share a catalogue keyed by client and
configuration. Concurrent reads share one request. Successful results, including
an empty inventory, are cached for one minute. Mounted consumers refresh while
visible and on focus, visibility, or reconnection when stale. Unmount removes
their timers/listeners. Requests time out after 15 seconds without SDK retries;
failed refreshes keep the last successful snapshot and can be retried.

Refreshing the inventory preserves an active selection and its effort, even if
that ID disappears. It does not silently switch the model used by an active
conversation. Initial restoration checks a saved effort against the resolved
supported levels. Choosing realtime or clearing the selection during initial
loading also wins over the late response.

Speech calls use their configured model or backend default. They do not choose
the first model in the catalogue. See [voice lifecycle](voice-lifecycle.md).

## Capability sources and limits

Reviewed September 6, 2026. Profiles are fallbacks, not an API guarantee, and do
not extrapolate new major versions. Custom or hosted models can specify their
own supported efforts instead of inheriting a vendor profile.

- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra): low,
  medium, high, xhigh, max; no none/minimal.
- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
  [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
  [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna): none through
  max, excluding minimal; medium default. The unsuffixed ID aliases Sol.
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort):
  Fable/Mythos 5.1 include xhigh and max. Mythos Preview and Opus/Sonnet 4.6 have
  max but no xhigh. Haiku and older Sonnet models do not inherit Opus's efforts.
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking): Gemini
  3.7/3.8 Flash have low/medium/high, while 3.6 also has minimal. Gemini 3 Pro has
  low/high; 3.1 Pro also has medium. Image and live models are not chat profiles.
- [Qwen Responses API](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses):
  Qwen 3.8 has none/low/medium/xhigh; high and max alias xhigh. Other Qwen versions
  do not inherit these choices.
- [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/): V4's
  distinct levels are low/high/max, plus none to disable thinking in Responses.
  Hosted providers can differ; use config overrides for their supported levels.

Image profiles reflect the gateway's `/render` implementation as well as vendor
capabilities. GPT Image 2 supports 16:9 and 9:16 through this gateway. Upstream
[transparent output is now in preview](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output),
but the current gateway does not forward it for Image 2, so it is not advertised
by default. A deployment that adds support can override `supportedBackgrounds`.
[Gemini image settings](https://ai.google.dev/gemini-api/docs/image-generation)
distinguish 2.5/Flash Lite's 1K output from 3 Pro's 1K–4K and 3.1 Flash's
additional 512px output.

Compaction thresholds are operational budgets that leave room for output and
recovery. They are not advertised context-window sizes. Small/local deployments
should configure their budget explicitly.

## Regression coverage

- `models.test.ts`: endpoint collisions, known effort profiles, configuration
  precedence, disabled controls, and image settings.
- `client.models.test.ts`: real SDK parsing/filtering of HTTP model records and
  malformed optional metadata.
- `modelCatalog.test.ts` and `commandUtils.test.ts`: shared requests, expiry,
  empty results, retry, client/config isolation, and helper consistency.
- `useImageTool.test.tsx`: configured controls and supported default quality.
- `tests/browser/models.spec.ts`: actual React hooks and HTTP client in StrictMode,
  delayed selection, refresh failure/recovery, saved effort validation, and cleanup.
