---
name: theme-factory
description: Apply a consistent, professional theme (color palette + font pairing) to a deck, document, report, or HTML artifact. Use to style a slide deck or doc with a cohesive look — pick one of the preset themes or generate a custom one on the fly.
---

# Theme Factory

A curated set of professional themes — each a cohesive palette + font pairing — to apply consistently
across an artifact. Pick the one that fits the audience/context, confirm with the user if unsure, then
apply its colors and fonts throughout (via `RGBColor.from_string` / `font.name` in python-pptx /
python-docx / reportlab, or CSS for HTML). Keep strong contrast and readability.

## Preset themes

For complete details on a preset, load its file from `themes/<theme-id>.md` with `read_skill_resource`.
Use the table below when a quick palette is enough.

| Theme | Feel | Palette (background · primary · accent · light/text) |
|---|---|---|
| **Ocean Depths** | calm, corporate, trust | `#1a2332` · `#2d8b8b` · `#a8dadc` · `#f1faee` |
| **Tech Innovation** | bold, high-contrast tech | `#1e1e1e` · `#0066ff` · `#00ffff` · `#ffffff` |
| **Sunset Boulevard** | warm, vibrant | `#2b1b2f` · `#ff6b6b` · `#ffd166` · `#fff5e1` |
| **Forest Canopy** | natural, grounded | `#1d2a1f` · `#52796f` · `#a3b18a` · `#f0f4ef` |
| **Modern Minimalist** | clean grayscale | `#ffffff` · `#222222` · `#9aa0a6` · `#111111` |
| **Golden Hour** | rich, autumnal | `#2a1f14` · `#c97b2c` · `#e9c46a` · `#fdf6ec` |
| **Arctic Frost** | cool, crisp | `#0f1b2b` · `#3a86ff` · `#bde0fe` · `#f8fbff` |
| **Desert Rose** | soft, sophisticated | `#2c2024` · `#bc6c7d` · `#e0afa0` · `#f7ede2` |
| **Botanical Garden** | fresh, organic | `#16271c` · `#2d6a4f` · `#95d5b2` · `#f3fbf5` |
| **Midnight Galaxy** | dramatic, cosmic | `#0b0c1e` · `#5a4fcf` · `#b388ff` · `#eae6ff` |

Fonts: pair a clean sans for headings with a readable body face (e.g. headings Poppins/DejaVu Sans
Bold, body Lora/DejaVu Sans). Substitute a bundled/CSS-available font if a specific family isn't
present.

## Apply
1. Pick (or confirm) a theme. 2. Use its background/primary/accent/text consistently — background on
content surfaces, primary for emphasis, accent sparingly (≤10%), text at high contrast. 3. Keep one
type pairing across every slide/section.

## Custom theme
If none fit, generate one: name it for the feel, pick a cohesive 4-colour palette (one dark, one
primary, one accent, one light/text) + a font pairing, show it for confirmation, then apply as above.
