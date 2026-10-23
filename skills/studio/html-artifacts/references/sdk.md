# Preview SDK: window.wingman

The preview injects `window.wingman` before page scripts. Never fetch it from a URL. Downloaded pages do not receive it. All methods below are async and reject with Error; handle failures in the UI.

Feature-detect the specific capability before each operation. Capabilities may change during the document's lifetime:

```javascript
const w = window.wingman;
if (w?.capabilities.files) {
  try {
    const rows = await w.files.readJSON("/data/rows.json");
    // Validate the expected shape, then update the view.
  } catch (error) {
    // Show the error and keep controls recoverable.
  }
} else {
  // Offer a local input or explain that workspace data needs the preview.
}
```

`capabilities` contains booleans for llm, vision, ocr, translate, render, synthesize, transcribe, files, store, tools and duckdb. `w.path` is the current artifact path.

## Workspace files — capability: files

Use absolute workspace paths such as `/data/rows.json`. SDK paths are normalized from the workspace root, unlike relative URLs in page markup/fetch.

- `files.list()` → path strings.
- `files.exists(path)` → boolean.
- `files.read(path)` → Uint8Array.
- `files.readText(path)` → string.
- `files.readJSON(path)` → parsed JSON.
- `files.write(path, data, contentType?)` → saved path; data may be text or bytes.
- `files.writeText(path, text)`, `files.writeJSON(path, value)` → saved path.
- `files.remove(path)` → true on success.

Writes save artifacts without reloading the page. Use files for deliverable data, not incidental UI state.

## Per-artifact state — capability: store

`store.get(key)` returns the JSON value or null. `store.set(key, value)`, `store.remove(key)` and `store.keys()` manage state outside the workspace. The limit is 1 MiB per artifact; use for small filters, preferences or drafts. Keys must be nonempty and must not use the reserved `__wingman__/` prefix. Do not rely on this store in exports.

## AI and media

Each remote helper requires its corresponding capability and configured service. Calls have no chat history; supply needed context.

- `llm(prompt, { system?, model?, effort? })` → text. Put fixed task instructions in system and inputs in prompt. Validate generated JSON and claims.
- `vision(path, prompt?)` → text interpretation of an image.
- `ocr(path)` → extracted text/layout.
- `translate(text, lang)` → translated text.
- `translateFile(input, lang, output)` → saved output path; uses the translate capability.
- `render(prompt, output, inputs?, options?)` → saved image path. inputs is an array of artifact paths; use [] before options for new imagery. Options include `aspectRatio`, `quality` and `background` when supported by the renderer.
- `synthesize(text, output, voice?)` → saved WAV path. Use a configured voice or omit it; do not guess IDs.
- `transcribe(path)` → text from supported audio/video.

## Local PDF rasterization — capability: files

`rasterizePdf(path, { scale?, pages? })` returns `[{ page, data }]`, where page is 1-based and data is PNG Uint8Array bytes. pages is an array of 1-based page numbers; omit for all pages. Scale 1 is approximately 72 DPI; the default is 2, subject to canvas limits.

Unlike the interpreter helper, this browser method does **not** save PNG files or return paths. Save them explicitly if needed:

```javascript
const pages = await w.rasterizePdf("/report.pdf", { pages: [1], scale: 2 });
for (const { page, data } of pages) {
  await w.files.write("/report-" + page + ".png", data, "image/png");
}
```

## Enabled chat tools — capability: tools

`tools.list()` → `[{ name, title, description, parameters }]`.
`tools.call(name, args)` → tool content parts.

Use the discovered schema; do not assume a tool is enabled. The user is asked for consent before the first tool call from an artifact; handle rejection without repeated automatic retries. Tool results are content parts, not necessarily a string.

For SQL, read [duckdb.md](duckdb.md).
