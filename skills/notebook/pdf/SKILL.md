---
name: pdf
description: Work with PDF files — create new PDFs, merge/split/rotate, extract text or tables, add watermarks, fill simple forms. Trigger whenever a .pdf is an input or output. For polished multi-page documents prefer building in docx/pptx first; use this for PDF-native operations and direct PDF generation.
---

# PDF — create, combine, and extract (Python runtime)

Use **`reportlab`** to create PDFs, **`pypdf`** to merge/split/rotate/encrypt, and **`pdfplumber`**
to extract text/tables. (JS libraries and CLI tools don't run here — these Python libraries cover the
same operations.) Save to the workspace; the drawer renders PDFs.

## Create a PDF (reportlab)

```python
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors

styles = getSampleStyleSheet()
doc = SimpleDocTemplate("report.pdf", pagesize=LETTER,
                        leftMargin=0.9*inch, rightMargin=0.9*inch)
story = [
    Paragraph("FY24 Revenue Review", styles["Title"]),
    Spacer(1, 12),
    Paragraph("Enterprise ACV grew 38% while mid-market stalled. …", styles["BodyText"]),
    Spacer(1, 12),
    Table([["Segment", "ACV", "YoY"], ["Enterprise", "$128M", "+38%"], ["Mid-market", "$54M", "+2%"]],
          style=TableStyle([
              ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#334155")),
              ("TEXTCOLOR", (0,0), (-1,0), colors.white),
              ("GRID", (0,0), (-1,-1), 0.5, colors.grey),
              ("ALIGN", (1,1), (-1,-1), "RIGHT"),
          ])),
]
doc.build(story)
print("wrote report.pdf")
```
For a richly designed one-pager, you can instead build HTML and render it, or place a `matplotlib`/
`render()` image with `canvas.drawImage`.

## Manipulate (pypdf)

```python
from pypdf import PdfReader, PdfWriter

# Merge
w = PdfWriter()
for f in ["a.pdf", "b.pdf"]:
    for page in PdfReader(f).pages:
        w.add_page(page)
with open("merged.pdf", "wb") as out:
    w.write(out)

# Rotate page 0 by 90°, split, etc. via PdfReader/PdfWriter page ops.
```

## Extract (pdfplumber / pypdf)

```python
import pdfplumber
with pdfplumber.open("in.pdf") as pdf:
    text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    tables = pdf.pages[0].extract_tables()
```

## Deliver
Save as `<slug>.pdf`; one-line hand-off. To revise, edit and re-run.
