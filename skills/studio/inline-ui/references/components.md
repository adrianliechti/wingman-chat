# Inline UI: A2UI component reference

Wingman uses A2UI v1.0, pinned to `@a2ui/web_core@0.13.0`. This candidate version is the exact supported contract. A `ui` or `a2ui` fence accepts one JSON message, an array of messages, or JSONL. Read `examples.md` for complete payloads.

## Protocol

- `createSurface`: unique `surfaceId`, optional default `catalogId`, initial `components`, `dataModel`, and optional `sendDataModel`.
- `updateComponents`: `surfaceId` and the component definitions to add/replace. Keep stable component IDs. Supply complete properties for a replaced component.
- `updateDataModel`: `surfaceId`, JSON Pointer `path`, and `value`; `null` deletes the path. The root path is `/`.
- `deleteSurface`: `surfaceId`. The transcript still records the messages, while the surface is removed.
- Every message carries `"version":"v1.0"`. The root component is `"root"`.

Components have `id`, `component`, optional `catalogId`, and their catalog props. They may carry standard `accessibility` (`label`, `description`, `live`, `hidden`). Child properties contain IDs; `children` also accepts `{"path":"/items","componentId":"template"}` for repetition. Input bindings within a repeated template are relative to that item's data, e.g. `{"@path":"name"}`.

`DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, and `DynamicValue` accept an appropriate literal, a binding `{"@path":"/key"}`, or a function `{"@call":"name","args":{...}}`. Function calls inherit their component/function catalog; specify `catalogId` when crossing catalogs (including Basic validators on Wingman controls). Plain strings remain literal. The old nested tree, state/computed wrapper, bind prop, aliases and `{{ }}` expressions are not A2UI syntax.

Use the Basic Catalog as the surface default. Specify `catalogId: "urn:wingman:inline-ui:catalog:1"` on Wingman extensions. Basic `TextField` always writes strings; `CheckBox` writes booleans; `ChoicePicker` writes string arrays; `Slider` writes numbers. Wingman `Select`, `Segmented` and `Radio` write one string; `MultiSelect` writes a string array. Literal and calculated control values are read-only.

## Actions and validation

An `Action` is `{"event":{"name":"save","userMessage":"Save choices","context":{"choice":{"@path":"/choice"}}}}` or `{"functionCall":{"@call":"openUrl","args":{"url":"https://example.com"}}}`. Event context resolves on click. Set `sendDataModel:true` to include the full surface data alongside actions. Local function actions never contact the agent. RPC execution is unsupported in persisted fences.

`checks` is an array of `{"condition":{"@call":"required","catalogId":"https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json","args":{"value":{"@path":"/name"}}},"message":"Enter a name"}`. Each condition returns `{valid, message?, code?, severity?}`. Checks on a Button gate that button; Wingman Form validates its descendants. Standard required accepts `false` and whitespace, and rejects null, undefined, empty strings and empty arrays. Field errors appear after blur or form submission. Disabled or hidden Wingman fields are excluded from form checks.

## Functions

- `required(value)`, `email(value)`, `regex(value, pattern)`, `length(value, min?, max?)`, `numeric(value, min?, max?)`: validation results.
- `formatString(value)`: interpolate JSON Pointers and named function expressions in `${...}`, e.g. `"Hello ${/name}"`.
- `formatNumber(value, decimals?, grouping?)`, `formatCurrency(value, currency, decimals?, grouping?)`, `formatDate(value, format)`, `pluralize(value, other, zero?, one?, two?, few?, many?)`: formatted text. Consult the generated catalog JSON for exact parameter schemas.
- `and(values)`, `or(values)`, `not(value)`: boolean logic; validation results are interpreted through their valid field.
- `openUrl(url)`: open an HTTP(S) URL after a user gesture.
- Wingman `evaluate(expression, values)`: restricted arithmetic and collection expressions. Bind every input explicitly in `values`; use no globals, methods, assignments or JavaScript functions. Examples: `seats * 12`, `filter(rows, 'price <= budget')`, `sum(pluck(rows, 'total'))`.
- Wingman `setValue(path, value)`: set a nested path after a gesture. To reset, write a known defaults object to `/`.
- Wingman `copyText(text)`: copy after a gesture.

Catalog schemas are generated into this directory from the exact registered SDK schemas. Run `npm run generate:ui-reference` after changing the Wingman catalog; `npm run check:ui-reference` detects drift.

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Components use a flat list with unique id and component fields. Child values are component IDs, never nested components.
Catalog: https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json

- Text { text: DynamicString, variant?: "caption"|"body", weight?: number }
- Image { url: DynamicString, description?: DynamicString, fit?: "contain"|"cover"|"fill"|"none"|"scaleDown", variant?: "icon"|"avatar"|"smallFeature"|"mediumFeature"|"largeFeature"|"header", weight?: number }
- Icon { name: "accountCircle"|"add"|"arrowBack"|"arrowForward"|"attachFile"|"calendarToday"|"call"|"camera"|"check"|"close"|"delete"|"download"|"edit"|"event"|"error"|"fastForward"|"favorite"|"favoriteOff"|"folder"|"help"|"home"|"info"|"locationOn"|"lock"|"lockOpen"|"mail"|"menu"|"moreVert"|"moreHoriz"|"notificationsOff"|"notifications"|"pause"|"payment"|"person"|"phone"|"photo"|"play"|"print"|"refresh"|"rewind"|"search"|"send"|"settings"|"share"|"shoppingCart"|"skipNext"|"skipPrevious"|"star"|"starHalf"|"starOff"|"stop"|"upload"|"visibility"|"visibilityOff"|"volumeDown"|"volumeMute"|"volumeOff"|"volumeUp"|"warning"|{ svgPath: DynamicString }|DataBinding, weight?: number }
- Video { url: DynamicString, posterUrl?: DynamicString, weight?: number }
- AudioPlayer { url: DynamicString, description?: DynamicString, weight?: number }
- Row { children: ChildList, justify?: "center"|"end"|"spaceAround"|"spaceBetween"|"spaceEvenly"|"start"|"stretch", align?: "start"|"center"|"end"|"stretch", weight?: number }
- Column { children: ChildList, justify?: "start"|"center"|"end"|"spaceBetween"|"spaceAround"|"spaceEvenly"|"stretch", align?: "center"|"end"|"start"|"stretch", weight?: number }
- List { children: ChildList, direction?: "vertical"|"horizontal", align?: "start"|"center"|"end"|"stretch", weight?: number }
- Card { child: Child, weight?: number }
- Tabs { tabs: { title: DynamicString, child: Child }[], weight?: number }
- Modal { trigger: Child, content: Child, weight?: number }
- Divider { axis?: "horizontal"|"vertical", weight?: number }
- Button { checks?: CheckRule[], child: Child, variant?: "default"|"primary"|"borderless", action: Action, weight?: number }
- TextField { checks?: CheckRule[], label: DynamicString, value?: DynamicString, placeholder?: DynamicString, variant?: "longText"|"number"|"shortText"|"obscured", weight?: number }
- CheckBox { checks?: CheckRule[], label: DynamicString, value: DynamicBoolean, weight?: number }
- ChoicePicker { checks?: CheckRule[], label?: DynamicString, variant?: "multipleSelection"|"mutuallyExclusive", options: { label: DynamicString, value: string }[], value: DynamicStringList, displayStyle?: "checkbox"|"chips", filterable?: boolean, weight?: number }
- Slider { checks?: CheckRule[], label?: DynamicString, min?: number, max: number, value: DynamicNumber, steps?: integer, weight?: number }
- DateTimeInput { checks?: CheckRule[], value: DynamicString, enableDate?: boolean, enableTime?: boolean, min?: DynamicString, max?: DynamicString, label?: DynamicString, weight?: number }
  Functions:
- required { value: JSON }: validationResult
- regex { value: DynamicString, pattern: string }: validationResult
- length { value: DynamicString, min?: integer, max?: integer }: validationResult
- numeric { value: DynamicNumber, min?: number, max?: number }: validationResult
- email { value: DynamicString }: validationResult
- @index { offset?: number }: number
- formatString { value: DynamicString }: string
- formatNumber { value: DynamicNumber, decimals?: DynamicNumber, grouping?: DynamicBoolean }: string
- formatCurrency { value: DynamicNumber, currency: DynamicString, decimals?: DynamicNumber, grouping?: DynamicBoolean }: string
- formatDate { value: DynamicValue, format: DynamicString }: string
- pluralize { value: DynamicNumber, zero?: DynamicString, one?: DynamicString, two?: DynamicString, few?: DynamicString, many?: DynamicString, other: DynamicString }: string
- openUrl { url: string|DataBinding|FunctionCall }: void (user action only)
- and { values: DynamicBoolean[] }: boolean
- or { values: DynamicBoolean[] }: boolean
- not { value: DynamicBoolean }: boolean
  Catalog: urn:wingman:inline-ui:catalog:1
- Grid { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, columns?: DynamicNumber, gap?: "none"|"sm"|"md"|"lg", children: ChildList }
- Collapsible { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, title: DynamicString, description?: DynamicString, defaultOpen?: DynamicBoolean, children: ChildList }
- Heading { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, text: DynamicString, level?: DynamicNumber }
- Metric { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label: DynamicString, value: DynamicValue, format?: "number"|"integer"|"currency"|"percent"|"compact"|"text", currency?: DynamicString, digits?: DynamicNumber, unit?: DynamicString, delta?: DynamicNumber, deltaLabel?: DynamicString, description?: DynamicString }
- Callout { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, text: DynamicString, title?: DynamicString, tone?: "info"|"success"|"warning"|"error" }
- Badge { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, text: DynamicString, tone?: "neutral"|"info"|"success"|"warning"|"error" }
- Code { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, text: DynamicString, language?: DynamicString }
- Progress { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, value: DynamicNumber, max?: DynamicNumber, label?: DynamicString, format?: "number"|"integer"|"currency"|"percent"|"compact"|"text" }
- Svg { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, markup: DynamicString, height?: DynamicNumber, label?: DynamicString }
- Link { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, text: DynamicString, href: DynamicString, description?: DynamicString, kind?: "link"|"chip" }
- Html { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, markup: DynamicString, height?: DynamicNumber, title?: DynamicString }
- Timeline { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, items: string|{ label: DynamicString, time?: DynamicValue, description?: DynamicString }[]|DataBinding|FunctionCall, active?: string,number|DataBinding|FunctionCall }
- KeyValue { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, items: { label: DynamicString, value: DynamicValue }[]|DataBinding|FunctionCall, columns?: DynamicNumber }
- TextList { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, items: DynamicString[]|DataBinding|FunctionCall, ordered?: DynamicBoolean }
- Table { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, rows: object[]|DataBinding|FunctionCall, columns?: { key: string, label?: DynamicString, align?: "start"|"center"|"end", format?: "number"|"integer"|"currency"|"percent"|"compact"|"text", currency?: DynamicString, digits?: DynamicNumber }[], sortable?: DynamicBoolean, pageSize?: DynamicNumber, emptyText?: DynamicString, caption?: DynamicString }
- Chart { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, kind: "line"|"area"|"bar"|"pie"|"donut"|"scatter", data: object[]|DataBinding|FunctionCall, x?: string, y?: string, series?: string|{ key: string, label?: DynamicString }[], title?: DynamicString, stacked?: DynamicBoolean, horizontal?: DynamicBoolean, height?: DynamicNumber, format?: "number"|"integer"|"currency"|"percent"|"compact"|"text", currency?: DynamicString, xLabel?: DynamicString, yLabel?: DynamicString, caption?: DynamicString }
- Select { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicString, options: { value: string, label: DynamicString }[] }
- MultiSelect { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicStringList, options: { value: string, label: DynamicString }[] }
- Segmented { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicString, options: { value: string, label: DynamicString }[] }
- Radio { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicString, options: { value: string, label: DynamicString }[] }
- Toggle { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicBoolean }
- Stepper { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicNumber, min?: DynamicNumber, max?: DynamicNumber, step?: DynamicNumber, unit?: DynamicString }
- Checklist { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, label?: DynamicString, description?: DynamicString, checks?: CheckRule[], value: DynamicStringList, items: string|{ label: DynamicString, time?: DynamicValue, description?: DynamicString }[] }
- Form { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number, children: ChildList, action: Action, submit: DynamicString, checks?: CheckRule[] }
  Functions:
- evaluate { expression: string, values: DynamicValue }: any
- setValue { path: string, value: DynamicValue }: void (user action only)
- copyText { text: DynamicString }: void (user action only)
  Wingman evaluate(expression, values) helpers: abs, round, floor, ceil, trunc, sqrt, pow, log, exp, min, max, clamp, sum, avg, number, isFinite, random, histogram, len, count, range, map, filter, find, some, every, pluck, sortBy, reverse, slice, first, last, includes, indexOf, join, keys, values, get, upper, lower, trim, concat, split, replace, startsWith, endsWith, str, if, coalesce, isEmpty, format, currency, percent, compact, fixed. Variables come only from the values argument; bind dependencies explicitly using @path.

<!-- A2UI-CATALOG:END -->
