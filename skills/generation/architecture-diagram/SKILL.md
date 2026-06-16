---
name: architecture-diagram
description: Design a software/system architecture diagram (C4 context/container, or a sequence diagram) from the conversation and workspace material, delivered as an interactive Mermaid HTML diagram. Trigger with "draw the architecture", "create a C4 diagram", "diagram the system", "show a sequence diagram", or whenever the user wants a technical system visualized.
---

# Architecture Diagram

Design a clear technical architecture diagram. You write a self-contained Mermaid HTML file that
previews in the artifacts panel.

## 1. Gather the material

Source = **the conversation so far plus workspace files**. Identify the people/actors, systems and
containers (apps, services, datastores), their responsibilities and tech stack, and the
relationships (who calls whom, over what protocol).

## 2. Pick the kind and style

- **C4-style** (default) for structure — a Context or Container view. `read_skill` the
  `architecture-style-c4` skill for conventions.
- **Sequence diagram** when the user wants an interaction/message flow over time. `read_skill`
  `architecture-style-sequence`.

## 3. Modelling rules

- **Choose one view and one level** — don't mix a context diagram with deep component internals.
- **Label every relationship** with what it does and how ("reads via REST", "publishes to Kafka").
- **Name the tech** on containers where known ("PostgreSQL", "React SPA").
- **Group boundaries** (a system boundary, a deployment node) make the diagram readable.
- Where the source is silent, infer sensibly and **mark inferred elements** so the user can review.

## 4. Build it with Mermaid in HTML

**Container/context (flowchart):**

```python
mermaid = """flowchart LR
  user([Customer]) --> spa[Web App<br/>React SPA]
  spa -->|REST/JSON| api[API Service<br/>Go]
  api -->|SQL| db[(PostgreSQL)]
  api -->|publish| bus[[Event Bus<br/>Kafka]]
  bus --> worker[Billing Worker<br/>Go]
"""
```

**Sequence:**

```python
mermaid = """sequenceDiagram
  participant U as Customer
  participant A as API
  participant D as Database
  U->>A: POST /orders
  A->>D: INSERT order
  D-->>A: ok
  A-->>U: 201 Created
"""
```

Wrap either in a single self-contained `architecture.html` that loads Mermaid from CDN (the
artifacts preview runs scripts and has network access):

```python
doc = """<!doctype html><html><head><meta charset="utf-8"><title>Architecture</title>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>
<pre class="mermaid">__MM__</pre>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({startOnLoad:true,flowchart:{htmlLabels:true}});
</script></body></html>"""
with open("architecture.html","w") as f:
    f.write(doc.replace("__MM__", mermaid))
print("wrote architecture.html")
```

Escape `&`, `<`, `>` in labels. Datastores use `[( )]`; queues `[[ ]]`.

## 5. Deliver

Tell the user the diagram is ready and flag any inferred elements. Offline fallback: emit an
`.svg`.
