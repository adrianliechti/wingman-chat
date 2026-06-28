---
name: image-styles
description: Apply a named visual style to a generated image — corporate and product photography, flat/isometric illustration, infographics, marketing and brand looks, plus a few playful styles. Use when the user names or implies a look (corporate portrait, flat illustration, isometric, tech gradient, product render, infographic, watercolor, Ghibli, …). Fold the matching fragment into the create_image / render() prompt.
---

# Image styles

When the user asks for a specific look, append the matching fragment below to the image prompt you
pass to `create_image` (or `render()`). Pick the closest match; never invent a style the user did not
ask for. The fragments are written as plain descriptions (not keyword lists) because that is what the
image model responds to best; keep any headline or label text the user wants in the main prompt, since
the model renders real text well.

## Photography

- **Corporate Portrait** — a polished corporate portrait in a bright modern office, soft natural window light with gentle fill, shallow depth of field and neutral color grading, confident and approachable, LinkedIn-quality
- **B&W Studio** — a black-and-white studio portrait with dramatic Rembrandt lighting, deep shadows and a clean seamless backdrop, sharp focus on the eyes, timeless and editorial
- **Editorial** — an editorial magazine photograph with intentional negative space for a headline, soft directional light and a refined, muted color grade, aspirational and brand-forward
- **Stock Business** — a clean, candid corporate scene of real people collaborating in a bright modern workspace, natural light and shallow depth of field, optimistic and authentic rather than staged
- **Leica** — a premium lifestyle photograph with a fast-prime look: creamy background blur, gentle subject separation and natural, true-to-life color in available light, understated and refined
- **Kodak Film** — a warm 35mm film photograph in the Kodak Portra tradition: golden tones, fine natural grain, soft highlight halation and rich, flattering skin tones, nostalgic and inviting
- **Cinematic** — a cinematic film still with anamorphic framing, a soft teal-and-orange grade, shallow depth of field and atmospheric light, dramatic and premium, hero-image quality
- **Macro** — an extreme close-up macro photograph with a razor-thin focal plane and smooth bokeh, crisp detail and soft studio light, ideal for showing material and texture
- **Flat Lay** — a tidy overhead flat-lay of the subject with a few complementary props on a clean surface, soft even light and generous negative space for text, polished and brand-ready

## Product

- **Product Cutout** — clean e-commerce product photography: the subject crisply isolated on a pure white background with a soft contact shadow and even, shadowless studio light, catalog-ready and easy to cut out
- **Product Render** — a photorealistic 3D product render on a seamless studio backdrop, soft global illumination, accurate materials and reflections and subtle ambient occlusion, premium and tactile

## Illustration & graphics

- **Flat Illustration** — a modern flat vector illustration with clean geometric shapes, a limited harmonious palette and minimal gradients, friendly and explanatory in the Kurzgesagt tradition, crisp and presentation-ready
- **Isometric 3D** — a clean isometric 3D illustration at a true 30-degree angle with simple geometric forms, soft shading and a tidy limited palette, the polished SaaS and landing-page look (not pixel art)
- **Line Art** — minimal single-weight line art on a plain background, clean continuous strokes with no fill or shading, an elegant icon-like illustration that reads at any size
- **Tech Gradient** — a modern tech-brand visual built from a smooth vibrant mesh gradient with soft abstract 3D shapes and a gentle glow, lots of clean space for text, the Stripe and Linear aesthetic
- **Infographic** — a clean infographic-poster look with bold flat shapes, a tight palette and clear visual hierarchy, with deliberate space reserved for figures and short labels, accurate and uncluttered
- **Whiteboard Sketch** — a hand-drawn whiteboard sketchnote with confident black marker lines, one or two accent colors on a clean white background, simple icons and arrows, friendly and explanatory
- **Blueprint** — a technical blueprint and schematic look with precise thin white linework on a deep blue ground, measured and diagrammatic, with room for callouts and labels
- **3D Cartoon** — a friendly 3D cartoon character in the Pixar and Disney tradition, soft global illumination, appealing rounded proportions and rich but clean textures, a polished studio render, great for a brand mascot
- **Sticker** — a die-cut sticker design with a thick white border, bold flat colors and clean vector edges on a plain background, simple and playful, ready for social or swag

## Artistic

- **Watercolor** — a soft watercolor illustration with wet-on-wet blends, gentle pigment bleeds and visible paper texture, light and approachable, with areas of white space left to breathe
- **Sketch** — a loose pencil sketch on toned paper with confident gestural lines, light cross-hatching and visible construction lines, an early-concept hand-drawn feel
- **Art Deco** — an Art Deco design with bold symmetrical geometry, elegant streamlined forms and a metallic gold and jewel-tone palette, luxurious and premium, well suited to event and brand graphics
- **Pop Art** — a bold pop-art treatment with flat saturated colors, thick outlines and halftone dots, high-energy and graphic, eye-catching for a punchy campaign

## Playful

- **Ghibli** — in the painterly Studio Ghibli tradition, with lush hand-painted backgrounds, soft warm light and gentle characters, a sense of wonder and calm
- **Claymation** — a stop-motion claymation look with smooth hand-shaped clay, subtle fingerprints and warm soft studio light, charming and tactile
- **Low Poly** — a low-poly 3D look with flat-shaded triangular facets, simple geometric forms and a clean limited palette, modern and minimal
- **Wingman** — the Wingman mascot, drawn as a Miffy-style white rabbit (after Dick Bruna): a friendly white rabbit with two long ears, dot eyes and a small cross-shaped mouth, clean bold black outlines and flat solid colors with no shading or gradients — a flat 2D picture-book illustration, not photorealistic and not 3D, simple and clean but not bare, with a flat-illustrated setting drawn around the character rather than an empty background, calm and childlike and on-brand
