---
name: algorithmic-art
description: Create generative / algorithmic art with p5.js — flow fields, particle systems, noise-driven compositions — delivered as an interactive self-contained HTML artifact. Use when the user wants art made with code, generative art, or parametric visuals.
---

# Algorithmic Art

Make a computational aesthetic — emergent behaviour expressed through code. Work in two steps:
**(1) an algorithmic philosophy** (`philosophy.md`), then **(2) express it as p5.js** in a
self-contained `.html` artifact that runs in the side panel (p5.js loads from a CDN; the preview
executes scripts).

## Step 1 — Algorithmic philosophy (.md)
Name the movement (1–2 words: "Organic Turbulence", "Emergent Stillness"). In 4–6 paragraphs describe
how it manifests through computational processes, seeded randomness/noise fields, particle behaviour
and forces, temporal evolution, and parametric variation. Emphasize emergent beauty and master-level
craft. Save as `philosophy.md`.

## Step 2 — Express it (p5.js in HTML)
Write `art.html`: load p5.js from CDN, use **seeded randomness** (`randomSeed`/`noiseSeed`) so the
piece is reproducible, and drive the composition with noise fields, particles, or flow forces.

```python
html = """<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0b10;overflow:hidden}</style>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"></script></head><body>
<script>
let seed = 42;
function setup(){ createCanvas(windowWidth, windowHeight); randomSeed(seed); noiseSeed(seed);
  noFill(); stroke(255, 24); }
function draw(){
  // flow-field strokes
  for (let i=0;i<400;i++){
    let x=random(width), y=random(height);
    beginShape();
    for (let j=0;j<60;j++){ let a=noise(x*0.002,y*0.002)*TAU*2; x+=cos(a)*2; y+=sin(a)*2; vertex(x,y); }
    endShape();
  }
  noLoop();
}
function windowResized(){ resizeCanvas(windowWidth, windowHeight); }
</script></body></html>"""
with open("art.html","w") as f: f.write(html)
print("wrote art.html")
```

Expose a few parameters (seed, density, palette) and keep the algorithm doing the work (90%
generation, 10% parameters). Favor controlled chaos and reward sustained viewing. To export a still,
also render a frame to `.png` if asked.

> Adapted from Anthropic's open `algorithmic-art` skill (p5.js in a self-contained HTML artifact).
