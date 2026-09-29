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
- `@tanstack/ai-client` owns realtime conversation state and client tool execution.
- `@tanstack/ai-mcp` owns MCP initialization, discovery, calls, resources, prompts,
  and connection cleanup. The SDK HTTP transport supplies browser OAuth.
- MCP apps use `AppFrame` and `AppBridge` from `@mcp-ui/client`, the renderer used
  by TanStack's `MCPAppResource`. It owns iframe initialization and delivery of
  initial tool input and results.

The integration follows [TanStack AI](https://tanstack.com/ai/latest),
[MCP](https://tanstack.com/ai/latest/docs/tools/mcp),
[realtime](https://tanstack.com/ai/latest/docs/media/realtime-chat), and
[MCP Apps](https://tanstack.com/ai/latest/docs/mcp/apps). Examples that put
orchestration in a server route are adapted to the application's browser-only
execution requirement. The installed package sources define the precise APIs.

## Additional native features

MCP tools use [lazy tool discovery](https://tanstack.com/ai/latest/docs/tools/lazy-tool-discovery).
Chat initially sends the native discovery tool with a short catalog (tool names
and their first description sentence). TanStack supplies schemas on demand,
executes discovered tools, and restores discoveries from saved history. Built-in
workspace tools remain eager. Discovery adds a model round trip the first time a
tool is needed, counted against the existing run budget. Realtime voice and
one-shot completions continue to receive their full tool definitions.

Text-only results retain TanStack's JSON string representation across storage
round trips, so discovery does not require an application cache. Media results
remain native content parts. Removed or disabled tools cannot be re-enabled by
an old discovery result. The chat displays discovery as **Find tools**.

Streaming uses TanStack's `CompositeStrategy`, combining word and punctuation
boundaries with a three-chunk batch. This reduces partial-word UI updates, while
the native processor flushes remaining text when the message ends. Tool and
reasoning events retain their native timing. MCP `isError` results also reach
TanStack's failure lifecycle while retaining the original widget result and
display metadata.

Enable [native debug logging](https://tanstack.com/ai/latest/docs/advanced/debug-logging)
with `VITE_AI_DEBUG=true npm run dev`. It covers chat, structured output, speech,
and transcription, including provider frames and tool arguments/results in the
browser console. The switch is disabled in production builds. Chat runs now
also pass the stable workspace chat id as TanStack's `threadId`.

## Guide review and remaining boundaries

The following guides were reviewed against the installed APIs. These are further
migration opportunities, with specific behavior to preserve:

| Guide                                                                                                                                                           | Integration consideration                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Compaction](https://tanstack.com/ai/latest/docs/advanced/compaction)                                                                                           | Native strategies rewrite provider context and can preserve the full transcript. Replacing the current policy must also retain the exact active user request, active skill instructions, persisted summary markers, summarizer fallback, and encrypted reasoning handling. Adding a second compactor would give two policies control of the same history.         |
| [Persistence](https://tanstack.com/ai/latest/docs/persistence/overview) and [resumable streams](https://tanstack.com/ai/latest/docs/resumable-streams/overview) | Native client persistence is viable with a workspace adapter. OPFS currently owns messages and attachment lifetimes. A reload terminates execution in this tab; storage alone cannot keep an in-flight model run alive.                                                                                                                                           |
| [MCP client input](https://tanstack.com/ai/latest/docs/tools/mcp-input)                                                                                         | Modern form/sampling resume works through native tools and interrupts. The public raw `callTool` API does not accept an input response, while native tool execution normalizes away the complete result needed by saved widgets. Legacy form/URL elicitation remains supported by the existing transport boundary; modern input-required resume is not yet wired. |
| [Devtools](https://tanstack.com/ai/latest/docs/getting-started/devtools)                                                                                        | The panel needs registered `ChatClient`/framework hook state. The current workspace uses `StreamProcessor` directly. Native console diagnostics work now; a panel requires moving client lifecycle ownership too.                                                                                                                                                 |
| [Portable skills](https://tanstack.com/ai/latest/docs/skills/agent-skills) and [memory](https://tanstack.com/ai/latest/docs/memory/overview)                    | Both accept custom browser-backed sources/adapters. The workspace still owns plugin-qualified skills, script mounts, editable memory files, and learning rules. These need source adapters and saved-history migration, rather than a second catalog or memory store.                                                                                             |
| [Subagents](https://tanstack.com/ai/latest/docs/chat/subagents)                                                                                                 | Native children stream nested parts and support interrupts. Adoption must carry shared invocation budgets, selected tools, workspace updates, and existing subagent result metadata into those parts.                                                                                                                                                             |
| [Code Mode](https://tanstack.com/ai/latest/docs/code-mode/code-mode)                                                                                            | The QuickJS driver supports browsers. Tool batching is a possible addition, but is not a replacement for the existing Python/JavaScript interpreters' files, packages, and artifact output.                                                                                                                                                                       |

## Compatibility boundaries

`aiMessages.ts` translates persisted Wingman conversations to native UI messages.
Native messages can include several model/tool rounds, so the storage projection
splits them into ordered assistant and tool-result turns with durable identities.
Existing media, reasoning payloads, artifacts, and tool display metadata remain
readable. `agent.ts` supplies workspace lifecycle hooks, shared subagent budgets,
context compaction, and artifact verification around the native loop.

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
