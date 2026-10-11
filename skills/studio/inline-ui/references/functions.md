# Calculations and formatting

Use [protocol.md](protocol.md) for dynamic values and catalog inheritance. Basic formatting functions use named arguments in `@call.args`. Wingman arithmetic/collection helpers are positional functions inside an `evaluate` expression; they are not independent A2UI calls.

## Reactive calculations

Bind every external input explicitly in `values`; calculated values are read-only:

```json
{
  "@call": "evaluate",
  "catalogId": "urn:wingman:inline-ui:catalog:1",
  "args": { "expression": "quantity * 12", "values": { "quantity": { "@path": "/quantity" } } }
}
```

Expressions support arithmetic, comparisons, boolean operators, `??`, ternaries, array literals and safe property/index reads. Use `number(value)` for numeric TextField strings. No globals, JavaScript functions, methods or assignments are available. Nest A2UI function calls to compose dependent calculations. Oversized or recursive expressions report an error under the shared work/depth limits.

Useful expression patterns:

- `round(total * 1.08, 2)`, `clamp(value, 0, 100)`.
- `sum(pluck(rows, 'revenue'))`, `avg(pluck(rows, 'revenue'))`.
- `filter(rows, 'price <= budget')`; bind both rows and budget in values.
- `map(rows, 'item.price * item.quantity')`; each nested expression sees item, index, row properties and outer values.
- `sortBy(rows, 'revenue', 'desc')`, `slice(rows, 0, 10)`.
- `range(10)` or `range(0, 10, 2)`; the end is exclusive.
- `histogram(values, 10)` returns `{bin, count}` rows.
- `currency(total, 'EUR', 2)`, `percent(fraction, 1)`, `format(total, 'compact')`.

`random()` re-rolls whenever evaluated; use it in a local button action when a new sample is desired. `setValue`, `copyText` and `openUrl` are action functions documented in [protocol.md](protocol.md), and validators are in [controls.md](controls.md).

## Text and boolean functions

`formatString` interpolates JSON Pointers and named function expressions in `${...}`; e.g. `{"@call":"formatString","args":{"value":"Hello ${/name}"}}`. A plain string stays literal. Basic `and`, `or`, `not` also interpret validation results through their valid field. Function signatures follow; `Dynamic*` means a literal, binding or function call of the appropriate type.

<!-- A2UI-CATALOG:START -->

A2UI v1.0; SDK 0.13.0. Generated signatures; `?` means optional.

### Basic catalog

`catalogId: "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json"`

Functions:

- @index { offset?: number }: number
- formatString { value: DynamicString }: string
- formatNumber { value: DynamicNumber, decimals?: DynamicNumber, grouping?: DynamicBoolean }: string
- formatCurrency { value: DynamicNumber, currency: DynamicString, decimals?: DynamicNumber, grouping?: DynamicBoolean }: string
- formatDate { value: DynamicValue, format: DynamicString }: string
- pluralize { value: DynamicNumber, zero?: DynamicString, one?: DynamicString, two?: DynamicString, few?: DynamicString, many?: DynamicString, other: DynamicString }: string
- and { values: DynamicBoolean[] }: boolean
- or { values: DynamicBoolean[] }: boolean
- not { value: DynamicBoolean }: boolean

### Wingman catalog

`catalogId: "urn:wingman:inline-ui:catalog:1"`

Functions:

- evaluate { expression: string, values: DynamicValue }: any

Expression helpers: abs, round, floor, ceil, trunc, sqrt, pow, log, exp, min, max, clamp, sum, avg, number, isFinite, random, histogram, len, count, range, map, filter, find, some, every, pluck, sortBy, reverse, slice, first, last, includes, indexOf, join, keys, values, get, upper, lower, trim, concat, split, replace, startsWith, endsWith, str, if, coalesce, isEmpty, format, currency, percent, compact, fixed.
<!-- A2UI-CATALOG:END -->
