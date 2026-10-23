---
name: algorithmic-art
description: "Create art through code, such as flow fields, particles, noise or parametric compositions. Use for generative art and interactive exploration of its parameters."
---

# Algorithmic art

Choose a computational idea that fits the requested subject and aesthetic. Translate it into a field, rule system, palette, mark-making and density; skip invented manifestos unless requested.

Use numpy with matplotlib/Pillow for a static PNG, or native canvas/SVG and JavaScript when the user wants to explore parameters. Follow the requested format. Load `html-artifacts` if browser libraries or preview services are needed.

Make randomness reproducible with an explicit seed, such as `rng = np.random.default_rng(42)`, and separate adjustable parameters from the rendering logic. Bound iteration counts, particle lifetimes and canvas size so work completes within runtime limits; vectorize heavy operations. Do not silently change the seed on every redraw.

For interactive output, expose the few parameters that reveal meaningful changes, label them, and support reset. Stop animation when it is no longer needed and respect reduced motion. Save state only when useful. A standalone version should use native browser APIs and embed its required assets.

Inspect composition, density, clipping and output dimensions. Check parameter extremes for instability or blank output. Save the piece and include the source/seed when reproducibility is part of the request.
