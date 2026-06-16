---
name: mind-map
description: Build a hierarchical mind map of the concepts in the conversation and workspace material, delivered as a Mermaid diagram (.mmd) that renders natively in the side panel. Trigger with "make a mind map", "map out these concepts", "give me a concept map", or whenever the user wants the structure of a topic visualized.
---

# Mind Map

Visualize how the key concepts relate as a hierarchical map. Write a `.mmd` file (Mermaid source); the
drawer renders it natively — **offline, no internet needed**.

## 1. Gather the material

Source = **the conversation so far plus workspace files**. The root node is the central theme;
capture the real hierarchy from the material.

## 2. Structure it

- One **root** = the central topic.
- **4–7 main branches** for the key themes.
- **2–5 sub-topics** per branch, nesting deeper only where it adds meaning.
- Labels are concise (1–6 words).

## 3. Write it as Mermaid (.mmd)

```python
mindmap = """mindmap
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
with open("mindmap.mmd", "w") as f:
    f.write(mindmap)
print("wrote mindmap.mmd")
```

Indentation defines the hierarchy — keep it consistent. Avoid characters Mermaid treats specially in
labels (or wrap them in quotes).

## 4. Deliver

Tell the user the mind map is ready in the workspace. To revise, edit the `.mmd` file.
