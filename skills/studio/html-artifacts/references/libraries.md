# Bundled browser libraries

Load classic scripts from `/.lib/<name>` before code that uses their globals. Do not read, copy or inline library source, or use CDNs, remote imports, import maps or app-internal asset URLs. The page globals below are separate from JavaScript interpreter globals.

| File               | Page API                                   |
| ------------------ | ------------------------------------------ |
| echarts.js         | `echarts` for interactive charts           |
| three.js           | `THREE`, including the addons listed below |
| lucide.js          | `lucide.createIcons()`                     |
| tailwind.js        | Tailwind CSS 4 browser compiler            |
| daisyui.css        | daisyUI 5 component styles                 |
| daisyui-themes.css | Additional daisyUI themes                  |
| alpine.js          | Alpine.js 3; load with `defer`             |

## ECharts

```html
<div id="chart" style="height:360px" role="img" aria-label="Chart"></div>
<script src="/.lib/echarts.js"></script>
<script>
  const chart = echarts.init(document.getElementById("chart"));
  // Set options from the task's real data before displaying the chart.
  const observer = new ResizeObserver(() => chart.resize());
  observer.observe(document.getElementById("chart"));
  addEventListener(
    "pagehide",
    () => {
      observer.disconnect();
      chart.dispose();
    },
    { once: true },
  );
</script>
```

Give the container a height. Reuse instances on data updates; call `setOption` and clear obsolete series as needed. Include units, source and useful empty/error states. Do not use the removed interpreter variable `echartsSource`.

## Three.js

Load `/.lib/three.js`; use `THREE.WebGLRenderer`. Included addons are `THREE.OrbitControls`, `THREE.GLTFLoader`, `THREE.EffectComposer`, `THREE.RenderPass`, `THREE.ShaderPass`, `THREE.UnrealBloomPass` and `THREE.OutputPass`. Other addons and decoders are absent. Use local uncompressed glTF/GLB, or provide required decoders locally.

Resize the renderer and camera to the container. Stop animation and dispose geometry, materials, textures and controls on teardown.

## UI libraries

Lucide: include `/.lib/lucide.js`, add `<i data-lucide="camera"></i>`, and call `lucide.createIcons()` after markup exists. Label icon-only controls with `aria-label`.

Tailwind: load `/.lib/tailwind.js` in the head. Define custom tokens via `<style type="text/tailwindcss">@theme { ... }</style>` using the task's supplied values.

daisyUI: link `/.lib/daisyui.css` before tailwind.js. Components include btn, card, modal, navbar, table, stats, badge, tabs, drawer and alert. Set `data-theme` on html; light/dark are included, with additional themes in daisyui-themes.css. Tokens such as `bg-base-200`, `text-primary`, `border-base-300` and `rounded-box` support Tailwind variants and `@apply`. Follow requested styling; no theme is mandated.

Alpine: load `/.lib/alpine.js` with `defer`; use `x-data`, `x-model`, `x-show`, `x-for` and `x-on`. Call plain async functions from directives for data loading.

Folder exports include referenced bundled libraries. A single-file download does not inline them; use native browser APIs for a required standalone file.
