# Defines the `ocr` helper exposed to user code. The worker reads the file
# bytes from the Pyodide FS and bridges the extraction call to the main thread
# via `_wingman_ocr` (set as a Pyodide global by interpreter.worker.ts).
import os as _os


async def ocr(path):
    """Extract text from a document via the cloud extraction/OCR service.

    Handles scanned PDFs, images of documents, and Office formats. Call it
    directly for images; for PDFs and Office files use it only after direct
    extraction (pdfminer, pdfplumber, docx2txt, ...) returned empty or
    garbled text — this is a network round trip to a remote service.

    Args:
        path: Path to the document file in the sandbox filesystem.

    Returns:
        The extracted text as a string.
    """
    return await _wingman_ocr(_os.path.abspath(str(path)))
