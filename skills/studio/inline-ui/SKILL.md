---
name: inline-ui
description: "Render visual explanations and small interactive interfaces inline using A2UI: drawings, calculators, charts, sortable tables and option buttons. Prefer for 'illustrate' or 'show me how it works' in an explanatory conversation without a file requirement. Use visualize, data-visualization or html-artifacts for requested files/exports or needs beyond inline components."
---

# Inline UI

A `ui` fence contains A2UI v1.0 messages that Wingman renders with native components. Read `references/components.md` for exact schemas, bindings, validation and actions, and `references/examples.md` for complete examples.

## Choose the presentation

State the answer in prose. Add interaction when it lets the user change an assumption, filter data, choose a next step, or explore a structure. A requested illustration can use Wingman `Svg` without controls. Interpret short follow-ups using the conversation's topic and delivery preferences. An in-chat explanation belongs here; a requested file, export, page, dashboard, app, or analysis requiring workspace files belongs in an artifact skill. Voice replies use prose.

Use Basic Catalog `Row`, `Column`, `Card`, `Text`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `Tabs`, `List`, `Button`, `Image`, `Icon`, `Video`, `AudioPlayer`, `DateTimeInput`, `Modal`, and `Divider`. Use the Wingman catalog for `Chart`, `Table`, `Metric`, `Svg`, `Collapsible`, other richer components, and arithmetic/collection functions.

## Author an interface

1. Emit strict JSON with `version: "v1.0"`. Create a unique surface using the Basic Catalog ID from the reference.
2. Set initial input values in `createSurface.dataModel`.
3. Provide a flat component list with unique IDs and a `root` component. Reference children by ID. Standard component names and props are case-sensitive.
4. Bind control `value` with `{"@path":"/key"}`. Use relative paths in `List` templates for editable rows.
5. Calculate with `{"@call":"evaluate","catalogId":"urn:wingman:inline-ui:catalog:1","args":{"expression":"quantity * 12","values":{"quantity":{"@path":"/quantity"}}}}`. Use only the documented restricted helpers. No `state`, `computed`, `bind`, or `{{ }}` syntax.
6. Put a `catalogId` on every Wingman component/function when the surface defaults to the Basic Catalog. Functions inherit the component catalog: Basic validators inside Wingman controls need the Basic catalogId.
7. Use named `action.event` payloads for agent interactions, and user-activated `action.functionCall` for local effects. Include current values in context or enable `sendDataModel`.
8. Continue using `updateComponents` and `updateDataModel` for subsequent changes to that surface. Never issue a second createSurface with the same ID.

## Check before emitting

Every prop must exist in the catalog. Every child ID must resolve. Every writable control must bind to a data path; calculated values are read-only. Label controls and explain chart axes, units and sources. Values come from the conversation, tools, the user, or clearly labelled illustrative assumptions. Each control should affect something visible. Keep the interface focused; large datasets and deliverables belong in artifacts.

The host validates messages and catalogs, keeps user edits in the browser, and sends structured actions through the normal chat/tool permission flow. Catalog identifiers never fetch or execute code. Data-model changes stay local until an action carries them to the agent. Persisted fences never execute RPCs during replay.
