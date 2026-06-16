---
name: visualize
description: Make a diagram or chart that explains something — flowcharts, structural/architecture diagrams, illustrative "how it works" mechanism drawings, data charts, or interactive explainers. Trigger when the user wants to see a concept visualized, a process diagrammed, or data charted. Output is a .mmd / .svg / .png / .html that renders in the side panel.
---

# Visualize — diagrams & charts

Produce a clean, flat visual that renders in the workspace. Everything here works **offline** — the
drawer renders **Mermaid `.mmd`** natively, the bundled Python interpreter draws charts
(`matplotlib`) and images, and hand-authored SVG needs nothing. Don't load scripts from a CDN. Put
the explanation in your chat reply; keep the artifact to the visual.

**This skill is for *explaining*** — diagrams, mechanism drawings, and quick illustrative charts. For a
rigorous chart of a real dataset (publication-quality, accessible), use `data-visualization`; for a
business flow, C4, or tree, use `process-diagram` / `architecture-diagram` / `mind-map`.

## Pick the form (route on the verb)

| Asked | Form | Build with |
|---|---|---|
| "what are the **steps**?" | flowchart | **Mermaid** `.mmd` |
| "what's the **architecture**?" | structural (nested boxes) | **Mermaid** `.mmd` (`flowchart` + subgraphs) |
| schema / ERD | entity diagram | **Mermaid** `.mmd` (`erDiagram`) |
| "how does X **work**?" | illustrative mechanism | hand-authored **SVG** |
| "show the **data**" | chart | **`matplotlib` → PNG** |
| "explain X" (let me poke it) | interactive explainer | self-contained **HTML** (inline SVG + JS) |

**Illustrative is the default for "how does X work."** Don't retreat to a flowchart because
boxes-and-arrows feel safer — a mechanism drawing (the actual thing, mid-process) teaches more. Reach
for a flowchart only when the answer really *is* a sequence of steps.

Mermaid does the layout, routing, and spacing for flows / structures / ERDs — reliable and **offline**,
so prefer it there over hand-placed SVG. Hand-author SVG **only** for illustrative mechanisms Mermaid
can't express. For a complex topic, ship **several focused visuals with prose between them**, not one
dense diagram.

## Aesthetic (all forms)

- **Flat.** No gradients, drop shadows, glow, or neon.
- **Color encodes meaning, not sequence.** Group by *category* (one hue per category); 2–3 hues, not
  a rainbow. Reserve red/amber/green for error/warning/success.
- **Budget the complexity.** Box labels ≤ 5 words — detail goes in the prose, not the box. ≤ 4 boxes
  across at full width; more than that, wrap to rows or split into two diagrams. Aim for 8–25 nodes.
- **Sentence case**, never Title Case or ALL CAPS. Nothing below ~11px.

## Diagrams → Mermaid (`.mmd`, native & offline)

Write the Mermaid source to a `.mmd` file; the drawer renders it.

```python
diagram = """flowchart LR
  user([User]) -->|request| api[API service]
  api -->|SQL| db[(Postgres)]
"""
with open("diagram.mmd", "w") as f:
    f.write(diagram)
print("wrote diagram.mmd")
```

`flowchart` for flows/architecture (with `subgraph` for lanes/boundaries), `sequenceDiagram` for
interactions, `erDiagram` for schemas, `mindmap` for trees. Escape `&`/`<`/`>` in labels. Decision
nodes `{ }`, start/end `([ ])`, datastore `[( )]`, queue `[[ ]]`.

## Charts → matplotlib (`.png`)

```python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(7, 4), dpi=200)
ax.bar(['Q1', 'Q2', 'Q3'], [12, 19, 30], color='#4f9cf5')
for v, h in zip(['Q1', 'Q2', 'Q3'], [12, 19, 30]):
    ax.text(v, h + 0.4, str(h), ha='center', fontsize=11)
for s in ('top', 'right'):
    ax.spines[s].set_visible(False)
ax.set_title('Revenue ($mm)', loc='left')
fig.tight_layout(); fig.savefig('chart.png'); plt.close(fig)
```
Hide top/right spines, label values directly, no chartjunk, real numbers.

## Illustrative mechanism → hand-authored SVG

For a "how it works" drawing Mermaid can't express:
- `viewBox="0 0 680 H"` — 680 wide is fixed; set `H` to the bottom-most element + ~20px; `width="100%"`;
  no negative coordinates (content in x≈40–640).
- Every connector `<path>` **must have `fill="none"`**. SVG text doesn't wrap — size boxes to fit or
  add `<tspan x dy="1.2em">` breaks; `dominant-baseline="central"` to center. Two sizes (14 / 12),
  0.5px strokes, one reusable arrowhead `<marker>`.

## Interactive explainer → self-contained HTML

HTML with an inline `<svg>` plus `<input type="range">`/buttons and **inline JS** that updates it
live — no external scripts. Persist chosen state to `localStorage` (the preview supports it).

## Deliver
Save the `.mmd` / `.png` / `.svg` / `.html` to the workspace; one line on what it shows. To revise,
edit the file.
