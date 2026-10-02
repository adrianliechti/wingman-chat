---
name: html-artifacts
description: "Create or edit HTML artifacts using bundled browser libraries, preview SDK services or workspace SQL, and prepare standalone exports. Use for runtime integration rather than visual design advice."
---

# HTML artifact runtime

HTML artifacts run in a browser preview with same-origin access to companion workspace files. Reference local images, CSS, scripts and datasets by relative path; keep static content editable as HTML.

Read only the reference needed for the task:

- [libraries.md](references/libraries.md): bundled ECharts, Three.js, Lucide, Tailwind, daisyUI and Alpine loading/global APIs.
- [sdk.md](references/sdk.md): `window.wingman` files, per-artifact state, AI/media helpers and enabled chat tools.
- [duckdb.md](references/duckdb.md): workspace SQL, connections, data formats, result limits and a query example.

Use `read_skill_resource` with skill `html-artifacts` and the reference path. These are browser APIs, separate from interpreter globals.

Choose delivery from the request:

- **Preview:** relative workspace assets, bundled libraries and capability-checked SDK calls.
- **Folder export:** referenced bundled libraries are included; the preview SDK and its services are unavailable outside Wingman.
- **Standalone HTML:** single-file download contains only stored HTML. Embed needed data/authored assets and use native HTML/CSS/JavaScript/SVG; do not rely on preview URLs or services.

Detect capabilities, handle rejected operations, and show a useful unavailable state or local fallback. Do not present a nonfunctional export as fully working. For state, prefer the preview's per-artifact store when available; persistence is optional.

Verify loading, resizing and the primary interaction in the intended environment where tools permit. Inspect code and report untested behavior otherwise.
