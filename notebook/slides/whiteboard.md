---
label: "Whiteboard"
description: "Clean minimal design with hand-drawn feel and open whitespace"
default: true
---

## Visual Style

- **Background:** clean white or soft off-white (#F8F8F8)
- **Color palette:** vibrant multi-color — warm orange (#E87D3E), teal (#3EB5A5), sky blue (#4A9FD9), leaf green (#5DB861), coral red (#E8635A) — used for highlights, decorative elements, and illustrations
- **Title font:** bold sans-serif, large and expressive, in dark charcoal (#2D2D2D)
- **Body font:** clean sans-serif in dark charcoal (#2D2D2D)
- **Layout:** generous whitespace, asymmetric compositions. Content can use split layouts — text on one side, illustration or diagram on the other.
- **Visual elements:** use `generate_image` to create sketch-style or doodle illustrations as visual anchors for each slide. Diagrams using SVG with colorful, informal styling.
- **Data visualizations:** colorful charts using the multi-color palette with rounded shapes
- **Bullet points:** small colored dots or dashes — vary the style
- **Borders/frames:** none. Content floats freely.
- **Overall feel:** vibrant "sketch-notes" aesthetic — colorful, energetic, educational. Think RSA Animate or a creative teacher's whiteboard.

## CSS tokens — use these exact values in `styles/theme.css`

```css
:root {
  --bg: #F8F8F8;
  --ink: #2D2D2D;
  --ink-muted: #5C5C5C;
  --accent: #E87D3E;     /* warm orange */
  --accent-2: #3EB5A5;   /* teal */
  --accent-3: #4A9FD9;   /* sky blue */
  --accent-4: #5DB861;   /* leaf green */
  --accent-5: #E8635A;   /* coral red */
  --font-display: "Inter", "Söhne", system-ui, -apple-system, "Helvetica Neue", Helvetica, sans-serif;
  --font-body: "Inter", system-ui, -apple-system, "Helvetica Neue", Helvetica, sans-serif;
}
```

Best fit: education and training material, internal explainers, kick-off / workshop decks, audience-friendly summaries. Avoid for: formal board / regulatory material, executive-only briefings, anything that needs to convey gravitas.
