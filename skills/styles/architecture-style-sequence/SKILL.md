---
name: architecture-style-sequence
description: Architecture diagram style — UML sequence — actors and ordered messages for one flow. Use when generating a architecture diagram in the "Sequence" style (id: sequence).
---

# Sequence — architecture diagram style

## Style: UML Sequence

Draw a **UML sequence diagram** for one end-to-end interaction. The audience is engineers reviewing the design of a specific flow. **Pick the flow that best illustrates the architecture** — usually the canonical happy path with one important branch (validation failure, retry, fallback).

Set `kind: "sequence"`.

Use these element kinds:
- `actor` — participants in the interaction: human users, applications, services, queues, databases, external systems. Order them **left-to-right by their first appearance** in the flow.

Each relation is a message between two actors:
- `source`, `target` = sender and receiver actor ids.
- `kind` = `"message"` for outbound calls, `"response"` for returns.
- `label` = the method / event / command name as an engineer would write it: `POST /onboarding/applications`, `placeOrder(orderId, customerId)`, `OrderPlaced event`, `SELECT * FROM accounts WHERE …`.
- `technology` = the transport when crossing a process boundary: `HTTPS/JSON`, `gRPC`, `AMQP`, `JDBC`, `Kafka topic onboarding.events`.
- `order` = **mandatory** integer ordinal (1, 2, 3, …) controlling the vertical position of the message.

Design discipline:
- **5–12 actors max.** If you can't fit the flow in this many, pick a smaller flow.
- **8–18 messages.** Fewer is better. Drop boilerplate (auth handshakes, health checks) unless the flow is *about* them.
- Default to **synchronous request/response** for HTTP calls (a `message` followed by a `response`); use bare `message` for async events / fire-and-forget.
- For DB calls, model the database as one `actor` and use `message` + `response` (label the response with the row count or "ok").
- Errors / branches: show **one** important alternate path inline — e.g. "validation fails → error response → end". For complex branching, do a separate sequence diagram.
- Name actors at the **system** level, not the persona level, unless a human is genuinely in the loop ("Customer" only if they actively send a message during the flow).

Do **not** use `person`, `system`, `external-system`, `container`, `component`, `deployment-node`, or `entity` in this style. Use only `actor`.

Mark inferred messages when the source says "the system validates the input" but doesn't say how — set `inferred: true` on the messages you propose to fulfil that abstract description.
