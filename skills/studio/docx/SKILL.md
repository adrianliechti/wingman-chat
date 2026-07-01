---
name: docx
description: Create or edit Word documents (.docx) — reports, memos, letters, proposals, templates with headings, tables, page numbers, and images. Trigger on "Word doc", ".docx", "write a report/memo/letter", or any request for a polished written document delivered as a Word file. Not for PDFs, spreadsheets, or slides.
---

# DOCX — Word documents (Python runtime)

Build `.docx` files with **`python-docx`** in the interpreter. Save the file to the workspace; it
renders in the side panel.

## Get the content first

Pull the real facts/figures/quotes from the conversation and workspace files before building. Lead
with the conclusion (executive summary), then support it. Short sections, one point each; tables for
anything comparative; cite figures. No filler.

## Create a document

```python
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

doc = Document()

# Base styles — set once, reuse everywhere.
normal = doc.styles["Normal"]
normal.font.name = "Calibri"          # or a theme font
normal.font.size = Pt(11)

doc.add_heading("FY24 Revenue Review", level=0)            # title
doc.add_paragraph("Enterprise ACV grew 38% while mid-market stalled. …")  # summary

doc.add_heading("What drove enterprise growth", level=1)
p = doc.add_paragraph()
p.add_run("Key point. ").bold = True
p.add_run("Supporting detail with a real figure (Source: Internal BI, Q3 2024).")

# Table
t = doc.add_table(rows=1, cols=3)
t.style = "Light Grid Accent 1"
h = t.rows[0].cells
h[0].text, h[1].text, h[2].text = "Segment", "ACV", "YoY"
for seg, acv, yoy in [("Enterprise", "$128M", "+38%"), ("Mid-market", "$54M", "+2%")]:
    c = t.add_row().cells
    c[0].text, c[1].text, c[2].text = seg, acv, yoy

doc.add_page_break()
doc.save("report.docx")
print("wrote report.docx")
```

Notes:

- **Headings**: `add_heading(text, level)` (0 = title, 1–4 = sections). Style headings via the
  built-in `Heading N` styles or set run fonts/colors for a custom look.
- **Images**: `doc.add_picture("chart.png", width=Inches(6))` — generate charts with `matplotlib`
  (`savefig`) or art with `await render(...)`.
- **Page numbers / headers / footers**: use `doc.sections[0].header` / `.footer` and field codes if
  needed; keep it simple unless asked.
- **Reading an existing .docx**: `Document("in.docx")` then iterate `doc.paragraphs` / `doc.tables`.
- **Styling for a theme**: read `theme-factory` and apply its fonts/hex colors
  via `font.name` and `RGBColor.from_string("RRGGBB")`.

## Conventions

- **Use named styles, not hand-rolled formatting.** `add_heading(text, level)` and the built-in
  `Heading N` / `Normal` styles cascade correctly; setting `font.bold`/`font.size` by hand on every
  paragraph drifts. When inserting into an existing doc, match its body font.
- **Footnotes**: use real Word footnotes, not `[1]` markers typed into the body text.
- **Legal documents** (contract, brief, memo, NDA) on a blank doc default to **Times New Roman**.
- **Long docs (3+ sections)**: state the section outline first, then build section by section.

## Deliver

Save with a slugged name (`report.docx`); tell the user it's ready in one line. To revise, open the
saved file and modify it.
