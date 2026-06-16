---
name: deck-style-dark
description: Slide deck style — Bold dark backgrounds with high-contrast text and vibrant highlights. Use when generating a slide deck in the "Dark" style (id: dark).
---

# Dark — slide deck style

## Visual Style

- **Background:** deep charcoal (#111118), optionally with a subtle radial gradient toward center (#181825)
- **Primary text:** pure white (#FFFFFF) for titles and hero numbers
- **Secondary text:** silver-gray (#A0A0B8) for body text and labels
- **Accent 1:** electric blue (#0A84FF) — primary accent for highlights, chart fills, glowing elements
- **Accent 2:** soft violet (#8B5CF6) — secondary accent for gradients paired with blue
- **Accent 3:** warm coral (#FF6B6B) — used sparingly for alerts or critical callouts
- **Title font:** bold modern sans-serif, large, pure white
- **Body font:** regular sans-serif in silver-gray, generous line-height
- **Layout:** cinematic wide compositions with dramatic negative space. Content occupies 50-60% of the slide, letting the dark background breathe. Asymmetric but balanced.
- **Graphic elements:** subtle gradient overlays (blue-to-violet) behind important elements. Thin luminous lines (1px, blue or violet at 40% opacity) as dividers. Abstract geometric shapes at low opacity (10-15%) as background texture.
- **Data visualizations:** charts with blue fills and thin white borders. Dark chart backgrounds (#1A1A2E). Subtle grid lines (#252540). Data labels in white.
- **Cards/containers:** dark elevated surfaces (#1E1E30) with 1px borders (#2A2A44). Rounded corners (12px). Feel like floating panels.
- **Hero numbers:** key statistics displayed very large in white or blue
- **NO:** harsh borders, pure black (#000), text-heavy slides without hierarchy
- **Overall feel:** premium tech keynote — Apple WWDC, Stripe Sessions. Bold, cinematic, contemporary.

## CSS tokens — use these exact values in `styles/theme.css`

```css
:root {
  --bg: #111118;
  --bg-elevated: #1E1E30;
  --bg-chart: #1A1A2E;
  --ink: #FFFFFF;
  --ink-muted: #A0A0B8;
  --accent: #0A84FF;     /* electric blue */
  --accent-2: #8B5CF6;   /* violet — pair with blue for gradients */
  --accent-warn: #FF6B6B; /* coral — alerts / critical only */
  --muted: #2A2A44;      /* card borders, grid lines */
  --font-display: "SF Pro Display", "Inter", system-ui, -apple-system, sans-serif;
  --font-body: "SF Pro Text", "Inter", system-ui, -apple-system, sans-serif;
}
```

Best fit: product launches, tech keynotes, investor pitches, "future-of" decks. Avoid for: dense data briefings, regulated-context reports (controls/SOX/audit), print-first material.
