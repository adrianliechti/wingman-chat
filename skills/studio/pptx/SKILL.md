---
name: pptx
description: Create or edit PowerPoint presentations (.pptx) — pitch decks, slide decks, presentations. Trigger on "deck", "slides", "presentation", ".pptx", or any request to build/modify slides. Produces an editable .pptx the user can open in PowerPoint/Keynote/Google Slides.
---

# PPTX — slide decks (Python runtime)

Build `.pptx` files with **`python-pptx`** in the interpreter. Save to the workspace; it renders in
the side panel.

## Get the content first, then design

Pull the real material from the conversation/workspace. Then commit to ONE visual system before slide
1 (read `theme-factory` for a ready palette + fonts, or pick your own):

- **Insight titles, not topic labels** — "Enterprise ACV grew 38% as mid-market stalled", not
  "Revenue". Lead with a verb, one line.
- **One focal point per slide**; big numbers shown large with a small label.
- **Vary the rhythm** — cover / section / hero-stat / chart / comparison / quote / close. Not ten
  "title + 3 bullets" slides.
- **8–12 slides** unless asked otherwise. Cite figures on the slide. No filler.

## Typography & hierarchy (legible from across a room)

- **Nothing below 14pt** — body, labels, captions, footnotes, chart text included. Sub-14pt is
  unreadable when projected.
- **Size hierarchy:** title **32–40pt bold**, section header 24–28pt bold, body 16–18pt, caption 14pt.
  The title must be **≥ 1.75× the body size**.
- **Pick a palette archetype** per deck — corporate-neutral / warm-editorial / bold-startup /
  academic-muted / playful-bright — and commit to it. Make it **content-informed**: if swapping the
  palette into an unrelated deck would still work, it's too generic — tie the colors to _this_ topic.
  **One color dominates** (~60% of the deck), 1–2 supporting tones, one sharp accent — never equal
  weight. **Do not reflexively default to a dark-blue background.** Two background colors max (content +
  section dividers). `read_skill theme-factory` for ready palettes.

## Build it

```python
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)   # 16:9
BLANK = prs.slide_layouts[6]

BG, INK, ACC = RGBColor(0x0F,0x14,0x1A), RGBColor(0xF5,0xF5,0xF5), RGBColor(0x4F,0x9C,0xF5)

def bg(s, c):
    s.background.fill.solid(); s.background.fill.fore_color.rgb = c

def text(s, l, t, w, h, txt, size, color, bold=False, align=PP_ALIGN.LEFT):
    tb = s.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h)); tf = tb.text_frame
    tf.word_wrap = True; p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = txt; f = r.font
    f.size, f.bold, f.color.rgb = Pt(size), bold, color
    return tb

# Cover
s = prs.slides.add_slide(BLANK); bg(s, BG)
text(s, 0.9, 2.6, 11.5, 1.8, "Enterprise ACV grew 38% as mid-market stalled", 40, INK, bold=True)
text(s, 0.9, 4.3, 11.5, 0.8, "FY24 revenue review", 20, ACC)

prs.save("presentation.pptx")
print("wrote presentation.pptx")
```

Notes:

- Use `add_textbox` on the **blank** layout (`slide_layouts[6]`) for full control; set explicit
  positions so nothing collides; keep ~0.7–1.0in outer margins.
- **Charts**: use a real chart, never shapes faking one. Native `add_chart` with `CategoryChartData` —
  give it a title, a legend (top), and data labels (`plot.has_data_labels = True`); keep chart text
  ≥14pt. For anything beyond bar/line/pie, draw it in `matplotlib` (`savefig("c.png", dpi=200)`) and
  `add_picture`.
- **Imagery**: `await render("<prompt>", "img/cover.png")` then `add_picture`.
- **Speaker notes**: `slide.notes_slide.notes_text_frame.text = "..."`.
- **Editing an existing deck**: open it (`Presentation("deck.pptx")`), change only the shapes you need,
  re-save — don't rebuild from scratch when revising. Keep the template's masters/layouts.

## Verify before handing off

**Assume the first build has problems** — go slide by slide hunting for them, don't just confirm the
file exists. On each slide check: no text box runs past the slide edge or overlaps another; titles fit
one line (a title that wrapped to two breaks decorative lines positioned for one); every figure is
real and sourced; no leftover placeholder; nothing below 14pt; even margins and gaps. Fix what you
find and re-check the affected slides — one fix often creates the next problem.

## Deliver

Save as `<slug>.pptx`; one-line hand-off (topic + slide count). To revise, open the saved file and
modify it.
