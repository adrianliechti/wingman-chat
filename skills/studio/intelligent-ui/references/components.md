# Intelligent UI reference

Everything below is the complete set: the app validates documents against this registry and ignores or flags anything else.

## Document

```json
{
  "title": "Optional heading shown above the interface",
  "state": { "key": 10, "flag": true, "rows": [] },
  "computed": { "derived": "key * 2" },
  "children": [{ "type": "...", "props": {} }]
}
```

- `state`: initial values, plain JSON, keys are identifiers. Every `bind` target belongs here.
- `computed`: strings evaluated against `state` and each other (order does not matter unless they form a cycle). A bare expression (`"price * qty"`) yields its value; a template (`"{{ qty }} items"`) yields text. Available in templates like state.
- `children`: the component tree. A bare array or a bare component is also accepted.

## Components

Every component is `{"type", "props", "bind", "visible", "children"}`. Props may be written flat on the component instead of under `props`. `visible` is a boolean or expression string; a hidden component is removed from layout. Type names are case-insensitive and a few aliases are accepted (`stack`→`column`, `kpi`→`metric`, `checkbox`/`switch`→`toggle`, `dropdown`→`select`, `multi_select`/`checkboxes`→`multiselect`, `number`→`input` with `kind: "number"`, `date`→`input` with `kind: "date"`, `caption`→`text` with `tone: "muted"`, `tag`/`status`→`badge`, `repeat`/`foreach`→`each`).

The fence body must be strict JSON. The renderer forgives comments, trailing commas, single quotes and `"a" + "b"` string joins, but nothing else; put every piece of logic inside `{{ }}`.

### Layout

| Type      | Props                                                                                                                                                                          | Children |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `column`  | `gap`: none/sm/md/lg; `align`: start/center/end/stretch                                                                                                                        | yes      |
| `row`     | `gap`; `wrap` (default true); `align`; `justify`: start/center/end/between                                                                                                     | yes      |
| `grid`    | `columns`: 1–6 or `"auto"`; `gap`                                                                                                                                              | yes      |
| `card`    | `title`; `description`                                                                                                                                                         | yes      |
| `tabs`    | `items`: `[{ "label", "children": [...] }]`                                                                                                                                    | per item |
| `divider` | none                                                                                                                                                                           | no       |
| `form`    | `title`; `description`; `submit` (button label); `message` (sent on submit, with every bound value attached); `required`: state keys that must be filled; `action` to override | yes      |
| `each`    | `items`: array or template; `as`: name for the current item (default `item`)                                                                                                   | per item |

`row` children share the width evenly and wrap on narrow screens. `grid` collapses to one column on phones.

**`each`**: repeats its children once per item of `items` (at most 200). Inside, templates see `item` (or the `as` name), `index` and everything in the document scope, so `{ "type": "each", "items": "{{ filter(plans, 'price <= budget') }}", "as": "plan", "children": [{ "type": "button", "label": "{{ plan.name }}", "action": { "send": "Tell me about {{ plan.name }}" } }] }` renders one working button per matching plan. Controls inside an `each` share the one key they `bind`, so put per-item input in `checklist`, `multiselect` or buttons rather than sliders.

### Content

| Type       | Props                                                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `heading`  | `text`; `level`: 1–4                                                                                                                                                                                       |
| `text`     | `text` (Markdown allowed); `tone`: default/muted/accent; `size`: sm/md/lg; `align`                                                                                                                         |
| `metric`   | `label`; `value`; `format`; `currency`; `digits`; `unit`; `delta` (number or text); `deltaLabel`; `description`                                                                                            |
| `callout`  | `tone`: info/success/warning/error; `title`; `text` (Markdown allowed)                                                                                                                                     |
| `badge`    | `text`; `tone`: neutral/info/success/warning/error. One salient status (a verdict, a tier), not decoration                                                                                                 |
| `code`     | `text`; `language`. A snippet, formula or configuration; with templates it follows state (`"x = {{ x }}"`)                                                                                                 |
| `progress` | `label`; `value`; `max` (default 100); `format`                                                                                                                                                            |
| `list`     | `items`: strings or `{ "label", "value" }`; `ordered`                                                                                                                                                      |
| `image`    | `src` (http(s) or data URL); `alt`; `caption`                                                                                                                                                              |
| `svg`      | `markup`: inline `<svg>` whose attribute values may contain `{{ }}`; `height` (max px); `label`                                                                                                            |
| `icon`     | `name`: any of the ~2,100 Lucide icon names in kebab-case (`chef-hat`, `map-pin`, `calendar-1`); an unknown name shows a help circle; `size`: sm/md/lg; `tone`; `label` for meaning (otherwise decorative) |
| `link`     | `text`; `href` (http(s) or mailto); `description`; `kind`: link or `chip` for a compact source reference                                                                                                   |
| `html`     | `markup`: a complete self-contained HTML page; `height` (120–800); `title`. Runs sandboxed in an iframe, cannot read or write state; for a small game or widget the components cannot express              |
| `timeline` | `items`: strings or `{ "label", "time", "description" }`; `active`: index or label of the current step                                                                                                     |
| `keyvalue` | `items`: `[{ "label", "value" }]`; `columns`: 1–3. A compact summary block (style, prep time, serving)                                                                                                     |

**`svg`**: a drawing that explores state. Write ordinary inline SVG with a `viewBox`; put templates in attribute values, for example `transform="translate({{ explode * 40 }} 0)"` or `opacity="{{ part == 'all' || part == 'frame' ? 1 : 0.25 }}"`. Changes to `transform`, `opacity`, `fill`, `stroke` and `stroke-width` animate over 300 ms, so a slider or `segmented` control bound to the same keys produces an exploded view or a highlight tour. Group parts with `<g>` and keep the structure fixed; only values should change. SMIL (`<animateTransform>`) is allowed for looping motion. Scripts, `foreignObject`, `use`, `image` and links are removed. Use single quotes inside the markup so the JSON string stays simple.

`format` is one of `number` (default, up to two decimals), `integer`, `currency` (with `currency` code, default USD), `percent` (12.5 means 12.5 %), `compact` (1.5M), or `text`.

Enum props (`tone`, `format`, `kind`, `variant`, `gap`, …) accept a template that resolves to one of their values: `"tone": "{{ margin < 0 ? 'error' : 'success' }}"`.

### Data

**`table`**: `columns`: `[{ "key", "label", "align", "format", "currency", "digits" }]` (optional, inferred from the first rows); `rows`: array of objects (or arrays, keyed by index); `sortable` (default true); `pageSize` (default 15 when more than 25 rows); `emptyText`; `caption` (a source or "illustrative values" note under the table).

**`chart`**: `kind`: `line`, `area`, `bar`, `pie`, `donut`, `scatter`; `data`: array of objects, or a plain array of numbers (plotted against their index, e.g. `"{{ map(range(30), 'start * (1 + rate / 100) ^ item') }}"`); `x`: category key (default: first non-numeric column); `series`: keys or `[{ "key", "label" }]` (default: every numeric column); `y`: single series shorthand; `title`; `stacked`; `horizontal` (bar); `height` (120–600); `format`, `currency` for axis and tooltip values; `xLabel`, `yLabel`; `caption` (source or assumptions under the chart). At most eight series, 2,000 points. Pie and donut take one series and up to eight slices.

### Controls

Each control needs `bind`: the state key it reads and writes. All accept `label`, `description`, `disabled`.

| Type          | Props                                                                           | Value                   |
| ------------- | ------------------------------------------------------------------------------- | ----------------------- |
| `slider`      | `min` (0); `max` (100); `step` (1); `format`; `currency`; `digits`; `unit`      | number                  |
| `input`       | `kind`: text/number/multiline/date; `placeholder`; `min`, `max`, `step`         | string/number/ISO date  |
| `select`      | `options`: strings, numbers or `{ "value", "label" }`; `placeholder`            | option value            |
| `segmented`   | `options`; one choice shown as pill buttons (chips)                             | option value            |
| `multiselect` | `options`; `columns`: 1–4 checkbox columns                                      | array of option values  |
| `stepper`     | `min`; `max`; `step` (1); `unit`. A count with − and + buttons                  | number                  |
| `checklist`   | `items`: strings or `{ "label", "time", "description" }`; shows "done of total" | array of checked labels |
| `radio`       | `options`                                                                       | option value            |
| `toggle`      | none                                                                            | boolean                 |

**form**: groups controls and ends with one submit button. Submitting posts `message` as the user's next turn with every bound value appended as JSON, so the model reads the answers without templating each field. `required` keeps the button disabled until those keys hold a value. Prefer it to a bare `send` button when there are more than two inputs.

**html**: the escape hatch. The page gets no access to the document's state, the chat or the workspace, and templates are not resolved inside it. Use it only for something the registry cannot express, keep it under one screen, and write it as a full document with its own styles. For anything the user will keep, create an artifact instead.

### Button

`button`: `label`; `icon` (Lucide name shown before the label); `action` (one action or a list); `variant`: primary/secondary/ghost/danger; `disabled` (boolean or expression); `confirm` (question asked before running).

Actions:

| Action                                   | Effect                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `{ "set": { "key": value } }`            | Writes state. Values may be templates: `{ "set": { "count": "{{ count + 1 }}" } }`.                               |
| `"reset"` or `{ "reset": ["key"] }`      | Restores the initial state (or the listed keys).                                                                  |
| `{ "send": "message", "context": true }` | Posts the message as the user's next turn. Templates include values; `context` appends every state value as JSON. |
| `{ "copy": "text" }`                     | Copies text to the clipboard.                                                                                     |
| `{ "open": "https://…" }`                | Opens an http(s) link in a new tab.                                                                               |

A `send` button is how an interface asks for more: tools, data and workspace changes happen in the turn it triggers, never from the interface itself.

## Templates and expressions

Any string prop may contain `{{ expression }}`. Text around a placeholder is interpolated; a prop that is exactly one placeholder passes the raw value, so `"rows": "{{ filtered }}"` supplies an array and `"value": "{{ total }}"` a number.

Expressions read state and computed keys and support:

- Literals: numbers, `'strings'`, `true`, `false`, `null`, `[arrays]`.
- Arithmetic `+ - * / % ^` (`**` also works), comparison `== != < <= > >=`, logic `&& || !`, `??`, and `cond ? a : b`.
- Member and index access: `item.price`, `rows[0].name`, `rows.length`.
- Helpers:
  - Math: `abs`, `round(x, digits)`, `floor`, `ceil`, `trunc`, `sqrt`, `pow`, `log`, `exp`, `min`, `max`, `clamp(x, lo, hi)`, `sum(list)`, `avg(list)`, `number(x)`, `isFinite(x)`.
  - Simulation: `random()` / `random(hi)` / `random(lo, hi)` and `histogram(values, bins, lo, hi)` → `[{ "bin", "count" }]` for a bar chart. `random` re-rolls on every evaluation, so call it only inside a button's `set` action (`{ "set": { "samples": "{{ map(range(200), 'random(0, 6)') }}" } }`) and keep results in state.
  - Collections: `len` (alias `count`), `range(n)` / `range(start, end, step)`, `map(list, 'expr')`, `filter(list, 'expr')`, `find(list, 'expr')`, `some`, `every`, `pluck(list, 'key')`, `sortBy(list, 'key', 'desc')`, `reverse`, `slice`, `first`, `last`, `includes`, `indexOf`, `join(list, ', ')`, `keys`, `values`, `get(obj, 'a.b', fallback)`.
  - Strings: `upper`, `lower`, `trim`, `concat`, `split`, `replace`, `startsWith`, `endsWith`, `str`.
  - Logic: `if(cond, a, b)`, `coalesce(a, b)`, `isEmpty(x)`.
  - Formatting: `format(x, 'currency', digits, 'EUR')`, `currency(x, 'CHF')`, `percent(x, digits)`, `compact(x)`, `fixed(x, digits)`.

Inside `map`, `filter`, `find`, `some`, `every` and `sortBy`, the nested expression is a string that sees `item`, `index`, the item's own fields, and the document scope: `filter(rows, 'price > budget')`.

Division by zero yields 0; a missing key is `null`; a syntax error shows a small warning instead of the value. A template that reads a key missing from `state` and `computed` renders blank and the key is listed under the interface, so declare every key you read. Expressions that cannot run (bad syntax, an unknown function, a method call such as `x.toFixed(2)`) and undeclared keys are reported back to the model on the next turn.

## What does not exist, and what to do instead

| Wanted                        | Use instead                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| A map                         | A `list` or `table` of places with Markdown links in prose, or a `button` with `open`         |
| A form that submits somewhere | Controls bound to state plus a `button` whose `send` carries the values (`"context": true`)   |
| Live or fetched data          | Call a tool before the fence and put the result in `state`                                    |
| Saving, booking, creating     | A `send` button that asks the assistant to do it in the next turn; never a fake success state |
| Custom HTML, CSS or scripts   | An HTML artifact (`html-artifacts`)                                                           |
| Icons                         | A `badge`, or an emoji in text                                                                |
| Per-row sliders or inputs     | One control for the shared parameter, or a `checklist` / `multiselect` for per-item choices   |
