---
label: "Swimlane"
description: "Role-based flowchart that makes cross-team hand-offs explicit"
---

## Style: Swimlane Flowchart — hand-offs first

This is the **role-based** view. The point of the diagram is to make every **hand-off between roles** explicit — that's where ambiguity and failure live in a corporate process. The shape of the diagram should make a non-technical reader say "ah, that step crosses three teams".

Conventions:
- **One lane per role** — a team, a committee, a customer-facing function, or a system. Typical corporate lanes:
  *Customer · Front Office · Middle Office · Back Office · Risk · Compliance · IT / Operations · Systems*.
  Pick the subset that matches the sources.
- **Place each task in the lane of the person/system that performs it.** Reviews and approvals belong in the reviewer's lane, NOT the requester's. Approvals crossing into a different lane is the whole point of the diagram.
- `decision` nodes belong in the lane of the role making the call.
- Use `data` nodes for systems read/written during a step. Keep them in their own *Systems* lane at the bottom; arrows touch the consuming task.
- Use `event` sparingly — swimlane diagrams aren't BPMN. Reach for `event` only for genuine wait states (escalations, SLA breaches).

Swimlane signature: **maximise cross-lane edges.** Every cross-lane edge should be a meaningful hand-off, not an accident. Where the source describes a sequence of single-role steps, prefer to consolidate them into one task rather than padding the lane with trivial activities — the diagram earns its keep through the hand-offs it shows.

Naming:
- Tasks: imperative verb-phrase, ≤ 6 words ("Approve credit limit", "Post journal entry", "Send notification to customer").
- Decisions: short question, branches labelled with the outcome ("Within delegated authority?" → "Yes" / "No, escalate").

Always include the **exception / escalation path** — a swimlane that only shows the happy path tells you nothing about how the org actually works.

Compared to BPMN: this style uses **fewer events and gateways**. Tasks + decisions + hand-offs are the vocabulary. If the source genuinely demands timer events or parallel forks, the user should pick BPMN; this style stays clean and role-centric.
