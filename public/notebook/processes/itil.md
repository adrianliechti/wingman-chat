## Style: ITIL / ITSM — change, incident, problem, or request flow

This is the view an IT Risk / SOX ITGC auditor expects. The diagram should look unmistakably like an ITIL process — **priority classification, CAB approval, and rollback decisions are not optional**.

Conventions:
- **Default lanes (drop unused, do not invent new ones)**:
  *Requester · Service Desk (L1) · Tech Team (L2/L3) · Change Advisory Board (CAB) · Change / Problem Manager · Operations / SRE · Systems*.
- Use `start` for the triggering event named in ITIL terms: "Ticket raised", "Monitoring alert fired", "Scheduled maintenance window opens", "Standard change requested".
- **Mandatory decision nodes for change-flow diagrams** (include at least these three):
  1. `decision_priority` — "Priority classification: P1 / P2 / P3 / P4?" — typically as a multi-way decision.
  2. `decision_cab_approval` — "CAB approved?" with explicit "Approved" / "Rejected" / "Deferred" branches. Always model this in the CAB lane.
  3. `decision_change_successful` — "Change successful?" post-implementation, branching to *Close* / *Roll back*.
- Use `event` for waiting states ("Awaiting user response", "Awaiting vendor", "Change window open"). ITIL flows often have these — model them.
- Use `data` for the ITSM tooling (ServiceNow, Jira Service Management, BMC Remedy) and the CMDB. Reference them on the tasks that read/write the ticket.
- Use `subprocess` for "Implement change" when the implementation detail would distract from the governance flow (`subprocess_implement_change`, `subprocess_post_implementation_review`).
- End nodes named after ITIL outcomes: `end_closed_resolved`, `end_closed_rejected`, `end_closed_duplicate`, `end_rolled_back`, `end_escalated_to_problem_management`.

Controls to make explicit (model each as a `task` with `control` set):
- **Segregation of duties** between developer / approver / deployer (SOX ITGC).
- **Evidence capture**: ticket linked to change record, change linked to release, release linked to deployment.
- **Post-implementation review** for normal / emergency changes.
- For incident flow: **Major Incident Review** as its own task with `control: "ITIL — Major Incident Review"`.

Naming:
- Tasks: ITIL verbs — "Classify priority", "Perform impact assessment", "Schedule change window", "Implement change", "Verify in production", "Update CMDB", "Close ticket".
- Decisions: "Standard change?", "CAB approved?", "Change successful?", "Within SLA?".

The signature element auditors look for: **the CAB approval gate, explicitly modelled, in a lane named CAB / Change Advisory Board**. A change-management diagram without this is failing the test.
