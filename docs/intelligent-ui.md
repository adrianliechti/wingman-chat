# Intelligent UI

Assistant replies can carry a small interactive interface inline: a what-if
calculator, a filtered table, a chart of numbers from the turn, or option
buttons that continue the conversation. The model emits a ```ui fence holding
a JSON document; the app validates it and renders native components with
reactive state. No model-generated code runs.

This complements the artifacts workspace rather than replacing it. An inline
interface is part of an answer: ephemeral state, built-in components, data from
the conversation. An HTML artifact is a deliverable: a file with revisions,
custom layout and libraries, and workspace data. The prompt in
`src/features/chat/prompts/intelligent-ui.txt` and the `intelligent-ui`
built-in skill give the model that decision rule.

## Architecture

The design separates what the model may choose from what the application
executes:

| Layer                                        | Responsibility                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/lib/intelligentUi/schema.ts`     | Typed component registry (Zod). Normalizes the model's JSON, resolves aliases, drops unknown props, turns unknown components into inline error nodes, and bounds tree size and depth.                                                                                                                                                                            |
| `src/shared/lib/intelligentUi/expression.ts` | A safe expression language: tokenizer, Pratt parser, evaluator, `{{ }}` templates. No JavaScript evaluation; property reads never touch prototypes; helpers are a fixed allowlist.                                                                                                                                                                               |
| `src/shared/lib/intelligentUi/runtime.ts`    | TanStack Store runtime: a store for bound state, a derived atom for `computed` values, and an action dispatcher. Runtimes are cached by fence source so state survives remounts.                                                                                                                                                                                 |
| `src/shared/ui/intelligent/*`                | React renderer: `UiRenderer` (streaming placeholder, validation fallback, code toggle), `UiNodeView` (components), `UiTable` (TanStack Table), `UiChart` (TanStack Charts, SVG with keyboard focus, tooltips, legends and themed palettes for both modes), `UiSvg` (sanitized inline SVG with templated attributes and CSS transitions for explorable diagrams). |
| `src/shared/ui/Markdown.tsx`                 | Routes ```ui fences to the renderer and passes the host's send-message callback.                                                                                                                                                                                                                                                                                 |

### Action layer

Buttons run a list of actions through the runtime. State actions (`set`,
`reset`) stay inside the document. `copy` and `open` act on the viewer's
clipboard or browser after a click (`open` accepts http(s) only). `send` posts
text as the user's next turn, so the model, with the user's normal tool
permissions, decides what happens next. A document cannot call tools, fetch
URLs, or write to the workspace. `confirm` on a button asks before running.

### Rendering lifecycle

While the fence streams, the block renders progressively: the streaming text
is cut at the last complete value, open arrays and objects are closed, and the
resulting prefix is rendered with a throwaway runtime and without validation
warnings (a component cut off mid-stream is not a mistake yet). A prefix with
no complete component shows a placeholder. Once the fence closes the document
is parsed and validated in full and gets its persistent runtime.
A document the schema rejects as a whole falls back to its JSON with the reason;
individual bad components render as a small warning and the rest still works.
Expression errors in `computed` values are listed under the interface instead
of hiding the whole block, as are references to state keys the document never
declares (a misspelled key renders blank rather than breaking the layout).

State is kept in the browser: each document's values are saved in localStorage
under a hash of its source (bounded to the most recent 200 interfaces), so a
reload keeps the user's adjustments. Saved values are only applied to keys the
document still declares. The fence text stays in the transcript, so the model
sees the document it produced and copies and exports keep it as code.

### Diagnostics back to the model

A fence renders after its run has ended, so a broken document cannot be fixed
in the same run. `src/shared/lib/intelligentUi/diagnostics.ts` is a chat
middleware that, on the first model call of the next run, validates the fences
of the previous assistant turn and adds a short user-role note listing what
failed (an unknown component, a missing `bind`, unparseable JSON). The model
can then emit a corrected block if the user still needs it. The note is sent to
the provider only and never appears in the transcript.

## Extending

Add a component by declaring its props schema in `COMPONENTS` in `schema.ts`
and rendering it in `UiNodeView.tsx`; document it in
`skills/studio/intelligent-ui/references/components.md` and the chat prompt.
Add an expression helper to `HELPERS` in `expression.ts`; helpers must be pure
and bounded. The renderer-independent pieces (`schema`, `expression`,
`runtime`) have unit tests beside them.
