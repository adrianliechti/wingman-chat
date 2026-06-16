---
name: process-diagram
description: Design a process / workflow diagram (swimlane / BPMN-style flow) from the conversation and workspace material, delivered as a Mermaid `.mmd` diagram that renders natively in the panel. Trigger with "map this process", "draw the workflow", "create a swimlane diagram", "model this as BPMN", or whenever the user wants a business/operational process visualized.
---

# Process Diagram

Design a disciplined process flow — not a sketch. You are acting as a business analyst: produce a
diagram a process-owner or control function would accept. You write a Mermaid `.mmd` file that renders
natively in the panel (offline).

## 1. Gather the material

Source = **the conversation so far plus workspace files**. Locate the roles, systems of record,
triggering events, decision points and their criteria, controls/approvals, hand-offs, and
exception paths.

## 2. Pick a framework and style

Default to **BPMN-style swimlanes** — one lane per role/system, tasks as verb-phrases, gateways for
decisions. If the user named a framework (ITIL, SDLC, three lines of defence, swimlane), follow its
lane conventions.

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

## 4. Write it as Mermaid (.mmd)

Use a `flowchart` with one `subgraph` per lane, and write it to a `.mmd` file — the drawer renders it
natively, **offline**.

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
with open("process.mmd", "w") as f:
    f.write(mermaid)
print("wrote process.mmd")
```

Use stable node ids; escape `&`, `<`, `>` in labels (`&amp;` etc.). Decision nodes use `{ }`;
start/end use `([ ])`.

## 5. Deliver

Tell the user the diagram is ready and call out anything you marked as inferred so they can refine
it. To revise, edit the `.mmd`.
