---
name: process-diagram
description: Design a process / workflow diagram (swimlane / BPMN-style flow) from the conversation and workspace material, delivered as a Mermaid `.mmd` diagram that renders natively in the panel. Trigger with "map this process", "draw the workflow", "create a swimlane diagram", "model this as BPMN", or whenever the user wants a business/operational process visualized.
---

# Process Diagram

Design a disciplined process flow — not a sketch. You are acting as a business analyst: produce a
diagram a process-owner or control function would accept. You write a Mermaid `.mmd` file that renders
natively in the panel (offline).

## 1. Gather the material

Locate the roles, systems of record, triggering events, decision points and their criteria,
controls/approvals, hand-offs, and exception paths.

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
- **Style by function, not lane order:** use a small `classDef` set for action, decision, control, and
  outcome nodes. Keep risk/control colors semantically consistent.

## 4. Write it as Mermaid (.mmd)

Use a `flowchart` with one `subgraph` per lane, and write it to a `.mmd` file — the drawer renders it
natively, **offline**.

```mermaid
flowchart TB
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
  classDef action fill:#e4f4f0,stroke:#168779,color:#17332f
  classDef decision fill:#fff0e8,stroke:#d96846,color:#4b2b22
  classDef outcome fill:#f1ecfb,stroke:#7659a3,color:#322747
  class rcv,review,approve action
  class kyc,ok decision
  class start,reject,done outcome
```

Pass the Mermaid source directly to `create_file` as `/process.mmd`; do not write a Python wrapper
for a text artifact. The drawer renders it natively, **offline**.

Use stable node ids. Quote labels containing punctuation; use `<br/>` only for an intentional visual
line break and `&amp;` only when a literal ampersand must appear in a flowchart label. Prefer plain
words such as "at least" or "under" over angle-bracket comparisons. Decision nodes use `{ }`;
start/end use `([ ])`. The file tool validates `.mmd` syntax; fix any reported parser error before
finishing.

## 5. Deliver

Tell the user the diagram is ready and call out anything you marked as inferred so they can refine
it. To revise, edit the `.mmd`.
