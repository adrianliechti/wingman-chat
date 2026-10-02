---
name: xlsx
description: "Create or edit Excel workbooks, spreadsheet models, budgets, trackers or cleaned tabular deliverables. Use when the output is a spreadsheet; reading a CSV for analysis alone does not require this skill."
---

# Excel workbooks

Use `openpyxl` for workbook edits, formatting and formulas; use pandas for tabular transformations. Inspect sheet names, headers, data types, formulas and styles before editing. Load existing workbooks with formulas preserved; do not save a `data_only=True` copy over the source. Match existing conventions and flag unsupported features that may be lost.

For a model or reusable tracker, keep derived values as formulas and assumptions in labelled input cells. For a requested static data export, values are appropriate. Distinguish source facts from assumptions and document consequential sources/units. Set useful number formats, widths, frozen panes and filters.

```python
from openpyxl import Workbook
wb = Workbook()
ws = wb.active
ws.title = "Model"
ws.append(["Base", 100])
ws.append(["Growth assumption", 0.05])
ws.append(["Projected", "=B1*(1+B2)"])
ws["B2"].number_format = "0.0%"
wb.save("model.xlsx")
```

Use a structured Table only when table semantics are useful. Its range must start at the real header row and include data. Headers must be unique, nonempty strings; exclude merged cells and overlapping tables. Do not overlay a worksheet auto-filter on it. Use a workbook-unique, non-cell-like displayName. Treat save warnings about headings/readability as a failed build.

Conditional-format formulas use no leading equals sign: `FormulaRule(formula=["A1>3"])`. Do not overlap merged ranges. After row/column changes, verify formula references, chart sources and table/filter ranges; do not assume dependent references were repaired.

Follow the user's number/date formats, currency and units; do not infer them from the domain. Preserve identifiers and leading zeros as text. Store percentages as fractions (0.15 for 15%). Distinguish editable inputs, formulas and links through labels or documented formatting without prescribing colors.

Write merged cells only at the top-left anchor. Preserve macros with `keep_vba=True` when editing .xlsm and keep the extension. Quote sheet names with spaces in formulas, e.g. `='Input Data'!B2`. Inspect formulas and cached values in separate loads when both matter; cached values may be stale, and saving with openpyxl clears formula caches even for unchanged formulas. Preserve external links and disclose unavailable dependencies.

No spreadsheet recalculation engine is available here. Inspect formula strings for invalid references/error literals, independently check critical calculations where possible, and reopen the saved workbook. Missing cached results do not establish a bad formula; successful saving does not establish correct calculation. State that formulas recalculate in the spreadsheet application and avoid claiming their computed results were verified here.
