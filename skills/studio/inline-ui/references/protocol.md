# Protocol, bindings and actions

A `ui` or `a2ui` fence accepts strict JSON: one message, an array of messages, or JSONL. Use the pinned version shown below. A message has one operation:

```json
{
  "version": "v1.0",
  "createSurface": {
    "surfaceId": "estimate",
    "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
    "components": [{ "id": "root", "component": "Text", "text": "Ready" }],
    "dataModel": {}
  }
}
```

- `createSurface`: unique `surfaceId`, optional default `catalogId`, initial `components`, `dataModel`, optional `sendDataModel`. Create a surface only once per conversation.
- `updateComponents`: `surfaceId` and `components` to add/replace. Keep stable IDs; supply complete properties for each replacement.
- `updateDataModel`: `surfaceId`, JSON Pointer `path`, `value`; `null` deletes the path. `/` addresses the root.
- `deleteSurface`: `surfaceId`. Removes the surface while retaining the transcript.

## Components and values

Components form a flat list: each has a unique `id`, a case-sensitive `component` name and its props. The root ID is `root`. `Child` is a component ID; `ChildList` is an array of IDs or `{"path":"/items","componentId":"template"}` for repetition. IDs must be identifiers such as `seat_count`, not hyphenated names. Every referenced child needs a definition.

Use the Basic Catalog as the surface default. Wingman components/functions need `catalogId: "urn:wingman:inline-ui:catalog:1"`. Functions inherit the component/function catalog; specify `catalogId` when crossing catalogs, including Basic validators inside Wingman controls. Catalog identifiers select bundled implementations; they do not fetch code.

`DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, and `DynamicValue` accept an appropriate literal, a `DataBinding` such as `{"@path":"/quantity"}`, or a `FunctionCall` such as `{"@call":"formatNumber","args":{"value":{"@path":"/total"}}}`. Literal strings do not interpolate; see [functions.md](functions.md). There is no state/computed wrapper, bind prop, nested component tree or `{{ }}` syntax.

Controls write through their `value` binding; literal/calculated values are read-only. Inside repeated templates, use relative bindings such as `{"@path":"name"}` for the current row. Components can carry `accessibility` with `label`, `description`, `live`, and `hidden`.

## Actions

Use an event to continue the conversation with values resolved at click time:

```json
{ "event": { "name": "save", "userMessage": "Save choices", "context": { "choice": { "@path": "/choice" } } } }
```

Set `createSurface.sendDataModel:true` when the action needs the full data model. Otherwise include only needed values in `context`. The visible user turn uses `userMessage`; the agent also receives the structured action.

Use a local function for interaction that does not need a model request:

```json
{
  "functionCall": {
    "@call": "setValue",
    "catalogId": "urn:wingman:inline-ui:catalog:1",
    "args": { "path": "/quantity", "value": 5 }
  }
}
```

`Action` is either `{event:...}` or `{functionCall:...}`. `setValue` writes a nested path; write a defaults object to `/` to reset. `openUrl` accepts HTTP(S) URLs. These functions require user activation; persisted fences never execute renderer RPCs during replay.

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Generated signatures; `?` means optional.

### Basic catalog

`catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"`

Functions:

- openUrl { url: string|DataBinding|FunctionCall }: void (user action only)

### Wingman catalog

`catalogId: "urn:wingman:inline-ui:catalog:1"`

Functions:

- setValue { path: string, value: DynamicValue }: void (user action only)
- copyText { text: DynamicString }: void (user action only)

<!-- A2UI-CATALOG:END -->
