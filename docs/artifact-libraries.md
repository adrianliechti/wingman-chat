# Offline HTML artifact libraries

HTML artifacts can use ECharts, Three.js, and Lucide without a CDN. The JavaScript
executor supplies `echartsSource`, `threeSource`, and `lucideSource`: strings
containing browser scripts, loaded only when the execution code references them.

The model discovers these globals through the artifact and interpreter prompts in
`src/features/artifacts/prompts/` and the `execute_javascript_code` tool description
in `useArtifactsProvider.ts`. The source strings never need to pass through the
model's output; its code writes them directly into the artifact workspace.

## Where the libraries live

Three.js and Lucide are pinned npm dependencies. During development and production
builds, `scripts/artifact-library-sources.ts` exposes their browser bundles as
virtual modules. Vite emits them into the app's own assets as separate lazy chunks.
There is no CDN URL or public library endpoint for the model to construct.

Three.js is bundled into a single classic script because modern Three.js uses ES
modules. Its core and selected addons share one instance. Lucide uses its official
UMD browser bundle. Both sources retain their license notices and can be embedded
in HTML script tags.

The executor obtains these strings from the Wingman installation. Once written to
an artifact, the libraries belong to that artifact's files. HTML previews serve
companion files through the preview service worker. Standalone HTML embeds the
scripts and can run after download without Wingman or a network connection. This
does not make the entire Wingman application available offline after a cold reload.

## Companion scripts

Run this with `execute_javascript_code`:

```js
vfs.write("/lib/three.js", threeSource, "text/javascript");
vfs.write("/lib/lucide.js", lucideSource, "text/javascript");
vfs.write(
  "/scene.html",
  `<!doctype html>
<html><body>
<button aria-label="Reset camera"><i data-lucide="camera"></i></button>
<script src="./lib/three.js"></script>
<script src="./lib/lucide.js"></script>
<script>
  lucide.createIcons();
  const scene = new THREE.Scene();
  // Add a camera, renderer, geometry, and animation here.
</script>
</body></html>`,
  "text/html",
);
```

Use paths relative to the HTML file. Downloaded HTML needs its companion files;
for a single downloadable file, use inline scripts instead.

## Standalone HTML

The following executor code creates a complete, offline 3D artifact:

```js
vfs.write(
  "/cube.html",
  `<!doctype html>
<html><head><meta charset="utf-8"><title>Rotating cube</title>
<style>body { margin: 0; } canvas { display: block; }
button { position: fixed; top: 12px; left: 12px; }</style>
</head><body>
<button id="pause" aria-label="Pause animation"><i data-lucide="pause"></i></button>
<script>${threeSource}</script>
<script>${lucideSource}</script>
<script>
  lucide.createIcons();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);
  camera.position.z = 4;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshNormalMaterial();
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);
  resize();
  let paused = false;
  const button = document.getElementById('pause');
  button.onclick = () => {
    paused = !paused;
    button.setAttribute('aria-label', paused ? 'Resume animation' : 'Pause animation');
    button.innerHTML = '<i data-lucide="' + (paused ? 'play' : 'pause') + '"></i>';
    lucide.createIcons();
  };
  let previous;
  renderer.setAnimationLoop((time) => {
    const delta = previous === undefined ? 0 : Math.min((time - previous) / 1000, 0.1);
    previous = time;
    if (!paused) cube.rotation.y += delta;
    controls.update();
    renderer.render(scene, camera);
  });
  addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
    controls.dispose();
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    removeEventListener('resize', resize);
  });
</script></body></html>`,
  "text/html",
);
```

The page gets the globals `THREE` and `lucide`; they are not objects available in
the executor's DOM-free worker. No import map is needed for these classic scripts.

The Three.js bundle includes `OrbitControls`, `GLTFLoader`, `EffectComposer`,
`RenderPass`, `ShaderPass`, `UnrealBloomPass`, and `OutputPass`, all accessed through
`THREE`. Use `WebGLRenderer`. Other addons, Draco/Meshopt/KTX2 decoders, fonts,
textures, and models are not included. Supply any needed assets locally or embed
them; for standalone HTML, all required assets must be embedded too.
