## Style: Three Lines of Defence (3LoD)

Banks, insurers, and asset managers use the **3LoD model** (IIA position paper, BCBS guidance) to demonstrate independent risk oversight. The diagram is governance-first: it should make a Board / Risk Committee reviewer immediately see where the *independent challenge* happens.

## Lane structure — exactly three lanes in this order (non-negotiable)

Use **exactly** these three lanes, in this order, no more and no less:

1. `1st_line` — **1st Line — Business / Operations** (the risk owner — front office, operations, IT delivery).
2. `2nd_line` — **2nd Line — Risk & Compliance** (independent risk management, compliance, model risk, security).
3. `3rd_line` — **3rd Line — Internal Audit** (independent assurance).

The renderer colours these lanes as a risk traffic light (1L blue / 2L amber / 3L red) based on **lane index**, so adding a fourth lane in front or in between breaks the colour mapping. **Do not** add a *Customer*, *External*, *Executive*, or *Board* lane — model those actors as `start` events, `end` events, or external escalation arrows leaving the 3rd-Line lane, not as their own lanes.

Customer-facing triggers: model as a `start` node in the 1st-Line lane labelled "Customer raises …" or similar — no Customer lane.
Board escalations: model as a labelled edge from a 2nd-Line or 3rd-Line node to an `end` node named `end_escalated_to_board` — no Board lane.

## Discipline

- **Reviews and approvals belong in the reviewing function's lane, not the requester's.** This is the whole point of the model. If the 2nd Line reviews a 1st-Line decision, the review task sits in the 2nd-Line lane, with a cross-line edge in.
- Every **cross-line edge** is significant — it represents a hand-off between lines of defence (a challenge, an escalation, an audit finding, a sign-off). Label them precisely ("Escalate exception", "Independent challenge", "Audit finding raised", "Remediation accepted").
- Use `decision` for **control gates** at the line boundaries:
  - 1L self-check ("Risk within appetite?")
  - 2L challenge ("2nd Line accepts the assessment?")
  - 3L audit finding ("Audit finding raised?" → "Yes" / "No finding")
- **Every independent control activity is a `task` with `control` set** to the framework reference. Examples:
  - `control: "2LoD challenge — pricing model"`
  - `control: "2LoD compliance attestation"`
  - `control: "3LoD audit — KYC sampling"`
  - `control: "BCBS 239 — data quality assurance"`
  - `control: "SR 11-7 — model validation"`
- Use `event` for periodic / scheduled triggers ("Quarterly attestation due", "Annual audit cycle starts").
- Use `data` for shared records: risk register, control library, audit findings tracker, model inventory. Place these in a *Systems* row if you add a Systems lane, otherwise reference inline.

## End nodes — name by governance outcome

- `end_risk_accepted_within_appetite`
- `end_remediation_in_progress`
- `end_finding_raised`
- `end_escalated_to_risk_committee`
- `end_escalated_to_board`
- `end_issue_closed`

## Signature elements (demand all three)

1. **A 2L challenge step** explicitly modelled as a 2nd-Line task — without this, the diagram isn't 3LoD.
2. **A 3L audit finding decision** with both "Finding raised" and "No finding" branches.
3. **At least one escalation** crossing two line boundaries (e.g. 1L → 2L → Board) when the domain involves heightened risk.

Use this style when the source emphasises **governance, segregation, regulatory oversight, or audit findings** rather than transaction processing. If the source is mainly a transaction flow with a single approver, BPMN or Swimlane will look better — point the user there.
