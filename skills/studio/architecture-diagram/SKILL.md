---
name: architecture-diagram
description: Design a software/system architecture diagram (C4 context/container, or a sequence diagram) from the conversation and workspace material, delivered as a Mermaid `.mmd` diagram that renders natively in the panel. Trigger with "draw the architecture", "create a C4 diagram", "diagram the system", "show a sequence diagram", or whenever the user wants a technical system visualized.
---

# Architecture Diagram

Design a clear technical architecture diagram. You write a Mermaid `.mmd` file that renders natively
in the panel (offline).

## 1. Gather the material

Identify the people/actors, systems and containers (apps, services, datastores), their
responsibilities and tech stack, and the relationships (who calls whom, over what protocol).

## 2. Pick the kind and style

- **C4-style** (default) for structure — a Context or Container view: people → systems → containers,
  each labelled with its responsibility and tech.
- **Sequence diagram** when the user wants an interaction/message flow over time.

## 3. Modelling rules

- **Choose one view and one level** — don't mix a context diagram with deep component internals.
- **Label every relationship** with what it does and how ("reads via REST", "publishes to Kafka").
- **Name the tech** on containers where known ("PostgreSQL", "React SPA").
- **Group boundaries** (a system boundary, a deployment node) make the diagram readable.
- **Use 3–4 semantic classes** (people, applications, data/infrastructure, external systems) with a
  subject-derived palette. Do not leave every node on Mermaid defaults.
- Where the source is silent, infer sensibly and **mark inferred elements** so the user can review.

## 4. Write it as Mermaid (.mmd)

**Container/context (flowchart):**

```mermaid
flowchart LR
  user([Customer]) --> spa[Web App<br/>React SPA]
  spa -->|REST/JSON| api[API Service<br/>Go]
  api -->|SQL| db[(PostgreSQL)]
  api -->|publish| bus[[Event Bus<br/>Kafka]]
  bus --> worker[Billing Worker<br/>Go]
  classDef person fill:#fff0e8,stroke:#d96846,color:#4b2b22
  classDef app fill:#e4f4f0,stroke:#168779,color:#17332f
  classDef infra fill:#f1ecfb,stroke:#7659a3,color:#322747
  class user person
  class spa,api,worker app
  class db,bus infra
```

**Sequence:**

```mermaid
sequenceDiagram
  participant U as Customer
  participant A as API
  participant D as Database
  U->>A: POST /orders
  A->>D: INSERT order
  D-->>A: ok
  A-->>U: 201 Created
```

Pass the chosen Mermaid source directly to `create_file` as `/architecture.mmd`; do not write a
Python wrapper for a text artifact. The drawer renders it natively, **offline**.

Mermaid grammars differ. For flowcharts, quote labels containing punctuation and use `<br/>` only
for intentional label breaks. For sequence diagrams, keep message and note text plain: write "and",
"under", or "at least" instead of HTML entities or angle-bracket comparisons; reserve `<br/>` for a
participant alias that truly needs two lines. Keep `alt`/`opt`/`loop` nesting shallow. Datastores use
`[( )]`; queues `[[ ]]`. The file tool validates `.mmd` syntax, so fix any reported parser error
before finishing.

## 5. Deliver

Tell the user the diagram is ready and flag any inferred elements. Offline fallback: emit an
`.svg`.
