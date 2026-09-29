# Browser AI integration

All AI execution stays in the browser. The Go server continues to host the SPA
and proxy `/api/v1`; no TypeScript service or provider secret is added to the
frontend.

## Framework ownership

- `@tanstack/ai` owns the model/tool loop, streamed messages, tool validation,
  structured output, embeddings, speech, transcription, and OpenTelemetry
  middleware. `@tanstack/ai-openai` supplies the gateway's Responses and media
  adapters, including provider serialization and SDK retries. Interrupted response
  streams fail the run; there is no custom replay of partially streamed requests.
- `@tanstack/ai-client` owns chat messages, streaming, batch queueing, interrupts,
  client persistence, realtime state, and dictation through `AudioRecorder`.
- `@tanstack/ai-compaction` owns provider-context trimming and summarization.
- `@tanstack/ai-mcp` owns MCP initialization, discovery, calls, resources, prompts,
  and connection cleanup. The SDK HTTP transport supplies browser OAuth.
- `@tanstack/ai-skills` owns skill catalogs, loading, resource tools, and per-run
  activation through its portable skills API.
- MCP apps use `AppFrame` and `AppBridge` from `@mcp-ui/client`, the renderer used
  by TanStack's `MCPAppResource`. It owns iframe initialization and delivery of
  initial tool input and results.

The integration follows [TanStack AI](https://tanstack.com/ai/latest),
[MCP](https://tanstack.com/ai/latest/docs/tools/mcp),
[realtime](https://tanstack.com/ai/latest/docs/media/realtime-chat), and
[MCP Apps](https://tanstack.com/ai/latest/docs/mcp/apps). Examples that put
orchestration in a server route are adapted to the application's browser-only
execution requirement. The installed package sources define the precise APIs.

## Shared execution and removed code

Chat connects `ChatClient` directly to browser-local `streamRun`, which calls
native `chat()`. The connection forwards TanStack's run, parent, thread, and
resume context. There is no application token buffer, tool-execution loop,
queue controller, or recursive queue drain.
Delegation uses `defineAgent` and native nested streams. One-shot interpreter
`llm`/`vision` calls use the same stream through a short `run` helper, with only
their own prompt and no tools. Noninteractive callers collect messages using
TanStack's `StreamProcessor`; they do not create an interactive `ChatClient`.

`AgentRunController` and its parallel lifecycle event protocol have been removed.
Chat progress follows native middleware callbacks and stream chunks. Tool-result
cleanup uses `onToolPhaseComplete.results` instead of scanning the transcript.
Run results contain only status, messages, and an optional error. Plain runtime
context carries cancellation and child workspace identity; it has no counters.

`Client.complete()` and `Client.summarizeHistory()` have been deleted. `Client`
retains provider configuration, structured-output tasks, media activities, and
gateway endpoint contracts. Unused per-turn/message callbacks were removed;
observers use native middleware hooks.

The application no longer creates `invoke_agent` or `execute_tool` spans around
TanStack's own spans. Native [OpenTelemetry middleware](https://tanstack.com/ai/latest/docs/advanced/otel)
owns the root, model, and tool lifecycles and their metrics. A small tracer bridge
passes the native tool context to delegated work and MCP annotations, including
when the browser has no asynchronous context manager. This removes duplicate
tool spans and duration reporting. Structured results also rely on TanStack's
schema validation instead of parsing the validated value a second time.

`aiMessages.ts` is a storage/UI projection, not another transcript owner.
`ChatClient` owns live messages; an adapter writes them to the existing chat
store and OPFS persistence queue. A small metadata cache attaches rich workspace
results, usage, and run identities. The boundary retains attachment names and
media types, reasoning model identity, artifact references, and widget results.

Dictation uses the native recorder's encoded blob directly, following the
[audio recording guide](https://tanstack.com/ai/latest/docs/media/audio-recording).
It prefers WebM/Opus and falls back to the browser's supported recording format.
Microphone selection, pending-permission cancellation, duplicate stops, and
navigation cancellation remain at the composer boundary. The unused PCM/WAV
encoding module and its exports have been deleted. Realtime voice keeps its
PCM worklet because that is the gateway's streaming protocol.

## Additional native features

Skills follow the [portable skills guide](https://tanstack.com/ai/latest/docs/skills/agent-skills)
and [custom source contract](https://tanstack.com/ai/latest/docs/skills/writing-adapters).
A bytes-only source connects the selected OPFS library, lazy Studio templates,
and installed plugins to `withSkills`. The middleware adds the catalog and
`load_skill`; `createResourceTool` supplies `read_skill_resource`. The handwritten
catalog XML, loading schemas, resource tool implementation, and skill-content
envelope have been removed. The default native catalog budget is 4,000 estimated
tokens; exceeding it fails explicitly rather than silently dropping skills.

Providers can supply native chat middleware through `ToolProvider.chat`. The
same filtered selection reaches main chat and delegated runs, including agents
invoked from voice. Realtime itself uses the native tool factories and catalog
renderer because it has no chat middleware. Activation belongs to one run or
voice tools instance, so duplicate loads return TanStack's short marker without
suppressing a different conversation. The skill editor reuses instructions and
edits already present in the current run.

Plugin skill names are qualified (`plugin:skill`, with URL-encoded plugin ids)
in both the catalog and interpreter mount paths. This fixes resource collisions
between same-named plugin and personal skills. Compaction retains the full
native skill result, including resources and compatibility, and ignores later
already-loaded markers. Saved `read_skill` results remain readable; their plugin
argument is used to distinguish legacy identities. New calls use `load_skill`
with `name`, and `read_skill_resource` with `skill` and `path`.

MCP tools use [lazy tool discovery](https://tanstack.com/ai/latest/docs/tools/lazy-tool-discovery).
Chat initially sends the native discovery tool with a short catalog (tool names
and their first description sentence). TanStack supplies schemas on demand,
executes discovered tools, and restores discoveries from saved history. Built-in
workspace tools remain eager. Discovery adds a model round trip the first time a
tool is needed, counted as one native model iteration. Realtime voice continues
to receive full tool definitions; isolated interpreter calls receive no tools.

Text-only results retain TanStack's JSON string representation across storage
round trips, so discovery does not require an application cache. Media results
remain native content parts. Removed or disabled tools cannot be re-enabled by
an old discovery result. The chat displays discovery as **Find tools**.

Streaming uses the native client's immediate strategy so Stop retains every
received token. Markdown reveals large incoming chunks across animation frames,
catching up within 100 ms of the latest update. This affects presentation only:
the native transcript and persistence receive complete chunks immediately.
Finishing or stopping shows the full received text, and reduced-motion settings
disable the reveal. MCP `isError` results reach TanStack's failure lifecycle while
preserving widget and display data.

Enable [native debug logging](https://tanstack.com/ai/latest/docs/advanced/debug-logging)
with `VITE_AI_DEBUG=true npm run dev`. It covers chat, structured output, speech,
and transcription, including provider frames and tool arguments/results in the
browser console. The switch is disabled in production builds. Chat runs now
also pass the stable workspace chat id as TanStack's `threadId`.

## Queueing, interrupts, and persistence

[Message queueing](https://tanstack.com/ai/latest/docs/chat/queueing) uses
`whenBusy: "queue"` and `drain: "batch"`. Pending sends are displayed and can be
removed using native queue IDs. Stop, failure, and switching conversations discard
queued messages. The previous held-message policy and manual retry controls have
been removed. Retry retains completed tool work and removes the failed answer.
A fresh send excludes abandoned calls from model execution; only an explicit
interrupt resume may execute an unanswered historical tool call.

`ask_questions` uses TanStack's resumable tool-input protocol. `ChatInterrupts`
renders native generic form interrupts and opt-in
[tool approvals](https://tanstack.com/ai/latest/docs/tools/tool-approval), with
native batching, cancellation, staging, and resume. Questions in a parallel tool
batch wait for all answers. No blanket approval policy is added. The existing
schema-driven form renders the controls; native interrupts own their lifecycle.
Legacy MCP transport elicitation and realtime still use the small live-callback
bridge because those requests cannot be resumed by replaying the tool.

[Client persistence](https://tanstack.com/ai/latest/docs/persistence/client-persistence)
saves messages and pending interrupt descriptors through the existing store.
Approval definitions are registered before hydration. A reload can restore a
question or approval and resume it without replaying completed sibling tools.
Only paused interrupts retain a resume pointer: this browser-only application
has no durable executor that could continue a running generation after reload.

## Compaction and application middleware

[withCompaction](https://tanstack.com/ai/latest/docs/advanced/compaction) checks
provider context before each model call, including after tool output. Its
`clearToolResults()` strategy runs first, followed by `summarizeOldest()` when
needed. Summaries use native `chat()` and telemetry. The configured model and
threshold remain respected; disabling compaction disables these strategies.
The full saved transcript stays intact. Custom context estimation, summary
replacement, the summarizer client method, and overflow retry branches are gone.
Old saved summary markers remain readable.

[Application middleware](https://tanstack.com/ai/latest/docs/advanced/middleware)
handles provider-only request preparation, progress display, and rich tool
metadata. A small policy keeps loaded skill instructions when
compaction removes their original tool result: native skill activation is
deduplicated within a run. Compaction and this policy also run in native children,
with each child's cancellation signal. Compaction uses the framework's estimates
and recent-message retention; it does not guarantee that an oversized latest
request fits, and no reactive overflow retry is performed.

The [agentic cycle](https://tanstack.com/ai/latest/docs/chat/agentic-cycle) is
TanStack's `chat()` loop with `maxIterations(100)`, tool validation, and execution.
The limit applies independently to each parent and child, including tool calls
used to repair their work.
The application no longer maintains a shared model-call budget, custom turn
counter, or synthetic `MAX_TURNS` failure/Continue action. Native iteration-limit
completion keeps the produced messages and follows TanStack's normal outcome.
Workspace verification is middleware inside this cycle. `onToolPhaseComplete`
collects changed paths from tool-result metadata; `onConfig` checks those files
before the next model call and supplies provider-only findings. The model repairs
failures through ordinary tool calls within the native iteration limit, or
explains unresolved findings. Verification no longer restarts a finished answer
or enforces a separate repair budget. Job/manifest persistence and readiness
phases are gone. HTML dependency, Office, PDF, image, and syntax checks remain
browser-local. Only changed files are read, with the workspace index used for
dependency checks. Interrupted runs restore changed paths from saved tool
results when continuing. Artifact chips also use those results, including
subagent writes, moves, and deletions.

The loading indicator derives from ChatClient's loading state. Before an
assistant message exists, the UI projects a temporary placeholder without adding
it to the saved transcript. Its message identity varies the label between
responses while keeping it stable during a response.

[Native subagents](https://tanstack.com/ai/latest/docs/chat/subagents) receive
parent context and a delegated task, stream nested message parts, and can pause
for input. They inherit selected capabilities, attachment preparation, workspace
access, and cancellation. Their artifact mutations
reach parent verification. Realtime's `agent` tool uses the same one-shot runner
and returns the final text because the voice protocol has no nested chat cards.

The remaining optional integrations are the devtools panel (now that ChatClient
owns state), native memory storage, and code mode. Modern MCP input-required
resume still needs a separate integration: the public raw `callTool` API does
not accept input responses, while native tool execution normalizes away the full
initial result required by saved widgets. Existing legacy MCP form/URL requests
continue through the transport bridge.

## Compatibility boundaries

`aiMessages.ts` translates persisted Wingman conversations to native UI messages.
Native messages can include several model/tool rounds, so the storage projection
splits them into ordered assistant and tool-result turns with durable identities.
Existing media, reasoning payloads, artifacts, and tool display metadata remain
readable. `agent.ts` supplies native tool definitions and application middleware;
TanStack owns the full model/tool cycle.

`aiProvider.ts` selects dynamic gateway model aliases with `extendAdapter`, keeps
cancellation attached to provider requests, and omits an empty multipart model
field when selecting the gateway default. The embedding boundary retains the
resolved model identity returned by the gateway for retrieval indexes.
`gatewayText.ts` extends the native Responses adapter to retain commentary and
final-answer phases on output and replay, resolved model identity, and the
gateway's reasoning context mode; native parsing still handles the stream.
Saved pre-migration reasoning is translated to the adapter's signature
format and replayed only for the same model.

`gatewayRealtime.ts` implements `RealtimeAdapter` for the existing WebSocket
protocol and audio recorder/player. The upstream OpenAI realtime adapter uses
WebRTC and does not expose the gateway URL or input/output device choices this
application needs. The compatibility adapter also preserves interruption offsets,
configuration readiness, and per-session cleanup. Rebinding native clients updates
executable tools without reconnecting the physical socket.

`mcpTransport.ts` forwards the SDK transport while exposing server metadata,
legacy elicitation, and change notifications to the workspace. Resource reads use
local cancellation because the native MCP resource API has no signal argument.
Calls and discovery use the native client's APIs.

`McpApp.tsx` uses the renderer's `AppFrame` primitive because TanStack's current
`MCPAppResource` wrapper does not accept the initial tool result or the display
mode callbacks needed by saved widgets. The host boundary supplies existing
capabilities, tool visibility policy, display mode, theme, CSP, and permissions.
Raw MCP results, including `_meta`, are persisted for widgets; older records use
the existing display-content fallback. The iframe stays mounted when switching
between inline and fullscreen display.

Gateway-only extraction, rendering, search, translation, segmentation, and guard
endpoints keep their existing request helpers; TanStack has no equivalent for
these endpoint contracts. Workspace persistence, file tools, memory, and audio
device ownership remain application responsibilities.

## Verification

Unit integration tests exercise the actual TanStack model loop, OpenAI adapter,
MCP client, realtime client, and renderer bridge. Browser suites exercise compiled
chat UI, queueing/cancellation, saved conversations, memory, voice devices and
interruptions, and MCP sandbox behavior. Gateway end-to-end tests additionally
require a configured live deployment; local mocked transport tests do not prove
that every deployment alias accepts the native provider schema.
