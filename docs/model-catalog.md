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
      "maxOutputTokens": 128000,
      "outputTokenBudget": 96000,
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

Reviewed September 23, 2026. Profiles are fallbacks, not an API guarantee, and do
not extrapolate new major versions. Custom or hosted models can specify their
own supported efforts instead of inheriting a vendor profile.

- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra): low,
  medium, high, xhigh, max; no none/minimal.
- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol) and
  [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): none, low,
  medium, high, xhigh, max; medium default. Both use the Responses API for tool
  calling and structured outputs in Wingman.
- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
  [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
  [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna): none through
  max, excluding minimal; medium default. The unsuffixed ID aliases Sol.
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort):
  Fable/Mythos 5.1 include xhigh and max. [Opus 5.5](https://www.anthropic.com/claude-opus-5-5)
  has low through max with a medium default (Opus 5 defaults to high); its
  thinking cannot be disabled, so low is its minimal effort. Mythos Preview and Opus/Sonnet 4.6 have
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
capabilities. [GPT Image 2.5 Sunburst and Flare](https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options)
support low, medium, high, xhigh, and max image quality (reviewed September 8,
2026). These are `quality` values, separate from chat reasoning effort. Their
gateway profile also exposes common aspect ratios, 1K/2K/4K resolution controls,
and opaque/transparent backgrounds. The gateway must include Image 2.5 support
and expose the model IDs in its inventory; the frontend does not add models.

GPT Image 2 supports 16:9 and 9:16 through this gateway. Upstream
[transparent output is now in preview](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output),
but the current gateway does not forward it for Image 2, so it is not advertised
by default. A deployment that adds support can override `supportedBackgrounds`.
[Gemini image settings](https://ai.google.dev/gemini-api/docs/image-generation)
distinguish 2.5/Flash Lite's 1K output from 3 Pro's 1K–4K and 3.1 Flash's
additional 512px output.

Compaction thresholds are operational budgets that leave room for output and
recovery. They are not advertised context-window sizes. Small/local deployments
should configure their budget explicitly.

## Chat output allowance

The existing `MODEL_PROFILES` in `models.ts` hold both reasoning capabilities and
numeric `maxOutputTokens` capacity. Deployment configuration takes precedence
over optional `/models` `max_output_tokens` metadata, then the internal profile.
The current Wingman backend returns only model IDs and inventory metadata, so
the internal profiles supply known capacities without another model mapping.

`Client.complete` defaults to `min(64,000, maxOutputTokens)`. This budget includes
reasoning, text, and generated tool arguments, and applies to chat, subagents,
and interpreter `llm` calls through the shared client. Explicit request budgets
are also capped by the known capacity. Unknown capacities keep the provider
default unless an explicit budget is configured; such an override cannot be
clamped until the deployment supplies a capacity.

Examples of documented capacities (reviewed September 23, 2026):

| Model                                                                                                                            | Capacity | Default chat budget |
| -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------- |
| [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)                                                         | 128,000  | 64,000              |
| [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)                                                             | 128,000  | 64,000              |
| [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)                                                           | 128,000  | 64,000              |
| [Claude Opus 5.5](https://www.anthropic.com/claude-opus-5-5)                                                                     | 128,000  | 64,000              |
| [Claude Sonnet 4.6 on Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html) | 64,000   | 64,000              |
| [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)                                                | 65,536   | 64,000              |
| [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)                                                                 | 32,768   | 32,768              |
| [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o)                                                                   | 16,384   | 16,384              |
| [Gemini 2.0 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-2.0-flash)                                                | 8,192    | 8,192               |

Set `config.models[].maxOutputTokens` (or the same field in `models.yaml`) to
describe an alias's capacity or a hosted-model difference. Set
`outputTokenBudget` to override the chat default, for example 96,000 on a model
with 128,000 capacity. Per-call `maxOutputTokens` options take precedence over
that preferred budget; both are capped by the capacity. A zero budget omits the
request field and lets the provider decide. A zero configured capacity disables
the internal capacity fallback.

Classification defaults to 8,000 tokens. Other structured helpers, including
summarization, rewriting, and conversion, default to 16,000. They are capped by
the model maximum and do not inherit the larger chat budget; `ParseOptions`
supports an explicit override. Models with unknown capacity still use provider
defaults. A budget cannot prevent exhaustion of the remaining context window.

When telemetry is enabled, spans record `gen_ai.request.max_tokens` and
`gen_ai.response.finish_reasons` alongside existing output/reasoning usage.
`wingman.gen_ai.responses` counts responses by model, operation, and
`wingman.response.finish_reason`, including `max_output_tokens` cutoffs. Usage
is recorded before response validation so truncated text and JSON contribute.
Compare output-usage percentiles and cutoff frequency per operation/model when
tuning these starting defaults; no automatic budget increases are applied.

## Regression coverage

- `models.test.ts`: endpoint collisions, output capacities and budgets, known effort profiles, configuration
  precedence, disabled controls, and image settings.
- `client.test.ts`: output allowances in real SDK requests, deployment and
  per-call overrides, provider defaults, invalid configuration, and retries.
- `responses.test.ts` and `otel.test.ts`: utility budgets and usage/cutoff
  telemetry for successful and truncated responses.
- `client.models.test.ts`: real SDK parsing/filtering of HTTP model records and
  malformed optional metadata.
- `modelCatalog.test.ts` and `commandUtils.test.ts`: shared requests, expiry,
  empty results, retry, client/config isolation, and helper consistency.
- `useImageTool.test.tsx`: configured controls and supported default quality.
- `tests/browser/models.spec.ts`: actual React hooks and HTTP client in StrictMode,
  delayed selection, refresh failure/recovery, saved effort validation, and cleanup.
