---
name: pdf
description: Create or manipulate a PDF deliverable — designed reports/one-pagers, merge/split/rotate, extraction to another file, watermarks, or form filling. Do not trigger merely because the user asks a question about an attached PDF.
---

# PDF — create, combine, and extract (Python runtime)

Use **`reportlab`** or the JavaScript executor's **`jsPDF`** to create PDFs, **`pypdf`** to
merge/split/rotate/encrypt, and **`pdfplumber`** to extract text/tables. Save to the workspace; the
drawer renders PDFs.

## Bundled helpers

When filling PDF forms, use the listed helper scripts instead of rewriting the same fragile code:

- `scripts/check_fillable_fields.py` — detect whether a PDF has AcroForm fields.
- `scripts/extract_form_field_info.py` — inspect fillable fields and valid checkbox/radio values.
- `scripts/fill_fillable_fields.py` — validate and fill AcroForm fields.
- `scripts/extract_form_structure.py` — extract labels, lines, and checkboxes from non-fillable PDFs.
- `scripts/check_bounding_boxes.py` — validate annotation bounding boxes before filling.
- `scripts/fill_pdf_form_with_annotations.py` — add text annotations to non-fillable forms.
- `scripts/create_validation_image.py` — draw field boxes over a page image (render one first with `rasterize_pdf`; see below).

Load the needed script with `read_skill_resource` before using or adapting it.

## Rendering pages to images (`rasterize_pdf`)

There is no in-process PDF rasterizer here — `pypdfium2`, PyMuPDF, and poppler are all absent, so
`pdfplumber`'s `page.to_image()` raises `ModuleNotFoundError: No module named 'pypdfium2'`. Use the
`rasterize_pdf` helper instead; it renders pages with pdf.js and returns the written PNG paths.

```python
from PIL import Image
pages = await rasterize_pdf("incident_report.pdf", scale=2.0, pages=[1])
img = Image.open(pages[0])   # feed to create_validation_image.py, vision(), OCR, etc.
```

`scale=1.0` ≈ 72 DPI (2.0 ≈ 144 DPI); `pages` takes a number, a list, or None for all pages. Higher
scale means larger images, so any pixel coordinates you draw scale with it.

For **non-fillable** forms you usually don't need a raster at all: take coordinates from
`extract_form_structure.py` (vector text, lines, and rects), then fill with
`fill_pdf_form_with_annotations.py` using **PDF coordinates** — give each page entry a
`pdf_width`/`pdf_height` and pdfplumber-style top-left bounding boxes. Reach for `rasterize_pdf` +
`create_validation_image.py` when you want to eyeball where the boxes land.

## Create a PDF (reportlab)

Before building, define page geometry, type roles, palette, header/footer, and recurring figure/table
treatment from the brief. The sample below demonstrates mechanics, not a default visual theme. For a
designed multi-page report, use `BaseDocTemplate`/`PageTemplate` so page furniture and grids stay
consistent.

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

For a richly designed one-pager, use ReportLab canvas or `jsPDF` for exact layout and place a
`matplotlib` chart or `render(..., quality="medium")` image as a visual layer. There is no HTML-to-PDF,
LibreOffice, or Pandoc conversion path in this sandbox.

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
