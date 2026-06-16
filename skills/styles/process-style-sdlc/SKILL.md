---
name: process-style-sdlc
description: Process diagram style — Requirements → design → build → release → operate, with SOX gates. Use when generating a process diagram in the "SDLC" style (id: sdlc).
---

# SDLC — process diagram style

## Style: Software Development Lifecycle (SDLC)

The view that maps to how regulated enterprises document SDLC for SOX ITGC, model risk management (SR 11-7), or vendor / third-party software risk reviews. The diagram should **read by stage** — a reviewer can point at any task and say which SDLC stage it belongs to.

Conventions:
- **Default lanes** (drop unused, do not invent new ones):
  *Business / Product Owner · Architecture / Solution Design · Engineering · QA · Security & Compliance · Release / Change Management · Operations / SRE · Systems*.
- **Stages, in order**:
  1. **Requirements** — capture user stories, acceptance criteria.
  2. **Design** — architecture review, threat model.
  3. **Build** — implementation, code review.
  4. **Test** — unit + integration + regression.
  5. **Security review** — SAST/DAST, threat model exit.
  6. **UAT** — business sign-off.
  7. **Release approval** — CAB / release-train approval.
  8. **Deploy** — production rollout.
  9. **Operate** — monitoring, runbooks, incident response.
  10. **Decommission** (when applicable).

**Prefix every task's description with its stage**, format `(stage: build) ...` — e.g. `(stage: design) Run architecture review` / `(stage: test) Execute regression suite` / `(stage: deploy) Promote artifact to production`. This is the SDLC signature — without it the diagram could be any change flow.

- **Stage gates** — every transition between stages MUST be a `decision` node with explicit pass/fail branches. Required gates:
  - `decision_arch_review` — "Architecture review approved?"
  - `decision_threat_model` — "Threat model passed?"
  - `decision_qa_exit` — "All severity-1 defects fixed?" (QA exit criteria)
  - `decision_uat_signoff` — "UAT sign-off by business?"
  - `decision_release_approval` — "Release approved by CAB / Release Train?"
- **Controls** — model these as `task` nodes with `control` set:
  - `"SOX ITGC — Change Management"` on the release-approval task
  - `"SR 11-7 — Model Validation"` if a model is involved
  - `"GDPR DPIA"` if personal data is in scope
  - `"OWASP ASVS"` on the security-review task
- Use `data` for the SDLC tooling and evidence stores: Jira ticket, Git PR, CI run, SAST/DAST report, artifact registry, change ticket, runbook in Confluence.
- Use `subprocess` for sub-flows that distract from the main SDLC arc (`subprocess_incident_response`, `subprocess_hotfix`).
- **Distinct end nodes**: `end_released_to_production`, `end_cancelled_in_requirements`, `end_failed_uat_back_to_engineering`, `end_failed_security_review`, `end_decommissioned`.

Naming:
- Tasks: "Draft user stories" (stage: requirements), "Perform threat model" (stage: design), "Run unit tests" (stage: test), "Run SAST scan" (stage: security), "Sign off UAT" (stage: uat), "Deploy to production" (stage: deploy).
- Decisions: pose as a question and label branches with the gate outcome ("Pass" / "Fail", "Approved" / "Rejected").

This style is the right pick when the source describes how *software changes get from idea to production*. The reviewer can tell at a glance which stage every step belongs to because of the `(stage: ...)` prefix.
