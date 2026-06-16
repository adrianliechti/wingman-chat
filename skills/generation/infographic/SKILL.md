---
name: infographic
description: Generate a single poster-style infographic image (.png) that visualizes the key facts and numbers from the conversation and workspace material. Trigger with "make an infographic", "create a visual summary", "turn this into a one-pager graphic", or whenever the user wants a single shareable visual.
---

# Infographic

Produce one striking infographic **image** that captures the key points at a glance. You write a
detailed image prompt and render it with the interpreter's `render()` helper; the `.png` lands in
the workspace and shows inline in chat.

> Requires a configured image service. If `render()` reports none is configured, tell the user
> image generation isn't available and offer a report or slides instead.

## 1. Gather the material

Source = **the conversation so far plus workspace files**. Pull the real title, the 3–6 key
statistics or points, and any comparison worth showing. Use real numbers — never invent data.

## 2. Choose a strong visual style — do not default to "plain"

A generic "modern flat-vector, clean, lots of whitespace, grid of stat cards" prompt produces a
**boring, corporate-looking** infographic. Don't do that. Instead **commit to a distinctive art
direction**:

- **Bento** — modular bento-box cards, app-like, bold per-card accents
- **Editorial** — magazine spread, serif headlines, refined palette, hero numbers
- **Scientific** — diagram-led, precise, annotated
- **Sketch-note** — hand-drawn, energetic, doodle icons
- **Clay / kawaii / anime** — illustrative, characterful
- **Professional** — polished corporate (use only when the user wants understated)

If the user names a look, use it. **If they don't, pick the one that best fits the subject** (e.g.
a product/tech overview → bento or editorial) and apply it fully — never fall back to plain flat
vector unless the user explicitly asks for something minimal.

## 3. What makes it striking (not boring)

- **One dominant hero element.** A big focal visual or one huge headline number the eye hits first —
  not a uniform grid of equal cards.
- **Commit to bold, specific color.** A real palette with a confident accent, not safe grey-and-blue.
- **Depth and texture.** Layering, subtle shadows, grain, or illustration give life; pure flat fills
  read as generic.
- **Characterful iconography/illustration**, not stock line icons.
- **Varied composition and rhythm** — mix card sizes, scale, and density. Asymmetry beats a tidy 2×2.
- Treat it as a **designed poster**, not a slide. Modest text load (image models render text
  imperfectly) — give exact words for the title and key stats only.

## 4. Write the image prompt

Lead with the **art direction** (style, palette, mood, composition, hero), then layer in the
content. Describe: overall composition + the hero; the exact title/subtitle words; the key
stats/labels with their values; the section treatment; color, typography hierarchy, and texture —
all following the chosen style.

## 5. Render and deliver

```python
await render(
    "Bold bento-grid infographic poster, dark mode. Deep near-black background (#0E0E16) with "
    "vibrant per-card accents (electric indigo #6C5CE7, teal #19C3B2, amber #FFB020). Asymmetric "
    "grid of rounded cards of varying sizes with soft depth shadows and subtle grain. "
    "HERO: a large top-left card with a glowing 3D abstract neural-network sculpture and the title "
    "'NovaLLM' in big bold type, subtitle 'The AI platform for production LLM apps'. "
    "Around it, distinct accent-colored cards each with one huge number and a tiny label: "
    "'175B parameters', '128K context', '99.9% uptime', '40+ languages'. "
    "A wide card lists four capabilities with crisp custom glyph icons: Chat & Reasoning, Code Gen, "
    "RAG / Search, Function Calling. A small footer card reads 'Prototype to production in days'. "
    "Confident modern sans-serif, oversized tabular numbers, generous depth, app-like polish, "
    "high contrast, visually rich — not flat or corporate.",
    "infographic.png",
)
print("wrote infographic.png")
```

Save `infographic.png` to the workspace root. Tell the user it's ready; to revise, push the art
direction further (bolder palette, stronger hero, different style skill) and re-run. If they want a
precise, text-heavy layout instead, offer a slide one-pager or a report.
