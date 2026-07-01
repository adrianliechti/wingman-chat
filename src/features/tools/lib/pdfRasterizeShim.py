# Defines the `rasterize_pdf` helper exposed to user code. The worker reads the
# PDF bytes from the Pyodide FS and bridges to the main thread via
# `_wingman_rasterize_pdf` (set as a Pyodide global by interpreter.worker.ts),
# where pdf.js renders the requested pages to PNG. The worker writes each page
# image back to the FS and hands back the paths as a JSON string. This is the
# only way to rasterize a PDF here — pypdfium2/PyMuPDF/poppler are unavailable,
# so pdfplumber's page.to_image() does not work.
import json as _json
import os as _os


async def rasterize_pdf(path, scale=2.0, pages=None):
    """Render PDF pages to PNG images.

    Use this when you need pixels — visual inspection, overlaying form-field
    boxes, OCR of a region, or feeding a page to `vision`. For plain text or
    tables prefer `pdfplumber`/`pypdf` (vector extraction, no raster).

    Args:
        path: Path to the PDF file in the sandbox filesystem.
        scale: Render scale; 1.0 ≈ 72 DPI, so the default 2.0 ≈ 144 DPI.
        pages: A 1-based page number, a list of them, or None for every page.

    Returns:
        The written PNG paths in page order, each "{pdf-name}-{page}.png" next
        to the source PDF.
    """
    if pages is not None and not isinstance(pages, (list, tuple)):
        pages = [pages]
    options = {
        "scale": float(scale),
        "pages": [int(p) for p in pages] if pages is not None else None,
    }
    result = await _wingman_rasterize_pdf(_os.path.abspath(str(path)), _json.dumps(options))
    return _json.loads(result)
