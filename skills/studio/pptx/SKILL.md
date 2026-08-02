---
name: pptx
description: Create or edit PowerPoint presentations (.pptx) — pitch decks, slide decks, presentations. Trigger on "deck", "slides", "presentation", ".pptx", or any request to build/modify slides. Produces an editable .pptx the user can open in PowerPoint/Keynote/Google Slides.
---

# PPTX — slide decks (Python runtime)

Build `.pptx` files with **`python-pptx`** in the interpreter. Save to the workspace; it renders in
the side panel.

## Get the content first, then design

Pull the real material from the conversation/workspace. Then derive and commit to one visual system
before slide 1. Use `theme-factory` only when the user specifically asks for a reusable theme:

- **Insight titles, not topic labels** — "Enterprise ACV grew 38% as mid-market stalled", not
  "Revenue". Lead with a verb, one line.
- **One focal point per slide**; big numbers shown large with a small label.
- **Vary the rhythm** — cover / section / hero-stat / chart / comparison / quote / close. Not ten
  "title + 3 bullets" slides.
- **Make the subject visible** through real imagery, product states, charts, diagrams, or a material
  motif; typography over empty color fields cannot carry every slide.
- Use the fewest slides that tell the story, usually **6–10** unless asked otherwise. Cite figures on
  the slide. No filler.

## Typography & hierarchy (legible from across a room)

- **Nothing below 14pt** — body, labels, captions, footnotes, chart text included. Sub-14pt is
  unreadable when projected.
- **Size hierarchy:** title **32–40pt bold**, section header 24–28pt bold, body 16–18pt, caption 14pt.
  The title must be **≥ 1.75× the body size**.
- Derive the palette from the subject or source brand. One field color should dominate, with 1–2
  supporting tones and one sharp accent. If swapping the palette and motif into an unrelated deck
  would still work, they are too generic. Do not reflexively default to dark navy, gray consulting
  slides, or a different accent color on every page.

## Build it

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)   # 16:9
BLANK = prs.slide_layouts[6]

def bg(s, c):
    s.background.fill.solid(); s.background.fill.fore_color.rgb = c

def text(s, l, t, w, h, txt, size, color, bold=False, align=PP_ALIGN.LEFT):
    tb = s.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h)); tf = tb.text_frame
    tf.word_wrap = True; p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = txt; f = r.font
    f.size, f.bold, f.color.rgb = Pt(size), bold, color
    return tb

# Define theme colors from the brief, storyboard the slide forms, then build each slide with these helpers.
```

Notes:

- Use `add_textbox` on the **blank** layout (`slide_layouts[6]`) for full control; set explicit
  positions so nothing collides; keep ~0.7–1.0in outer margins.
- **Charts**: use a real chart, never shapes faking one. Native `add_chart` with `CategoryChartData` —
  give it a title, a legend (top), and data labels (`plot.has_data_labels = True`); keep chart text
  ≥14pt. For anything beyond bar/line/pie, draw it in `matplotlib` (`savefig("c.png", dpi=200)`) and
  `add_picture`.
- **Imagery**: `await render("<brief-specific prompt>", "cover.png", quality="medium", aspect_ratio="16:9")`
  then `add_picture`. Crop intentionally rather than stretching.
- **Speaker notes**: `slide.notes_slide.notes_text_frame.text = "..."`.
- **Editing an existing deck**: open it (`Presentation("deck.pptx")`), change only the shapes you need,
  re-save — don't rebuild from scratch when revising. Keep the template's masters/layouts.

## Verify the deck

Check slide count, bounds, obvious overlaps, title fit, source labels, placeholders, and minimum type
size. Inspect shape coordinates programmatically where useful. This is functional verification;
deeper visual critique is optional when the user asks for polish.

Then read back only the slide titles in order. They must tell a coherent story without body copy and
use one grammatical style throughout (for example, all declarative insight statements). Replace topic
labels and canned punchlines—especially “It’s not X. It’s Y.”—with specific claims. An intentionally
open bottom third can be strong composition; do not flag whitespace as a defect by itself. When
translating design measurements, use `px = pt × 1.333`, and verify the result at projected size.

## Deliver

Save as `<slug>.pptx`; one-line hand-off (topic + slide count). To revise, open the saved file and
modify it.
