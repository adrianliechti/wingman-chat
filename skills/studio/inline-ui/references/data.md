# Charts, tables and data display

All components here belong to the Wingman catalog. Use [protocol.md](protocol.md) for bindings and catalog selection; see [functions.md](functions.md) for filtering and derived values.

## Data shape

Properties remain component-specific within Wingman: Grid/KeyValue `columns` is a number, while Table `columns` is an array of definitions. Chart `kind` is a chart type; Link `kind` is `link` or `chip`. `format`, `currency` and `digits` belong only to components or column definitions that declare them; Basic Text uses formatting functions in its `text` value.

Chart `data` and Table `rows` are arrays of objects, or bindings/functions resolving to them. Use consistent keys and numeric values for measures:

```json
[
  { "quarter": "Q1", "revenue": 120, "cost": 80 },
  { "quarter": "Q2", "revenue": 145, "cost": 95 }
]
```

For Chart, set `x:"quarter"` and either `y:"revenue"` or `series:[{"key":"revenue","label":"Revenue"},{"key":"cost","label":"Cost"}]`. Keys select data; labels are display text. Use a line for trends, bars for comparisons, scatter for relationships and pie/donut for a few nonnegative shares. Pie/donut use the first measure. Area comparisons overlap unless `stacked:true`; `horizontal` applies to bars. Label axes/units with xLabel/yLabel and identify the source in caption or surrounding prose.

For Table, declare columns such as `[{"key":"quarter","label":"Quarter"},{"key":"revenue","label":"Revenue","format":"currency","currency":"EUR"}]`. Each column key must match row data. Tables infer columns when omitted; `sortable` defaults to true. `pageSize` controls visible rows. Prefer focused datasets; large analyses belong in artifacts.

`format:"percent"` formats fractions, so 0.25 is 25%. Currency formatting needs a currency code. Metric is a single value, Progress a value against a maximum, Timeline a sequence, and KeyValue a compact fact list. Basic Row/Column and Wingman Grid compose these without prescribing a dashboard layout.

For a working dashboard with a period switch, load [examples/dashboard.json](examples/dashboard.json) only when needed.

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Generated signatures; `?` means optional.

### Wingman catalog

`catalogId: "urn:wingman:inline-ui:catalog:1"`

Every component also accepts { visible?: DynamicBoolean, disabled?: DynamicBoolean, weight?: number }.

- Metric { label: DynamicString, value: DynamicValue, format?: "number"|"integer"|"currency"|"percent"|"compact"|"text", currency?: DynamicString, digits?: DynamicNumber, unit?: DynamicString, delta?: DynamicNumber, deltaLabel?: DynamicString, description?: DynamicString }
- Progress { value: DynamicNumber, max?: DynamicNumber, label?: DynamicString, format?: "number"|"integer"|"currency"|"percent"|"compact"|"text" }
- Timeline { items: (string|{ label: DynamicString, time?: DynamicValue, description?: DynamicString })[]|DataBinding|FunctionCall, active?: string|number|DataBinding|FunctionCall }
- KeyValue { items: { label: DynamicString, value: DynamicValue }[]|DataBinding|FunctionCall, columns?: DynamicNumber }
- Table { rows: object[]|DataBinding|FunctionCall, columns?: ({ key: string, label?: DynamicString, align?: "start"|"center"|"end", format?: "number"|"integer"|"currency"|"percent"|"compact"|"text", currency?: DynamicString, digits?: DynamicNumber })[], sortable?: DynamicBoolean, pageSize?: DynamicNumber, emptyText?: DynamicString, caption?: DynamicString }
- Chart { kind: "line"|"area"|"bar"|"pie"|"donut"|"scatter", data: object[]|DataBinding|FunctionCall, x?: string, y?: string, series?: (string|{ key: string, label?: DynamicString })[], title?: DynamicString, stacked?: DynamicBoolean, horizontal?: DynamicBoolean, height?: DynamicNumber, format?: "number"|"integer"|"currency"|"percent"|"compact"|"text", currency?: DynamicString, xLabel?: DynamicString, yLabel?: DynamicString, caption?: DynamicString }

<!-- A2UI-CATALOG:END -->
