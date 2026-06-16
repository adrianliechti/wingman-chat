---
name: mind-map
description: Build a hierarchical mind map of the concepts in the conversation and workspace material, delivered as an interactive diagram (HTML/Mermaid, with an SVG/Markdown fallback). Trigger with "make a mind map", "map out these concepts", "give me a concept map", or whenever the user wants the structure of a topic visualized.
---

# Mind Map

Visualize how the key concepts relate as a hierarchical map. You write a self-contained HTML file
that renders the map with Mermaid; it previews directly in the artifacts panel.

## 1. Gather the material

Source = **the conversation so far plus workspace files**. The root node is the central theme;
capture the real hierarchy from the material.

## 2. Structure it

- One **root** = the central topic.
- **4–7 main branches** for the key themes.
- **2–5 sub-topics** per branch, nesting deeper only where it adds meaning.
- Labels are concise (1–6 words).

## 3. Build it with Mermaid in HTML

Mermaid's `mindmap` renders a clean radial tree. Write a single `mindmap.html` (Mermaid loaded
from CDN — the artifacts preview runs scripts and has network access):

```python
mermaid = """mindmap
  root((FY24 Review))
    Revenue
      Enterprise +38%
      Mid-market +2%
    Retention
      Net retention 121%
      Logo churn down
    Risks
      Sales cycle length
      Concentration
"""

doc = """<!doctype html><html><head><meta charset="utf-8"><title>Mind Map</title>
<style>body{margin:0}#m{font-family:system-ui,sans-serif}</style></head><body>
<pre class="mermaid" id="m">__MM__</pre>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({startOnLoad:true});
</script></body></html>"""

with open("mindmap.html", "w") as f:
    f.write(doc.replace("__MM__", mermaid))
print("wrote mindmap.html")
```

Indentation defines the hierarchy — keep it consistent. Avoid characters Mermaid treats specially
in labels (or wrap them).

## 4. Deliver

Tell the user the mind map is ready in the workspace. **Offline fallback:** if the preview can't
reach the CDN, write a `mindmap.svg` (hand-authored SVG radial tree) or a nested-bullet
`mindmap.md` instead.
