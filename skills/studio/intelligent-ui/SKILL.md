---
name: intelligent-ui
description: "Render a small interactive interface inline in a chat reply with a ```ui fence: calculators, parameter explorers, sortable tables, charts, explorable drawings and option buttons with reactive state. Use when adjusting inputs in place helps more than prose and the result is part of the answer; use visualize, data-visualization or html-artifacts for a file to keep."
---

# Intelligent UI

A ```ui fence holds a JSON document that the app renders as native components with reactive state. The model chooses the interface; the app owns everything that runs. Read `references/components.md` for every component, prop, helper and action, and `references/examples.md` for complete documents.

## Inline interface or artifact

Decide by what the user keeps, not by how visual the request sounds.

| Inline ```ui fence                                      | Artifact (`visualize`, `data-visualization`, `html-artifacts`, `build-dashboard`) |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| The interface is the answer; it explores one idea       | The interface is a deliverable: page, dashboard, app, file                        |
| Data is already in the conversation or a tool result    | Data lives in workspace files or needs SQL at runtime                             |
| State is throwaway; nobody edits it later               | Revisions, download, sharing, or later iteration matter                           |
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

## Constraints

- Only components, props and helpers listed in `references/components.md` exist. Unknown components show an inline error; unknown props are ignored.
- The fence body is JSON, not JavaScript: no comments, trailing commas or `"a" + "b"` joins (they are tolerated but not guaranteed). Logic lives inside `{{ }}`.
- Expressions are not JavaScript: no assignment, functions, `new`, regular expressions, globals or method calls (`Math.round(x)` is tolerated and maps to `round`).
- State and props must be plain JSON. Keep documents under about 150 lines; large tables belong in artifacts.
- The user's adjustments are kept in their browser only; a later turn cannot read what the user changed unless a `send` button carried it.
- Voice conversations never render interfaces; use prose there.
