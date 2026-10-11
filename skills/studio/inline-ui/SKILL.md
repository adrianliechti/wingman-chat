---
name: inline-ui
description: "Create native A2UI interfaces in chat: explanations, drawings, calculators, charts, tables and choices. Use for an 'illustrate' follow-up without a file requirement. Requested files/exports, apps and workspace analysis belong in artifact skills."
---

# Inline UI

Render small interfaces in `ui` fences using Wingman's pinned A2UI contract. Explain the result in prose, then add controls or a drawing when they help the user explore it. Use `ask_questions` for blocking clarification. Use `visualize`, `data-visualization` or `html-artifacts` for requested deliverables or needs beyond the native components.

## Look up only what you need

Read [protocol.md](references/protocol.md) before the first surface, unless it is already in context. Then select references by the components/functions you need. Use `read_skill_resource` with `{"skill":"inline-ui","path":"references/data.md"}`, for example. Each read returns the whole file; reuse loaded guidance and avoid loading all references.

| Need                                                                                              | Reference                                            |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Message envelopes, bindings, repeated children, updates, actions, setValue/openUrl/copyText       | [protocol.md](references/protocol.md)                |
| Row/Column/Grid, Card/Tabs/Modal/Collapsible, Text/Heading, Svg/Html, icons, media, badges, lists | [layout.md](references/layout.md)                    |
| Button, text/date/number inputs, checkboxes, single/multiple choices, Form and validators         | [controls.md](references/controls.md)                |
| Chart/Table, Metric, Progress, Timeline, KeyValue                                                 | [data.md](references/data.md)                        |
| Calculations, filtering, sorting, aggregations, interpolation, formatting and boolean logic       | [functions.md](references/functions.md)              |
| Small calculator and surface update examples                                                      | [examples.md](references/examples.md)                |
| Complete chart/table dashboard                                                                    | [dashboard.json](references/examples/dashboard.json) |
| Complete form with live preview and calculated budget                                             | [planner.json](references/examples/planner.json)     |

The grouped signatures are generated from the installed schemas. The large [Basic catalog](references/basic-catalog.json) and [Wingman catalog](references/wingman-catalog.json) JSON files are for exact schema/debugging lookups only, when a focused reference leaves a question unanswered.

## Before emitting

Use only documented properties and resolve every child ID. Bind writable controls to data paths and make each control affect something visible. Give chart axes units and sources; values come from the conversation, tools, user input, or labelled illustrative assumptions. For updates, reuse the surface ID and preserve component IDs. Local data edits stay in the browser until an action explicitly sends them to the agent.
