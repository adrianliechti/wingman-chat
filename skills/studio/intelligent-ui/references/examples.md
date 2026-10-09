# Intelligent UI examples

## What-if calculator

A user asks what a mortgage costs. Prose states the answer for their numbers; the interface lets them move the inputs.

````markdown
At 6.5 % over 30 years, CHF 250,000 costs about CHF 1,580 per month. Adjust the terms below.

```ui
{
  "title": "Mortgage payment",
  "state": { "principal": 250000, "rate": 6.5, "years": 30 },
  "computed": {
    "monthlyRate": "rate / 1200",
    "months": "years * 12",
    "payment": "monthlyRate == 0 ? principal / months : principal * monthlyRate / (1 - (1 + monthlyRate) ^ -months)",
    "totalInterest": "payment * months - principal"
  },
  "children": [
    {
      "type": "card",
      "children": [
        { "type": "row", "children": [
          { "type": "slider", "bind": "principal", "label": "Loan amount", "min": 50000, "max": 1500000, "step": 10000, "format": "currency", "currency": "CHF" },
          { "type": "slider", "bind": "rate", "label": "Interest rate", "min": 0.5, "max": 12, "step": 0.1, "unit": "%" },
          { "type": "slider", "bind": "years", "label": "Term", "min": 5, "max": 40, "unit": "years" }
        ] },
        { "type": "grid", "columns": 2, "children": [
          { "type": "metric", "label": "Monthly payment", "value": "{{ payment }}", "format": "currency", "currency": "CHF", "digits": 0 },
          { "type": "metric", "label": "Total interest", "value": "{{ totalInterest }}", "format": "currency", "currency": "CHF", "digits": 0 }
        ] },
        { "type": "row", "justify": "end", "children": [
          { "type": "button", "label": "Reset", "variant": "ghost", "action": "reset" },
          { "type": "button", "label": "Compare with 15 years", "variant": "primary",
            "action": { "send": "Compare a {{ years }}-year term with a 15-year term for CHF {{ principal }} at {{ rate }} %." } }
        ] }
      ]
    }
  ]
}
```
````

## Filtered table with a chart

Numbers came from a tool result earlier in the turn; the interface lets the user narrow them.

```ui
{
  "state": {
    "region": "all",
    "rows": [
      { "region": "EU", "quarter": "Q1", "revenue": 120, "margin": 31 },
      { "region": "EU", "quarter": "Q2", "revenue": 132, "margin": 33 },
      { "region": "US", "quarter": "Q1", "revenue": 98, "margin": 27 },
      { "region": "US", "quarter": "Q2", "revenue": 115, "margin": 29 }
    ]
  },
  "computed": {
    "filtered": "region == 'all' ? rows : filter(rows, 'item.region == region')",
    "total": "sum(pluck(filtered, 'revenue'))"
  },
  "children": [
    { "type": "row", "align": "end", "children": [
      { "type": "select", "bind": "region", "label": "Region", "options": [
        { "value": "all", "label": "All regions" }, "EU", "US"
      ] },
      { "type": "metric", "label": "Revenue (kCHF)", "value": "{{ total }}", "format": "integer" }
    ] },
    { "type": "chart", "kind": "bar", "data": "{{ filtered }}", "x": "quarter", "series": ["revenue"], "title": "Revenue by quarter" },
    { "type": "table", "rows": "{{ filtered }}", "columns": [
      { "key": "region", "label": "Region" },
      { "key": "quarter", "label": "Quarter" },
      { "key": "revenue", "label": "Revenue", "format": "integer" },
      { "key": "margin", "label": "Margin", "format": "percent", "digits": 0 }
    ] }
  ]
}
```

## Choosing between options

Instead of a form, offer the choices as buttons that continue the conversation with the selection.

```ui
{
  "state": { "guests": 8, "vegetarian": false },
  "children": [
    { "type": "row", "children": [
      { "type": "slider", "bind": "guests", "label": "Guests", "min": 2, "max": 20 },
      { "type": "toggle", "bind": "vegetarian", "label": "Vegetarian only" }
    ] },
    { "type": "row", "children": [
      { "type": "button", "label": "Quick weeknight", "action": { "send": "Plan a quick weeknight menu for {{ guests }} guests{{ vegetarian ? ', vegetarian' : '' }}." } },
      { "type": "button", "label": "Three courses", "action": { "send": "Plan a three-course dinner for {{ guests }} guests{{ vegetarian ? ', vegetarian' : '' }}." } }
    ] }
  ]
}
```

## Explorable diagram

"Show me the parts of a 7-speed bike." A drawing whose parts separate with a slider and highlight by system, with a description that follows the selection.

```ui
{
  "title": "7-speed bicycle",
  "state": {
    "explode": 0,
    "system": "all",
    "notes": {
      "all": "Five connected systems. Select one to explore its role.",
      "frame": "The frame carries the rider and joins every other system.",
      "wheels": "Wheels turn drivetrain effort into motion and carry the load.",
      "drivetrain": "Pedals, chain and a 7-speed cassette set how hard each stroke works."
    }
  },
  "computed": {
    "d": "explode * 60",
    "frameOn": "system == 'all' || system == 'frame' ? 1 : 0.2",
    "wheelsOn": "system == 'all' || system == 'wheels' ? 1 : 0.2",
    "driveOn": "system == 'all' || system == 'drivetrain' ? 1 : 0.2"
  },
  "children": [
    { "type": "svg", "label": "Bicycle", "markup": "<svg viewBox='0 0 400 220' fill='none' stroke='currentColor' stroke-width='4' stroke-linecap='round'><g opacity='{{ wheelsOn }}' transform='translate(-{{ d }} 0)'><circle cx='80' cy='160' r='46'/></g><g opacity='{{ wheelsOn }}' transform='translate({{ d }} 0)'><circle cx='320' cy='160' r='46'/></g><g opacity='{{ frameOn }}' transform='translate(0 -{{ d }})'><path d='M80 160 L150 70 L260 70 L320 160 L200 160 L150 70 M200 160 L260 70 L240 40'/></g><g opacity='{{ driveOn }}' transform='translate(0 {{ d }})'><circle cx='200' cy='160' r='22'/><path d='M200 138 L200 182 M178 160 L222 160'/></g></svg>" },
    { "type": "slider", "bind": "explode", "label": "Explode", "min": 0, "max": 1, "step": 0.05 },
    { "type": "segmented", "bind": "system", "options": [
      { "value": "all", "label": "All" }, { "value": "frame", "label": "Frame" },
      { "value": "wheels", "label": "Wheels" }, { "value": "drivetrain", "label": "Drivetrain" }
    ] },
    { "type": "text", "text": "{{ notes[system] }}" }
  ]
}
```

## Experiment with a button

"Explain the central limit theorem." Prose explains; the interface lets the user draw samples and watch the histogram of sample means tighten.

```ui
{
  "state": { "n": 10, "means": [] },
  "computed": {
    "bins": "histogram(means, 12, 0, 6)",
    "spread": "len(means) > 1 ? round(sqrt(avg(map(means, '(item - avg(means)) ^ 2'))), 3) : 0"
  },
  "children": [
    { "type": "row", "align": "end", "children": [
      { "type": "slider", "bind": "n", "label": "Dice per sample", "min": 1, "max": 50 },
      { "type": "button", "label": "Draw 100 samples", "variant": "primary",
        "action": { "set": { "means": "{{ means + map(range(100), 'avg(map(range(n), \"floor(random(1, 7))\"))') }}" } } },
      { "type": "button", "label": "Clear", "variant": "ghost", "action": { "reset": ["means"] } }
    ] },
    { "type": "chart", "kind": "bar", "data": "{{ bins }}", "x": "bin", "series": ["count"], "title": "Sample means" },
    { "type": "text", "tone": "muted", "text": "{{ len(means) }} samples · standard deviation of the means {{ spread }}" }
  ]
}
```

## A plan that scales

"Plan a Sunday roast, guest count still open." Prose carries the menu and method; the interface scales quantities, copies the list, and tracks the day.

```ui
{
  "state": { "guests": 6, "done": [] },
  "computed": {
    "lamb": "round(guests * 0.4, 1)",
    "potatoes": "guests * 250",
    "carrots": "ceil(guests * 1.5)",
    "list": "'Lamb ' + lamb + ' kg\\nPotatoes ' + potatoes + ' g\\nCarrots ' + carrots"
  },
  "children": [
    { "type": "keyvalue", "columns": 2, "items": [
      { "label": "Style", "value": "Cozy, family-style" }, { "label": "Cooking", "value": "About 3 hours" },
      { "label": "Prep", "value": "Mostly the day before" }, { "label": "Serves", "value": "{{ guests }}" }
    ] },
    { "type": "row", "align": "end", "children": [
      { "type": "stepper", "bind": "guests", "label": "Guests", "min": 2, "max": 16 },
      { "type": "button", "label": "Copy shopping list", "action": { "copy": "{{ list }}" } }
    ] },
    { "type": "keyvalue", "columns": 3, "items": [
      { "label": "Lamb", "value": "{{ lamb }} kg" }, { "label": "Potatoes", "value": "{{ potatoes }} g" }, { "label": "Carrots", "value": "{{ carrots }}" }
    ] },
    { "type": "checklist", "bind": "done", "label": "Sunday", "items": [
      { "label": "Lamb out of the fridge", "time": "12:30" },
      { "label": "Lamb in the oven", "time": "13:30", "description": "Use a thermometer, not the clock." },
      { "label": "Parboil potatoes", "time": "14:30" },
      { "label": "Rest the lamb, roast potatoes", "time": "15:45" },
      { "label": "Carve and serve", "time": "17:00" }
    ] }
  ]
}
```

## Step-by-step walkthrough

Work through a problem one step at a time with Back and Next; `visible` shows the current step.

```ui
{
  "state": { "step": 1 },
  "computed": { "last": "3" },
  "children": [
    { "type": "progress", "label": "Step {{ step }} of {{ last }}", "value": "{{ step }}", "max": "{{ last }}" },
    { "type": "card", "visible": "step == 1", "title": "1. Set up", "children": [{ "type": "text", "text": "Write the equation as ax² + bx + c = 0 and note a, b and c." }] },
    { "type": "card", "visible": "step == 2", "title": "2. Discriminant", "children": [{ "type": "text", "text": "Compute b² − 4ac. Its sign tells you how many real roots exist." }] },
    { "type": "card", "visible": "step == 3", "title": "3. Solve", "children": [{ "type": "text", "text": "x = (−b ± √(b² − 4ac)) / 2a." }] },
    { "type": "row", "justify": "between", "children": [
      { "type": "button", "label": "Back", "variant": "ghost", "disabled": "step <= 1", "action": { "set": { "step": "{{ step - 1 }}" } } },
      { "type": "button", "label": "Next", "variant": "primary", "disabled": "step >= last", "action": { "set": { "step": "{{ step + 1 }}" } } }
    ] }
  ]
}
```

## Patterns to avoid

- A `text` component holding the whole answer: write prose outside the fence instead.
- Buttons without `action`, or `send` messages that do not include the values the user changed.
- Large data pasted into `state` (hundreds of rows): save a file and build an artifact.
- Several unrelated charts side by side: one chart answers one question.
- Fabricated "live" figures: show only what the conversation or a tool produced, and say when a number is an estimate.
