---
name: pdf
description: "Create or manipulate a PDF deliverable: reports, one-pagers, merge/split/rotate, extraction to a file or form filling. Do not load merely to answer a question about an attached PDF."
---

# PDFs

Use ReportLab (Python) or the JavaScript interpreter's jsPDF to create PDFs, pypdf for page operations and pdfplumber for text/tables. For a report, establish page geometry, type roles and repeated headers/footers; use ReportLab PageTemplates for consistent multi-page layouts. Ground content in sources and preserve requested page size/order.

There is no HTML-to-PDF, LibreOffice or Pandoc conversion path here. PDF rasterizers such as pypdfium2, PyMuPDF and poppler are absent; pdfplumber's `page.to_image()` cannot be used. Render locally through the supplied helper:

```python
pages = await rasterize_pdf("report.pdf", scale=2.0, pages=[1])
# pages contains written PNG paths; page selection is 1-based.
```

Scale 1 is approximately 72 DPI; large pages may be rendered at a lower scale to fit canvas limits. Derive coordinate transforms from actual PNG dimensions and PDF page geometry, accounting for crop/rotation. Keep PDF-space and rendered-image coordinates distinct.

## Forms

Read relevant bundled scripts with `read_skill_resource` before running/adapting them:
- `scripts/check_fillable_fields.py`: detect AcroForm fields.
- `scripts/extract_form_field_info.py`: field names and valid checkbox/radio values.
- `scripts/fill_fillable_fields.py`: validate and fill AcroForm fields.
- `scripts/extract_form_structure.py`: vector labels, lines and checkboxes for non-fillable forms.
- `scripts/check_bounding_boxes.py`: validate annotation boxes.
- `scripts/fill_pdf_form_with_annotations.py`: fill non-fillable forms.
- `scripts/create_validation_image.py`: overlay boxes on a rendered page image.

For non-fillable forms, prefer coordinates from extracted vector structure. The annotation helper accepts page entries with `pdf_width`/`pdf_height` and pdfplumber-style top-left bounding boxes. Use rasterize_pdf plus the validation-image helper when placement needs visual checking. Inspect each script's input schema/usage; do not guess fields or coordinates.

Fill only values supplied or supported by the source. Preserve unrelated fields/pages. Reopen the result, verify page count/text/field values, and inspect representative rendered pages for clipping, overlap and misplaced annotations. Save the PDF and identify what was created or changed.
