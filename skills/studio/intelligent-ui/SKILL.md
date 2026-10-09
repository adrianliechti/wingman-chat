---
name: intelligent-ui
description: "Render visual explanations and small interactive interfaces inline in a chat reply with a ```ui fence: drawings, calculators, charts, sortable tables and option buttons. Prefer for 'illustrate' or 'show me how it works' in an explanatory conversation without a file requirement. Use visualize, data-visualization or html-artifacts for a requested file/export or needs beyond inline components."
---

# Intelligent UI

A ```ui fence holds a JSON document that the app renders as native components with reactive state. The model chooses the interface; the app owns everything that runs. Read `references/components.md` for every component, prop, helper and action, and `references/examples.md` for complete documents.

## Choose the least complex presentation

Pick the simplest form that completely answers the request, including its requested visual format. Interaction earns its place only when it lets the user do something prose cannot: move an input, narrow data, pick one of several, or explore a structure. A requested illustration can use `svg` without controls when a static drawing is sufficient.

| The user wants to…                        | Use                                                              |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Understand or decide something            | Prose, with the answer first                                     |
| Compare a few fixed options               | A Markdown table                                                 |
| See how numbers in hand move or compare   | `chart`, with the takeaway stated in prose                       |
| Change an assumption and see the effect   | `slider` / `stepper` / `toggle` with `metric` and `computed`     |
| Enter several values that feed a result   | `input` controls plus a `metric` or `code`; no submit step       |
| Narrow or sort data from the conversation | `select` / `segmented` / `multiselect` filtering a `table`       |
| Switch between alternatives               | `segmented` or `tabs` with `visible` or looked-up content        |
| Pick one of several next steps            | `button` with `send`, one per option, or an `each` over the data |
| Follow a procedure or a plan              | `checklist`, `timeline`, or step cards with Back / Next          |
| See how parts of a thing relate           | `svg`, with a selector or slider when it aids understanding      |
| Keep, share or export the result          | An artifact, not a fence                                         |

Do not render a chart for one number, a form where one question would do, a card around plain text, or a control nothing reacts to. The prose must carry the answer on its own; the interface refines it.

## Inline interface or artifact

Decide by what the user keeps, not by how visual the request sounds.

Resolve short follow-ups from the conversation before choosing a skill. After "explain how a car works", "illustrate" normally calls for an inline drawing; a system selector can highlight parts and update their explanation. After a request for a printable handout, the same follow-up keeps that deliverable. Do not infer a file requirement from "illustrate", "diagram" or the use of SVG alone, and do not require the user to name this skill or explicitly ask for interactivity.

| Inline ```ui fence                                      | Artifact (`visualize`, `data-visualization`, `html-artifacts`, `build-dashboard`) |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| The interface is the answer; it explores one idea       | The interface is a deliverable: page, dashboard, app, file                        |
| Data is already in the conversation or a tool result    | Data lives in workspace files or needs SQL at runtime                             |
| Adjustments stay in the browser                         | Revisions, download, sharing, or later iteration matter                           |
| Fits one screen with the built-in components            | Needs custom layout, branding, libraries or several pages                         |
| "What if", "let me adjust", "compare these", "pick one" | "Build", "create a page/app/dashboard", "export", "file"                          |

Both can appear in one turn: a short inline explorer for the key figure, and an artifact when the user asked for one. When unsure, start inline; promoting to an artifact is one request away, while an artifact for a quick what-if is heavy.

Neighbouring skills draw the same boundary from their side: `visualize` owns saved conceptual diagrams, Mermaid and multi-view HTML explainers; `data-visualization` owns publication charts and chart files from measured data; `build-dashboard` owns coordinated views over workspace files. A single explorable `svg`, a quick `chart` of numbers in hand, or a filtered `table` belongs here.

## Writing a document

1. Decide the single question the interface answers, and which inputs the user should move.
2. Declare every bound key in `state` with a sensible default. Derive everything else in `computed`.
3. Pick the smallest component set: a `card` with controls and metrics is often enough. Use `grid` for metrics, `row` for related controls, `tabs` for alternatives. For "show me how X works" or "what are the parts of X", draw an `svg` whose parts respond to a `slider` (exploded view) or a `segmented` control (highlight one system) and pair it with a `text` that describes the selected part.
4. Format numbers (`format`, `currency`, `unit`) and label every control. Use `callout` for a caveat, not for decoration.
5. Give buttons a real effect: `set` to apply a preset, `reset`, or `send` to continue the conversation with the current values. Never render a button without an action.
6. Keep data honest: only numbers from the conversation or tools, explicitly labelled estimates, or values the user entered. An interface never fetches anything.
7. Close the fence and continue in prose: what the interface shows and what the user can change.

## Before emitting a fence

1. Would prose or a Markdown table satisfy both the question and the requested format? Then use that. A request to illustrate still needs a visual.
2. Every component, prop and helper exists in `references/components.md`; nothing is invented.
3. Every `bind` key is in `state`; everything derived is in `computed`; no expression calls a method or an unknown function.
4. Every control changes something visible; every button's label says what its action does.
5. Numbers are from the conversation, a tool, or the user, or they are captioned as illustrative.
6. The fence is valid JSON, closed, and followed by prose that states the key result.

## Constraints

- Only components, props and helpers listed in `references/components.md` exist. Unknown components show an inline error; unknown props are ignored.
- Emit strict JSON: no comments, trailing commas or `"a" + "b"` joins. Put expressions in `computed` strings or `{{ }}` prop templates; `visible` and `disabled` also accept bare expression strings.
- Expressions are not JavaScript: no assignment, functions, `new`, regular expressions, globals or method calls (`Math.round(x)` is tolerated and maps to `round`).
- State and props must be plain JSON. Keep documents under about 150 lines; large tables belong in artifacts.
- The user's adjustments are kept in their browser only; a later turn cannot read what the user changed unless a `send` button carried it.
- Voice conversations never render interfaces; use prose there.
