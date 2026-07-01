---
label: "Nature"
description: "Warm earthy tones with organic shapes and natural imagery"
---

## Visual Style

- **Background:** warm cream (#FAF6F0)
- **Primary color:** deep forest green (#2D5016) for titles and headings
- **Color palette:** earthy, muted — sage green (#7A9B6D), warm terracotta (#C4704B), golden ochre (#D4A54A), dusty rose (#C17B7B), deep brown (#4A3728), muted lavender (#8B7FA8)
- **Title font:** elegant serif (Playfair Display / Cormorant style) in forest green, medium-to-bold weight, generous letter-spacing
- **Body font:** light serif or humanist sans-serif in deep brown (#3D3025), generous line-height (1.7x)
- **Layout:** flowing, organic compositions. Asymmetric but balanced. Text inset with generous margins.
- **Visual elements:** use `generate_image` to create watercolor-style botanical elements — leaves, branches, ferns, wildflowers — as decorative borders, corner accents, or framing devices
- **Color blocks:** soft muted rectangles with slight opacity as section backgrounds — a sage block behind a quote, a faint terracotta wash highlighting a stat. Use rounded corners and soft edges.
- **Data visualizations:** rounded, soft-colored charts using the earthy palette. Donut charts over pie charts. Gentle, organic feeling.
- **Bullet points:** small leaf-shaped markers or elegant em-dashes in terracotta
- **Emphasis:** key words highlighted with a golden ochre background or underlined with a thin terracotta line
- **NO:** harsh lines, neon colors, geometric patterns, sharp corners
- **Overall feel:** organic, nature-inspired — warm, sophisticated, calming. Think premium wellness brand or botanical garden exhibition.

## CSS tokens — use these exact values in `styles/theme.css`

```css
:root {
  --bg: #faf6f0; /* warm cream */
  --ink: #3d3025; /* deep brown — body text */
  --ink-display: #2d5016; /* forest green — titles */
  --ink-muted: #6b5e4f;
  --accent: #7a9b6d; /* sage */
  --accent-2: #c4704b; /* terracotta */
  --accent-warm: #d4a54a; /* golden ochre — highlights */
  --accent-rose: #c17b7b; /* dusty rose */
  --accent-lavender: #8b7fa8;
  --muted: #e8dfd0; /* faint wash */
  --font-display: "Playfair Display", "Cormorant Garamond", "Source Serif Pro", Georgia, "Times New Roman", serif;
  --font-body: "Source Serif Pro", "Lora", Georgia, "Times New Roman", serif;
}
```

Best fit: sustainability / ESG decks, wellness and lifestyle brands, narrative-driven storytelling, foundation / nonprofit reports. Avoid for: hard-edged quantitative briefings, technology roadmaps, formal compliance/audit material.
