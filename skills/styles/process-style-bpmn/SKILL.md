---
name: process-style-bpmn
description: Process diagram style — Standard banking / insurance notation — pools, lanes, gateways, events. Use when generating a process diagram in the "BPMN 2.0" style (id: bpmn).
---

# BPMN 2.0 — process diagram style

## Style: BPMN 2.0 — strict notation

This is the canonical BPMN 2.0 diagram. It is the notation an internal audit / process-engineering function will recognise on sight in a regulated bank. **Lean into the BPMN vocabulary** — a diagram that looks like a generic flowchart is the failure mode for this style.

Conventions:
- **Pools = organisations** (e.g. "Bank", "Customer", "Correspondent Bank"). Lanes within a pool = roles. For a single-org process, use one pool and lanes per role/system.
- Use `start` for the *triggering event*, `end` for *terminating outcomes*. **Name every end event with its specific outcome** (`end_approved`, `end_rejected`, `end_manual_review_queued`, `end_sla_breach`) — never just "End".
- Use `decision` for **exclusive gateways (XOR)** — exactly one outgoing branch is taken. Every outgoing edge MUST be labelled with the gate condition ("amount ≥ €100k", "KYC risk = high", "approved").
- Use `parallel` for **parallel gateways (AND)** — fan out work that must run concurrently AND be joined again. **A parallel split must be matched by a parallel join further down** — never let parallel branches end without joining.
- Use `event` for **intermediate events** — these are a BPMN signature. Demand at least 1 in a diagram of meaningful size: timer waits ("Wait 5 business days for documents"), message receipts ("Customer responds"), boundary events ("SLA timer breached").
- Use `subprocess` for **collapsed sub-processes** (`subprocess_credit_check`, `subprocess_aml_screening`) that are documented separately.
- Use `data` for **systems of record** (Core Banking, GL, CRM, Document Archive) — keep in a dedicated *Systems* lane at the bottom.
- Cross-lane edges = **hand-offs**. Cross-pool edges = **message flows** (`flow: "message"`). All other flows are `sequence`.

BPMN signature elements to demand:
- ≥ 1 `parallel` split with matching join, OR ≥ 1 `event` (timer or message), OR both. **A BPMN diagram with no events and no parallel gateways is not BPMN — it's a swimlane flowchart.**
- Every exception path explicitly modelled as its own labelled branch ending at a dedicated `end_*` node.

Naming:
- Tasks: verb-object ("Validate IBAN", "Generate SWIFT MT103").
- Decisions: pose as a **question** ("KYC risk = high?", "Amount ≥ threshold?", "Documents complete?"). The question form is BPMN convention.
- End events: outcome-named (`end_onboarding_completed`, `end_application_rejected`, `end_manual_review_queued`).

The audience for a BPMN diagram is an auditor — they look for what happens when the happy path fails. **Model every exception path explicitly**.
