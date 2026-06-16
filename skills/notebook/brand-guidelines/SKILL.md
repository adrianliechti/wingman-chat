---
name: brand-guidelines
description: Apply Anthropic's official brand colors and typography to an artifact (deck, doc, report, page) when an Anthropic-branded look is wanted. Use when the request calls for Anthropic brand styling, corporate identity, or company design standards.
---

# Anthropic Brand Styling

Apply Anthropic's brand identity consistently across the artifact.

## Colors
**Main:** Dark `#141413` (primary text / dark backgrounds) · Light `#faf9f5` (light backgrounds /
text on dark) · Mid Gray `#b0aea5` (secondary) · Light Gray `#e8e6dc` (subtle backgrounds).
**Accents:** Orange `#d97757` (primary) · Blue `#6a9bcc` (secondary) · Green `#788c5d` (tertiary).

Use the accents for non-text shapes/emphasis, cycling orange → blue → green for visual interest while
staying on-brand. Keep text high-contrast (dark on light, light on dark).

## Typography
- **Headings (≥24pt):** Poppins (fallback Arial).
- **Body:** Lora (fallback Georgia).

## Apply
- python-pptx / python-docx: set `font.name` and `RGBColor.from_string("141413")` etc.; fall back to
  Arial/Georgia if Poppins/Lora aren't available.
- HTML/reportlab: same hex values via CSS / reportlab colors; load Poppins/Lora from a CDN for HTML.
- Apply Poppins to headings, Lora to body, accents to shapes — preserve hierarchy and readability.

> From Anthropic's open `brand-guidelines` skill (Anthropic-specific brand).
