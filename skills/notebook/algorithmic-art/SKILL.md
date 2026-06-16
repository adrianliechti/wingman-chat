---
name: algorithmic-art
description: Create generative / algorithmic art — flow fields, particle systems, noise-driven compositions — rendered to an image with code. Use when the user wants art made with code, generative art, or parametric visuals.
---

# Algorithmic Art

Make a computational aesthetic — emergent behaviour expressed through code. Render it **offline** with
the bundled Python interpreter (`numpy` + `matplotlib`/Pillow) to a `.png`; don't depend on a CDN.
Work in two steps: **(1) an algorithmic philosophy**, then **(2) express it in code**.

## Step 1 — Algorithmic philosophy (.md)
Name the movement (1–2 words: "Organic Turbulence", "Emergent Stillness"). In 4–6 paragraphs describe
how it manifests through computational processes, seeded randomness / noise fields, particle
behaviour and forces, temporal evolution, and parametric variation. Emphasize emergent beauty and
master-level craft. Save as `philosophy.md`.

## Step 2 — Express it (Python → PNG, offline)
Use **seeded** randomness so the piece is reproducible, and let the algorithm do the work (90%
generation, 10% parameters). A flow-field example tracing particles through a smooth field:

```python
import numpy as np, matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

rng = np.random.default_rng(42)            # seed → reproducible
W = H = 1600
fig, ax = plt.subplots(figsize=(8, 8), dpi=200)
ax.set_xlim(0, W); ax.set_ylim(0, H); ax.axis('off')
fig.patch.set_facecolor('#0b0b10'); ax.set_facecolor('#0b0b10')

for _ in range(1400):                      # particles
    x, y = rng.uniform(0, W), rng.uniform(0, H)
    xs, ys = [x], [y]
    for _ in range(80):                    # trace through the field
        a = (np.sin(x * 0.004) * np.cos(y * 0.004)) * np.pi * 2
        x += np.cos(a) * 6; y += np.sin(a) * 6
        xs.append(x); ys.append(y)
    ax.plot(xs, ys, color='white', alpha=0.06, lw=0.6)

fig.savefig('art.png', facecolor='#0b0b10', bbox_inches='tight', pad_inches=0)
plt.close(fig)
print('wrote art.png')
```

Vary the field, palette, particle count, and step rules to match the philosophy. `numpy` (vectorised
noise/forces) and Pillow (per-pixel work, blends) are both available and fast. Favour controlled
chaos and reward sustained viewing.

## Interactive version (online only)
If the user wants a *live, parametric* piece **and** the client has internet, you can instead write a
self-contained `.html` that loads p5.js from a CDN and drives the same algorithm with sliders. This
needs connectivity, so the Python→PNG path above is the default.

## Deliver
Save `art.png` (and `philosophy.md`) to the workspace; one line on what it is. To revise, tweak the
parameters and re-run.
