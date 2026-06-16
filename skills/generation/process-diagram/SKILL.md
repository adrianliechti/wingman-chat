---
name: process-diagram
description: Design a process / workflow diagram (swimlane / BPMN-style flow) from the conversation and workspace material, delivered as an interactive Mermaid HTML diagram. Trigger with "map this process", "draw the workflow", "create a swimlane diagram", "model this as BPMN", or whenever the user wants a business/operational process visualized.
---

# Process Diagram

Design a disciplined process flow — not a sketch. You are acting as a business analyst: produce a
diagram a process-owner or control function would accept. You write a self-contained Mermaid HTML
file that previews in the artifacts panel.

## 1. Gather the material

Source = **the conversation so far plus workspace files**. Locate the roles, systems of record,
triggering events, decision points and their criteria, controls/approvals, hand-offs, and
exception paths.

## 2. Pick a framework and style

Default to **BPMN-style swimlanes**. If the user named a framework ("ITIL", "SDLC", "three lines
of defence", "swimlane"), `read_skill` the matching `process-style-*` skill and follow its lane
conventions.

## 3. Modelling rules (non-negotiable)

- **Exactly one start** (a named trigger) and **at least one explicit end** (happy path, reject,
  exception — none dangling).
- **Every decision is a question with ≥ 2 labelled outgoing edges** ("amount ≥ €100k?" → "yes" /
  "no"). Unlabelled decision edges are a bug.
- **Tasks are verb-phrases** naming an actor's action ("Validate IBAN", "Approve credit limit").
- **One actor per task**, placed in that role's lane. Hand-offs are edges crossing lanes — the most
  valuable thing in the diagram; make them explicit.
- **Controls are first-class.** Model four-eye checks, segregation of duties, and regulatory
  checkpoints as their own steps; note the framework reference (e.g. "SOX 404", "KYC/AML").
- **Compact:** aim for 8–25 nodes; encapsulate big sub-flows rather than expanding everything.
- **Design-first with traceability:** where the source is silent, fill in what a senior analyst
  would draw, and **mark synthesized steps** (prefix the label or add a note with "inferred") so
  the user can review them.

## 4. Build it with Mermaid in HTML

Use a `flowchart` with one `subgraph` per lane. Write a single `process.html` (Mermaid from CDN —
the artifacts preview runs scripts and has network access):

```python
mermaid = """flowchart TB
  subgraph Customer
    start([Customer submits application]) --> rcv
  end
  subgraph Operations
    rcv[Validate documents] --> kyc{KYC risk = high?}
    kyc -- no --> approve[Approve onboarding]
    kyc -- yes --> review
  end
  subgraph "Risk &amp; Compliance"
    review[Enhanced due diligence<br/>control: KYC/AML] --> ok{Cleared?}
    ok -- yes --> approve
    ok -- no --> reject([End: rejected])
  end
  approve --> done([End: onboarded])
"""

doc = """<!doctype html><html><head><meta charset="utf-8"><title>Process</title>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body>
<pre class="mermaid">__MM__</pre>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({startOnLoad:true,flowchart:{htmlLabels:true}});
</script></body></html>"""

with open("process.html", "w") as f:
    f.write(doc.replace("__MM__", mermaid))
print("wrote process.html")
```

Use stable node ids; escape `&`, `<`, `>` in labels (`&amp;` etc.). Decision nodes use `{ }`;
start/end use `([ ])`.

## 5. Deliver

Tell the user the diagram is ready and call out anything you marked as inferred so they can refine
it. Offline fallback: emit an `.svg`.
