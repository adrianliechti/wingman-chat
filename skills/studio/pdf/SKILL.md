---
name: pdf
description: Work with PDF files — create new PDFs, merge/split/rotate, extract text or tables, add watermarks, fill simple forms. Trigger whenever a .pdf is an input or output. For polished multi-page documents prefer building in docx/pptx first; use this for PDF-native operations and direct PDF generation.
---

# PDF — create, combine, and extract (Python runtime)

Use **`reportlab`** to create PDFs, **`pypdf`** to merge/split/rotate/encrypt, and **`pdfplumber`**
to extract text/tables. Save to the workspace; the drawer renders PDFs.

## Bundled helpers

When filling PDF forms, use the listed helper scripts instead of rewriting the same fragile code:

- `scripts/check_fillable_fields.py` — detect whether a PDF has AcroForm fields.
- `scripts/extract_form_field_info.py` — inspect fillable fields and valid checkbox/radio values.
- `scripts/fill_fillable_fields.py` — validate and fill AcroForm fields.
- `scripts/extract_form_structure.py` — extract labels, lines, and checkboxes from non-fillable PDFs.
- `scripts/check_bounding_boxes.py` — validate annotation bounding boxes before filling.
- `scripts/fill_pdf_form_with_annotations.py` — add text annotations to non-fillable forms.
- `scripts/create_validation_image.py` — draw field boxes over a page image for visual checking.

Load the needed script with `read_skill_resource` before using or adapting it.

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
