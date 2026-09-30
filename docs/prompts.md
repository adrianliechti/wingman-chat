# Prompt contracts

Prompts should describe the behavior the runtime can support: the task, available
context, applicable tools, output contract, and conditions for asking or stopping.
Optimize for reliable interpretation before reducing length. Keep exact paths,
API signatures, persistence rules, and recovery instructions when they prevent
concrete failures.

The shared chat prompt owns general response and completion behavior. Personas
set conversational defaults; requested roles, languages, artifact styles, and
output formats take precedence. Provider prompts own their tool-specific rules.
Standalone title, rewriting, optimization, and memory calls need their
own instructions because they do not inherit the shared chat prompt.

## September 2026 review

Reviewed all 40 text prompts and the inline memory prompts against their callers,
schemas, and tool implementations. Compared the local Codex checkout's
`codex-rs/ext/skills/src/catalog_prompt.rs` and
`codex-rs/prompts/templates/compact/prompt.md` for skill selection and operational
handoffs. Applied explicit scope and context rules while retaining Wingman's
runtime contracts. OpenAI's [voice prompting guidance](https://developers.openai.com/api/docs/guides/voice-prompting#what-changed-in-realtime-2)
also informed trigger conditions and separation of spoken replies from tool work.

The resulting changes address these failure modes:

- Personas imposed unrelated restrictions or claimed priority over later
  instructions. Teacher now distinguishes requested practice from direct answers.
- Skill optimization encouraged broad keyword triggers and removed useful
  resource references. It now preserves scope, paths, interfaces, and complete
  bodies. Drafts are sent as JSON user data, separate from system instructions.
- Custom rewrite instructions could be corrupted by JavaScript replacement
  tokens such as `$&`. Literal replacements now preserve them.
- Subagents denied having history even when it was supplied. Their brief now
  defines scope, and they use the context actually provided. Research retains its
  parent-reporting role and handles search-only or fetch-only configurations.
- Voice formatting rules could apply to generated files. They now govern spoken
  replies; files and tool arguments retain their required syntax.
- Interpreter guidance confused HTML interfaces with workers without a DOM.
  HTML library guidance now has one owner. PDF and SVG conversion explicitly
  require `await`; OCR selection considers coverage instead of a character count.
- Preview services and standalone exports had conflicting requirements. Prompts
  now distinguish preview, folder export, and self-contained HTML delivery.
- Memory composition and migration allowed declining in prose while their
  schemas required a note. Both now accept `{"notes": []}` as an explicit decline;
  the application preserves existing memory and reports or retries the failure.

The text-prompt inventory decreased from 9,156 to 6,568 whitespace-delimited
words, mostly by reducing personas and repetition. These prompts are loaded
selectively, so this is an inventory measurement, not a per-request token saving.
Memory provenance, repository extraction rules, and document-library constraints
remain explicit.

## Behavioral checks

Twelve paired samples used GPT-6 Astra at low effort through the application's
gateway client. Tool scenarios used deterministic fixtures to check calls and
arguments. Checks covered direct tutoring answers, requested practice, persona
format overrides, CSV escaping and missing values, full-context rewrites,
handoffs with failed work and pending approval, inherited subagent history,
search-only research, voice-created Markdown, awaited PDF rendering, skill
resource preservation, and embedded instructions in skill drafts.

All revised samples met their checks. Two baseline failures were observable:
Teacher asked for a grade level instead of the requested answer, and skill
optimization dropped the referenced script and format document. Other samples
met the checks both before and after. These are focused single-sample checks;
they do not establish a general quality improvement or verify real media services.

Unit tests separately cover literal prompt inputs, schema-compatible memory
declines, unchanged storage, and a successful migration retry. For future edits,
test the behavior at the caller boundary rather than asserting prompt wording.
