---
name: xlsx
description: Create or edit spreadsheets (.xlsx) — data tables, financial models, budgets, trackers, cleaned/restructured tabular data. Trigger when a spreadsheet is the primary output, the user references an .xlsx/.csv by name, or asks for a model/budget/table as Excel. Not when the deliverable is a Word doc, PDF, or report.
---

# XLSX — spreadsheets (Python runtime)

Build `.xlsx` files with **`openpyxl`** (formatting + formulas) and **`pandas`** (data wrangling) in
the interpreter. Save to the workspace; it renders in the side panel. (No LibreOffice to recalc —
Excel recalculates formulas when the file is opened.)

## Requirements for every workbook

- **Professional font** (e.g. Calibri, Arial) consistently across the file.
- **Zero formula errors** — no `#REF!`, `#DIV/0!`, `#VALUE!`, `#N/A`, `#NAME?`. Verify ranges and
  references.
- **Use formulas, not hardcoded values.** Let Excel compute, so the model stays live:
  - ✅ `ws["B10"] = "=SUM(B2:B9)"`  ·  ✅ `ws["C5"] = "=(C4-C2)/C2"`
  - ❌ computing the total in Python and writing the number.
- **Assumptions in their own cells**, referenced by formulas: `=B5*(1+$B$6)`, not `=B5*1.05`.
- When editing an existing file, **match its conventions exactly** — don't impose new formatting.

## Financial-model conventions (when modelling)

Color-code cell **text** so reviewers can read the model:
- **Blue** `(0,0,255)` — hardcoded inputs / assumptions a user changes.
- **Black** `(0,0,0)` — formulas and calculations.
- **Green** `(0,128,0)` — links to other sheets in the same workbook.
- **Red** `(255,0,0)` — links to external files.
- **Yellow fill** `(255,255,0)` — key assumptions needing attention.

Number formats:
- Years as text ("2024", not "2,024"); currency `$#,##0` with units in the header ("Revenue ($mm)").
- Zeros shown as "-": `"$#,##0;($#,##0);-"`. Percentages `0.0%`. Multiples `0.0x`. Negatives in
  parentheses `(123)`.
- Document hardcodes in an adjacent cell: `Source: [System], [Date], [Reference]`.

## Build it

```python
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

wb = Workbook(); ws = wb.active; ws.title = "Model"
BLUE = Font(name="Calibri", color="0000FF")
BLACK = Font(name="Calibri", color="000000")

ws["A1"] = "Revenue ($mm)"; ws["A1"].font = Font(bold=True)
ws["A2"], ws["B2"] = "Base", 100; ws["B2"].font = BLUE                 # input
ws["A3"], ws["B3"] = "Growth", 0.12; ws["B3"].font = BLUE; ws["B3"].number_format = "0.0%"
ws["A4"], ws["B4"] = "Year 2", "=B2*(1+B3)"; ws["B4"].font = BLACK     # formula
for cell in ("B2", "B4"):
    ws[cell].number_format = "$#,##0;($#,##0);-"
ws.column_dimensions["A"].width = 18
ws.freeze_panes = "A2"

wb.save("model.xlsx")
print("wrote model.xlsx")
```

- **Multiple sheets**: `wb.create_sheet("Assumptions")`. **Charts**: openpyxl `BarChart`/`LineChart`
  from cell ranges, or embed a `matplotlib` image. **From a DataFrame**: `df.to_excel("out.xlsx",
  index=False)` then reopen with openpyxl to format.
- **Sensitivity tables**: use an **odd grid** (5×5, 7×7) so the base case sits dead-center; highlight
  that center cell yellow.
- **Editing an existing file**: `load_workbook("model.xlsx")`, change what's needed, re-save; write
  cells without re-applying formats to preserve the existing look.

## Before you finish
Check: zero formula errors (`#REF! / #DIV/0! / #VALUE! / #N/A / #NAME?`); ranges still correct after
any row/column inserts; every assumption is a labeled cell (never a magic number buried in a formula)
with a `Source:` note; charts point at the right ranges.

## Deliver
Save as `<slug>.xlsx`; one-line hand-off. To revise, open the saved file and modify it.
