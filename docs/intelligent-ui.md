# Intelligent UI

Assistant replies can carry a small interactive interface inline: a what-if
calculator, a filtered table, a chart of numbers from the turn, or option
buttons that continue the conversation. The model emits a ```ui fence holding
a JSON document; the app validates it and renders native components with
reactive state. Expressions use a restricted interpreter.

An inline interface is part of an answer: browser-local state, built-in
components, and data from the conversation or tools. Use an HTML artifact for
a deliverable with file revisions, custom layout, libraries or workspace data.
The prompt in
`src/features/chat/prompts/intelligent-ui.txt` and the `intelligent-ui`
built-in skill give the model that decision rule.

Short visual follow-ups inherit the topic and output preferences of the
conversation. After an explanation, "illustrate" defaults to an inline drawing,
with controls when they help understanding. A static SVG can also render inline;
SVG alone does not imply a downloadable file. An established handout, file or
export request still calls for an artifact. This boundary appears in the shared
chat prompt and both skill descriptions so it is available before skill loading.

## Authoring contract

Wingman's JSON format is defined by its implementation. DIL-style examples are
design inspiration; their tags, hooks and host APIs are not supported syntax.
[ChatKit widgets](https://developers.openai.com/api/docs/guides/chatkit-widgets)
are another reference for structured components and action payloads, with their
own component names and props. Neither establishes compatibility with Wingman.

The core contract is small: `state` holds inputs, `computed` derives values,
`bind` connects a control to state, and `children` describes the interface.
For example, this illustrative estimate updates locally as the seat count changes:

```ui
{
  "title": "Illustrative seat estimate",
  "state": { "seats": 5 },
  "computed": { "total": "seats * 12" },
  "children": [
    { "type": "stepper", "bind": "seats", "label": "Seats", "min": 1, "max": 100 },
    { "type": "metric", "label": "Monthly total", "value": "{{ total }}", "format": "currency", "currency": "EUR" },
    { "type": "text", "text": "Assumes €12 per seat per month." }
  ]
}
```

Use Markdown for the answer, this format for useful inline interaction, and the
component reference for exact authoring details. A separate JSX grammar or hooks
layer is unnecessary for these interactions.

## Architecture

The design separates what the model may choose from what the application
executes:

| Layer                                        | Responsibility                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/lib/intelligentUi/schema.ts`     | Zod component schemas, JSON normalization, aliases, and tree limits. Unknown props are dropped; invalid components become error nodes. |
| `src/shared/lib/intelligentUi/expression.ts` | Restricted parser, evaluator, templates, and static syntax checks. Helpers are allowlisted; property reads exclude prototypes.         |
| `src/shared/lib/intelligentUi/registry.ts`   | `describeRegistry()` summarizes components, prop types, enums, templates, helpers, actions and formats for tooling.                    |
| `src/shared/lib/intelligentUi/runtime.ts`    | TanStack Store state, derived values, action dispatch and browser persistence.                                                         |
| `src/shared/ui/intelligent/*`                | React components, TanStack tables and charts, sanitized SVG, streaming previews and error display.                                     |
| `src/shared/ui/Markdown.tsx`                 | Routes UI fences to the renderer and passes the host's send-message callback.                                                          |

### One language, three descriptions

The language is described in three places: the registry (code),
`references/components.md` (full reference) and `prompts/intelligent-ui.txt`
(compact prompt). When a component, prop, helper or action is added or
changed, update the relevant descriptions. `registry.test.ts` checks name
coverage; schema, expression, runtime and renderer tests check behavior.
The tooling summary derives prop descriptions from Zod; nested constraints and
runtime semantics still belong to the schemas and implementation.

Props are typed, but any string prop, enum props included, may hold a `{{ }}`
template so values can follow state (`"tone": "{{ ok ? 'success' : 'error' }}"`).
Computed dependencies resolve on first read, including inside collection
expressions. Each value is evaluated once per state change; circular
dependencies appear as errors. Collection searches (`find`, `some`, `every`)
stop as soon as their result is known.
The `each` component repeats its children per item of an array and extends the
expression scope with `item`, `index` and an optional `as` name; button actions
inside it run with the same scope, so a list of option buttons can be derived
from data.

### Action layer

Buttons run a list of actions through the runtime. State actions (`set`,
`reset`) stay inside the document. `copy` and `open` act on the viewer's
clipboard or browser after a click (`open` accepts http(s) only). `copy` reports
success only after its host handler succeeds; an unavailable handler stops the
action list with an error. `send` posts text as the user's next turn, so the
model, with the user's normal tool
permissions, decides what happens next. A document cannot call tools, fetch
URLs, or write to the workspace. `confirm` on a button asks before running.
Forms use the same action handler for clicks and native form submission.
Required text fields must contain more than whitespace, and submission stays
disabled while the response streams.

### Rendering lifecycle

While the fence streams, the block renders progressively: the streaming text
is cut at the last complete value, open arrays and objects are closed, and the
resulting prefix is rendered with a throwaway runtime and without validation
warnings (a component cut off mid-stream is not a mistake yet). State controls
and action buttons remain disabled, even if the JSON already parses. A prefix
with no complete component shows a placeholder. Once the host marks streaming
finished, the document is parsed and validated in full and gets its persistent
runtime.
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

Selection controls share the app's Headless UI components: `select` uses
`SelectMenu`, and `segmented` uses the same `SegmentedControl` as Settings.
Toggles render as switches. Labels, help text, keyboard selection and disabled
states are handled by these components; the JSON format and state bindings stay
the same. Dropdown options render in a portal so chat containers do not clip them.

### Diagnostics back to the model

Rendering diagnostics return to the model on the next run.
`src/shared/lib/intelligentUi/diagnostics.ts` is a chat middleware that, on
the first model call of that run, validates the fences
of the previous assistant turn and adds a short user-role note listing what
failed (an unknown component, a missing `bind`, unparseable JSON, an
expression that cannot run, a reference to an undeclared key). The model
can then emit a corrected block if the user still needs it. The note is sent to
the provider only and never appears in the transcript.

## Extending

Add a component by declaring its props schema in `COMPONENTS` in `schema.ts`
(use `choice([...])` for enum props so they accept templates), give it a
category in `registry.ts`, and render it in `UiNodeView.tsx`; document it in
`skills/studio/intelligent-ui/references/components.md` and the chat prompt.
The registry test tells you what is missing.
Add an expression helper to `HELPERS` in `expression.ts`; helpers must be pure
and bounded. The renderer-independent pieces (`schema`, `expression`,
`runtime`) have unit tests beside them.
