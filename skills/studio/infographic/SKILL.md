---
name: infographic
description: Generate a single poster-style infographic image (.png) that visualizes the key facts and numbers from the conversation and workspace material. Trigger with "make an infographic", "create a visual summary", "turn this into a one-pager graphic", or whenever the user wants a single shareable visual.
---

# Infographic

Produce one striking infographic **image** that captures the key points at a glance: you write a
detailed image prompt and render it with the interpreter's `render()` helper. The `.png` lands in the
workspace and shows inline in chat.

This is a **data-driven** poster — real facts and numbers. For an **art-led** poster where aesthetics
lead, use `canvas-design` instead.

> Requires a configured image service. If `render()` reports none is configured, say so and offer a
> report or slides instead.

## `render()` builds the poster — text and all

An infographic is a **generated image**, not a hand-laid-out figure. Do **not** assemble it from
`matplotlib` / `Pillow` / `reportlab` shapes — plotted boxes and text cards produce a cluttered,
dead, corporate artefact, never a designed poster. If you're reaching for `plt.subplots`, `ax.text`,
or a grid of `Rectangle`s to "lay out the infographic", stop: wrong tool.

Modern image models render text well, so write the real title, stats, and labels straight into the
prompt and trust `render()` with them — don't pre-emptively strip the text out and letter it by hand.
What trips a renderer up isn't text, it's *too much* text: cram a whole deck of exact copy into one
image and words start to garble. The fix is to **distil** (next step), not to avoid text.

## 1. Gather and distil

Source = the conversation plus workspace files. Pull the real title and the **5–7** key stats/points
that matter — a poster carries a headline and a handful of numbers, not a slide's worth of bullets.
Use real numbers; never invent data. From a deck or doc, extract the text first, then cut hard.

## 2. Commit to an art direction — don't default to "plain"

A generic "modern flat-vector, clean, whitespace, grid of stat cards" prompt reads boring and
corporate. Pick a distinctive style and apply it fully:

- **Bento** — modular cards, app-like, bold per-card accents
- **Editorial** — magazine spread, serif headlines, hero numbers
- **Scientific** — diagram-led, precise, annotated
- **Sketch-note** — hand-drawn, energetic, doodle icons
- **Clay / kawaii / anime** — illustrative, characterful
- **Professional** — polished corporate (only when the user wants understated)

If the user names a look, use it; otherwise pick the one that fits the subject (tech overview → bento
or editorial) and commit — never fall back to plain flat vector unless they ask for minimal.

## 3. What makes it striking

- **One dominant hero** — a big focal visual or one huge headline number, not a uniform grid.
- **Bold, specific color** — a real palette with a confident accent, not safe grey-and-blue.
- **Depth and texture** — layering, soft shadows, grain, illustration; pure flat fills read generic.
- **Characterful icons/illustration**, not stock line icons.
- **Varied rhythm** — mix card sizes and density; asymmetry beats a tidy 2×2.
- **Light text load** — a headline, the hero number, and short labels. Renderers handle that cleanly;
  they only stumble when one image carries a deck's worth of exact copy, so distil rather than dump.

## 4. Write the prompt, then render

Lead with the **art direction** (style, palette, mood, composition, hero), then layer the content: the
exact title/subtitle words, the key stats with their values, the section treatment, and the type
hierarchy — all in the chosen style.

```python
await render(
    "Bold bento-grid infographic poster, dark mode. Deep near-black (#0E0E16) with vibrant per-card "
    "accents (electric indigo #6C5CE7, teal #19C3B2, amber #FFB020). Asymmetric grid of rounded cards "
    "of varying sizes, soft depth shadows, subtle grain. HERO: large top-left card with a glowing 3D "
    "abstract neural-network sculpture, title 'NovaLLM', subtitle 'The AI platform for production LLM "
    "apps'. Accent cards each with one huge number + tiny label: '175B parameters', '128K context', "
    "'99.9% uptime', '40+ languages'. A wide card lists four capabilities with custom glyph icons: "
    "Chat & Reasoning, Code Gen, RAG / Search, Function Calling. Confident modern sans-serif, oversized "
    "tabular numbers, app-like polish, high contrast — not flat or corporate.",
    "infographic.png",
)
```

## 5. Deliver

Save `infographic.png` to the workspace root and hand off in one line. Glance at the result; if a word
or number is clearly off, re-render (distilling the text a little more usually fixes it), or — for one
stubborn critical value — overlay just that with Pillow. To revise, push the art direction further and
re-render rather than rebuilding by hand.
