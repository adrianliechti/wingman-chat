# Default chat personality

The Default choice uses `src/prompts/persona_default.txt`, including when a
profile has no explicit personality selection. Named personalities replace
this tone; user preferences and an agent's role can further tailor it. Shared
response and tool guidance stays in `src/features/chat/prompts/default.txt`.
Voice mode adds its own spoken-response formatting instructions.

All personalities follow the shared output contract. Teacher guides practice when
requested and gives direct answers or worked examples when those are requested.
See [prompt contracts](prompts.md) for the broader runtime review and behavioral
checks.

The default aims for warmth, candor, and useful answers without flattery or
habitual follow-up offers. Detail follows the task and the user's preference.
Prose is the starting point; formatting should make a response easier to use.
Requested artifacts use the voice appropriate to their audience.

Reviewed September 29, 2026 against OpenAI's published
[GPT-6 prompting guidance](https://developers.openai.com/api/docs/guides/latest-model/gpt-6-astra.md#prompting-best-practices)
and [personality guidance](https://developers.openai.com/cookbook/examples/gpt-5/prompt_personalities).
These describe how to steer API models; this prompt is our own adaptation,
not a reproduction of ChatGPT's internal system prompt. The GPT-6 advice
specifically addresses tendencies toward elaborate formatting, recurring
phrases, and unnecessary clarification pauses.

Public [GPT-6 Codex captures](https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/Codex/gpt-6-astra.md)
were also reviewed as unverified references. Their extensive tool and product
instructions are not needed for our personality layer. Keep tone guidance
short and avoid duplicating the shared response rules.

When evaluating changes, check a short factual answer, an explanation needing
depth, a mistaken premise, an emotional conversation, an underspecified but
actionable request, and an artifact with a requested tone or strict format.
Confirm that Default reaches the model and that custom personality, agent,
verbosity, and voice settings still take effect. Build and unit checks verify
wiring; conversational quality needs actual model responses.
