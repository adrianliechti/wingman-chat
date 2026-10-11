# Inline UI

Inline UI embeds native interactive surfaces in assistant replies. Its wire contract is **A2UI v1.0 candidate**, pinned to `@a2ui/web_core@0.13.0`. AG-UI remains the agent event transport; A2UI owns UI messages, catalogs, bindings, data models and actions.

The Basic Catalog supplies 18 standard components. Wingman's versioned catalog supplies 24 extensions, including Chart, Table, Metric, Grid, Svg, Timeline, Form and richer controls. These use A2UI component naming and value bindings. Chart/table payloads are Wingman catalog contracts; A2UI does not standardize their data format.

## Authoring

Emit strict JSON in a `ui` or `a2ui` fence: one message, an array of messages, or newline-separated messages. Each carries `version: "v1.0"`. Use `createSurface` with a unique surface ID and a flat component list containing `root`. Child references are IDs. Bind inputs with `{"@path":"/seats"}` and calculations with `{"@call":"evaluate","catalogId":"urn:wingman:inline-ui:catalog:1","args":{"expression":"seats * 12","values":{"seats":{"@path":"/seats"}}}}`.

Load the [inline-ui skill](../skills/studio/inline-ui/SKILL.md), which routes to focused references for protocol, layout/content, controls/forms, data display and functions. Read only the groups needed for the current interface; examples and full JSON schemas remain separate resources. Markdown explains the answer; Inline UI lets users explore assumptions or choose a next step. Requested deliverables or arbitrary applications use artifacts.

## Supported profile

- The registered Basic Catalog ID is `https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json`; Wingman's is `urn:wingman:inline-ui:catalog:1`. Catalog IDs select trusted bundled implementations and never fetch code.
- `createSurface`, `updateComponents`, `updateDataModel` and `deleteSurface` operate across replies within one conversation. Agent function responses can be parsed; this host does not expose an agent RPC caller.
- Complete streaming messages apply progressively. Partial messages never invent values. Controls remain disabled while their reply streams.
- Named `action.event` interactions send the standard A2UI action envelope, renderer capabilities and opted-in data models through the normal user-turn flow. Readable action text appears in chat; metadata carries the exact payload to every model request in that run, including tool continuations.
- `action.functionCall` invokes registered user-activated local functions. Persisted fences **reject renderer RPC requests**, so reloading history never opens URLs, copies text or sends actions. This is a persisted-surface profile, not full directional RPC support.
- Basic controls retain standard types: TextField writes strings, CheckBox booleans, ChoicePicker string arrays and Slider numbers. Writable values use bindings; literals and calculated values are read-only. Standard `required` accepts false and whitespace.
- Basic Text supports the catalog's limited Markdown. Wingman's Html and Svg have their existing sandbox/sanitization boundaries. Form validates descendants and provides accessible feedback.
- Expressions share a work budget across nested collection helpers and bound evaluation depth. Oversized or recursive calculations report an expression error instead of blocking the interface.

## Architecture and persistence

`src/shared/lib/inlineUi/catalog.ts` registers upstream schemas/functions and Wingman extensions. `protocol.ts` parses bounded strict messages and uses the same Markdown parser as display. `runtime.ts` owns one SDK MessageProcessor per conversation, its resolvers and local persistence. `src/shared/ui/inlineUi` renders resolved nodes with native React components. `diagnostics.ts` supplies bounded diagnostics and structured interaction context to the model.

Both catalogs have explicit renderer maps checked against their schemas, including nested props and control write types. `rendererTypes.ts` infers resolved values from schema branches before the SDK's dynamic-expression `any` can erase their types; child references become SDK ComponentNodes. One dispatch boundary connects SDK nodes to these typed renderers. Type regression tests and catalog coverage tests guard this mapping alongside the existing wire-format snapshots.

Buttons and forms show progress while an action is pending. Submission failures are tracked explicitly because the SDK event emitter swallows listener rejections; late failures from deleted or replaced surfaces are discarded. Rendering and action errors show concise feedback with technical details collapsed. Actions are never retried automatically.

User edits are stored in localStorage under `wingman:a2ui:1:` and bounded to 100 owners / 1 MB per record. A contract fingerprint includes protocol, SDK and Wingman catalog versions. Saved values apply only to the matching transcript prefix, before later agent updates. Edited transcripts rebuild; different conversations have separate state. Storage failure leaves interaction usable.

The former private IntelligentUI payload was prelaunch and is replaced, without a migration layer. Historical fence names remain recognized, but their contents must be A2UI. After launch, incompatible catalog changes require a new catalog ID plus explicit migration fixtures. Do not silently reinterpret persisted documents or restore data across a changed contract.

## Compatibility checks

`npm run generate:ui-reference` generates the grouped skill references and catalog JSON from the registered schemas. The always-loaded chat prompt contains only presentation routing and essential constraints, with no component catalog. `npm run check:ui-reference` detects drift and enforces character budgets during check/build: 1,200 for the chat prompt, 3,600 for the skill entrypoint, and 7,200 per focused reference (roughly 300, 900 and 1,800 tokens at four characters per token; actual tokenization varies).

Every component/function belongs to exactly one generated lookup group. Tests verify complete coverage, consistent shared properties, valid reference links and lazy loading through the real skill tools. Full JSON schemas remain published for exact contract/debugging lookups, but normal authoring uses the smaller references. Examples remain individually loadable.

This follows the useful pattern in [CopilotKit's skill](https://github.com/CopilotKit/CopilotKit/blob/main/skills/copilotkit/SKILL.md): a compact lookup index backed by source-generated API details. Our reference source is the pinned installed A2UI schemas, so external examples cannot silently change the supported contract.

Tests cover all 42 registered components with explicit wire fixtures, resolution snapshots and renderer dispatch. Schema tests lock required properties, unknown-property rejection, structured data, function inputs and protocol envelopes. Runtime tests cover relative template bindings, actions, replay, transcript edits, storage isolation and unsafe paths. Browser tests exercise real charts, keyboard controls, validation and reload persistence.

The pinned SDK includes 43 upstream examples. Tests process 42 unchanged and retain its invalid `31_incremental-dashboard.json` (hyphenated component ID) as a rejection fixture. Catalog snapshots and upstream examples must be reviewed whenever the SDK version changes; update the constant, persistence contract and generated references together.

SDK 0.13.0 rejects structured ValidationResult operands in its logical function invoker. A narrow BasicCatalog adapter normalizes only execution-time and/or/not operands. Wire schemas remain upstream-owned. Remove it when the SDK fixes the issue. The runtime also rechecks intermediate binding errors against settled model state.

Run `npm run check`, `npx vp test run`, `npx playwright test tests/browser/markdown.spec.ts tests/browser/inline-ui-gallery.spec.ts`, and `npm run build` when updating this integration.

## Upstream references

- [A2UI v1.0 protocol](https://a2ui.org/specification/v1.0-a2ui/)
- [Basic Catalog implementation guide](https://a2ui.org/specification/v1.0-basic-catalog-implementation-guide/)
- [Upstream v1 examples](https://github.com/a2ui-project/a2ui/tree/main/specification/v1_0/catalogs/basic/examples)

The gallery adapts the live invitation builder's editor/preview and financial grid's data-driven layouts into mixed-catalog examples. Upstream v0.9 React samples are useful visual references but do not define our v1 wire syntax.

## Rendered examples

![Inline UI mixed-catalog examples](assets/inline-ui-examples.png)

Regenerate the PNG with `UPDATE_INLINE_UI_GALLERY=1 npx playwright test tests/browser/inline-ui-gallery.spec.ts`. The gallery uses the complete example JSON files shipped with the authoring skill.
