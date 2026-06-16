---
name: visualize
description: Make a diagram or chart that explains something — flowcharts, structural/architecture diagrams, illustrative "how it works" mechanism drawings, data charts, or interactive explainers. Trigger when the user wants to see a concept visualized, a process diagrammed, or data charted. Output is an .svg or a self-contained .html that renders in the side panel.
---

# Visualize — diagrams & charts

Produce a clean, flat visual that renders in the workspace. Pick the form from **what the user asked**
(route on the verb), then build it with the technique below. Put explanation in your chat reply; keep
the artifact to the visual itself.

## Pick the form

| Asked | Form | Build with |
|---|---|---|
| "how does X **work**?" | illustrative mechanism drawing | hand-authored SVG (+ optional controls in HTML) |
| "what's the **architecture**?" | structural (nested labelled boxes) | SVG or Mermaid `flowchart` with subgraphs |
| "what are the **steps**?" | flowchart (linear) | Mermaid `flowchart` or SVG |
| "show the **data**" | chart (bar/line/pie/scatter) | Chart.js in HTML (or `matplotlib` → PNG) |
| "explain X" (let me poke it) | interactive explainer | HTML with sliders/toggles + live readout |
| schema / ERD | entity diagram | Mermaid `erDiagram` |

For a complex topic, ship **several focused visuals with prose between them**, not one dense diagram.

## Aesthetic (all forms)

- **Flat.** No gradients, drop shadows, glow, or neon. Clean surfaces, ~0.5px strokes.
- **Color encodes meaning, not sequence.** Group nodes by *category* (one hue per category); use
  2–3 hues, not a rainbow. Reserve red/amber/green for error/warning/success.
- **Sentence case**, never Title Case or ALL CAPS. Two text sizes (label ~14px, caption ~12px),
  nothing below 11px. Respect dark mode (CSS variables or test both).

## Mermaid in HTML (flowchart / structural / ERD — the easy path)

```python
mermaid = '''flowchart LR
  user([User]) -->|request| api[API service]
  api -->|SQL| db[(Postgres)]
'''
doc = '''<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>
<pre class="mermaid">__MM__</pre>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
mermaid.initialize({ startOnLoad: true });
</script></body></html>'''
with open('diagram.html', 'w') as f:
    f.write(doc.replace('__MM__', mermaid))
```
Escape `&`/`<`/`>` in labels. Decision nodes `{ }`, start/end `([ ])`, datastores `[( )]`.

## Hand-authored SVG (illustrative / precise mechanism)

- `viewBox="0 0 680 H"` — **680 wide is fixed** (matches the container 1:1). Set `H` to the
  bottom-most element + ~20px; don't leave big empty space. `width="100%"`. **No negative
  coordinates.** Keep content in x≈40–640.
- Every connector `<path>` **must have `fill="none"`** (SVG paths default to black fill).
- SVG text **does not wrap** — size boxes to fit, or add explicit `<tspan x dy="1.2em">` line breaks;
  use `dominant-baseline="central"` for vertical centering. Two sizes only (14 / 12).
- Strokes 0.5px. Define one arrowhead `<marker>` in `<defs>` and reuse it.
- Cycles don't get drawn as rings — use a linear flow with a labelled return arrow, or an HTML
  stepper. Don't let a stroke cross a text label.

## Chart.js in HTML (data)

```html
<div style="position:relative;height:360px"><canvas id="c"></canvas></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
<script>
new Chart(document.getElementById('c'), {
  type: 'bar',
  data: { labels: ['Q1','Q2','Q3'], datasets: [{ label: 'Revenue', data: [12,19,30] }] },
  options: { responsive: true, maintainAspectRatio: false }
});
</script>
```
- Set height on the **wrapper div**, never the `<canvas>`; `position: relative`;
  `maintainAspectRatio: false`. **Canvas can't read CSS variables — hardcode hex colors.**
- Horizontal bars: wrapper height ≥ `bars × 40 + 80`. Prefer a custom HTML legend over the default.
- For static/printed charts instead, draw with `matplotlib` and save a `.png`.

## Interactive explainer

HTML with `<input type="range">`/buttons that update an inline SVG or a number live. Keep the prose
in your reply; the artifact is just the interactive piece. Persist any chosen state to `localStorage`.

## Deliver
Save `diagram.html` (or `.svg`) to the workspace; one line on what it shows. To revise, edit the file.
