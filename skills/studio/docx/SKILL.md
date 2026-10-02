---
name: docx
description: "Create or edit a Word (.docx) deliverable such as a report, memo, letter, proposal or template. Use for a requested Word file, not a report that should stay in chat."
---

# Word documents

Use `python-docx` in the interpreter. Read the source material first; ground claims, figures and citations in it. Open an existing document with `Document("input.docx")` and preserve its styles, sections, headers, tables and unrelated content. Avoid reconstructing it from extracted plain text.

For a new file, choose page geometry and named styles appropriate to the audience or supplied template. Use `Normal`, `Title` and `Heading N` consistently; headings should express document structure. Choose tables for comparisons and repeat headers where needed. Match typography and figure treatment across sections.

```python
from docx import Document
from docx.shared import Pt
doc = Document()
doc.styles["Normal"].font.size = Pt(11)
doc.add_heading("Report", level=0)
doc.add_paragraph("Replace with the supported summary.")
doc.save("report.docx")
```

Use `add_picture` for charts or images at a deliberate width; preserve aspect ratio. Prefer editable text and tables over screenshots. Avoid setting an existing paragraph's `.text` when its runs, links or inline formatting must survive.

Text may span multiple runs, so a visible phrase may not be contiguous in XML. For requested tracked changes or comments, preserve their OOXML structures and anchors; plain text replacement is not tracked editing. If the available method cannot satisfy that requirement, state the limitation before substituting a clean copy. Do not claim redlines were preserved without checking them.

The public python-docx API does not reliably create new Word footnotes. Preserve existing ones; use source lines or a references/endnotes section unless real footnotes are required. Do not silently substitute when that requirement matters.

Reopen the saved file to verify structure, text, tables and media. Check page/section breaks and likely clipping or orphan headings; distinguish structural checks from a rendered visual review. There is no LibreOffice conversion path here. Save the requested .docx and identify it briefly.
