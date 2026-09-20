# Offline HTML artifact libraries

HTML artifacts can use ECharts, Three.js, and Lucide without a CDN. Every artifact
workspace has a virtual `/.lib/` folder:

| Reference          | Global    | Notes                                                                 |
| ------------------ | --------- | --------------------------------------------------------------------- |
| `/.lib/echarts.js` | `echarts` | `echarts/dist/echarts.min.js`                                        |
| `/.lib/three.js`   | `THREE`   | Core plus OrbitControls, GLTFLoader, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass |
| `/.lib/lucide.js`  | `lucide`  | Official UMD build                                                    |
| `/.lib/tailwind.js` | (none)   | `@tailwindcss/browser`: Tailwind v4 compiled in the page at load time; `@theme` via `<style type="text/tailwindcss">` |
| `/.lib/daisyui.css` | (stylesheet) | daisyUI 5 prebuilt components (light and dark themes); link it before the Tailwind script |
| `/.lib/daisyui-themes.css` | (stylesheet) | daisyUI's remaining themes, selected with `data-theme` on `<html>` |
| `/.lib/alpine.js` | `Alpine`  | Alpine.js 3 CDN build; load with `defer`, state in `x-data`         |

A page references a library with the absolute path `/.lib/<name>`, from any
folder depth, before its own script (relative forms such as `../.lib/three.js`
also work):

```html
<script src="/.lib/echarts.js"></script>
```

In the preview session the absolute reference is rewritten to the session's own
URL so the worker can answer it. "Download all" (zip) rewrites it to a relative
path and ships the library at `.lib/`; a single-file download is the page as
stored, so it needs the folder export to run from disk.

Nothing is stored in the workspace and the model never handles library source
(`src/features/artifacts/prompts/artifacts.txt` and `interpreter.txt` say so;
the verifier fails pages that inline library or dataset source and pages that
reference an unknown `.lib/` name). `/.lib/` is a reserved path like `/.memory/`.

## How it is served

`scripts/artifact-library-sources.ts` provides each library twice: as a string
(`virtual:artifact-library-source/<lib>`, escaped for inline scripts) and as a
served file (`virtual:artifact-library-url/<lib>`: a dev-server path, or a hashed
asset emitted into `dist/assets/` on build). `src/shared/lib/artifactLibraries.ts`
is the registry both sides use.

The preview session sends the URL map to `public/html-preview-sw.js`, which
answers any `.lib/<name>` request (at any folder depth) by fetching the served
file once and keeping it in CacheStorage, so previews work offline and after the
worker restarts. Session snapshots never contain library bytes.

## Exports

`FileSystemManager.downloadAsZip` rewrites absolute `/.lib/` references to
relative ones (`exportArtifactHtmlForFolder`) and adds each referenced library
at the path the page resolves it to (`collectReferencedLibraries`).

The JavaScript interpreter still exposes `echarts` as a worker global for SVG
server-side rendering. The older `echartsSource`/`threeSource`/`lucideSource`
strings remain for existing artifacts but are no longer advertised.
