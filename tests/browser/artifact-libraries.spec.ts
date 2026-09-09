import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

// Exercise the same scene using relative library/model files and fully embedded
// scripts/assets. Actual pixels, animation, addons, and icons must work offline.
const sceneScript = `
(async () => {
  try {
    lucide.createIcons();
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.z = 3;
    const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
    renderer.setSize(96, 96);
    document.body.appendChild(renderer.domElement);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    const model = await new THREE.GLTFLoader().loadAsync(modelUrl);
    scene.add(model.scene);
    const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
    scene.add(cube);
    const composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(96, 96), 0.1, 0.1, 0.9);
    composer.addPass(bloom);
    const output = new THREE.OutputPass();
    composer.addPass(output);
    const shader = new THREE.ShaderPass({
      uniforms: {},
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'
    });
    shader.dispose();
    let frames = 0;
    renderer.setAnimationLoop(() => {
      cube.rotation.y += 0.02;
      controls.update(1 / 60);
      composer.render();
      if (++frames < 3) return;
      renderer.setAnimationLoop(null);
      const pixel = new Uint8Array(4);
      const gl = renderer.getContext();
      gl.readPixels(48, 48, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      document.getElementById('status').textContent = JSON.stringify({
        frames,
        green: pixel[1],
        opaque: pixel[3],
        cameraMoved: camera.position.x !== 0,
        modelLoaded: model.scene.isGroup,
        revision: THREE.REVISION
      });
      controls.dispose();
      bloom.dispose();
      output.dispose();
      composer.dispose();
      cube.geometry.dispose();
      cube.material.dispose();
      renderer.dispose();
    });
  } catch (error) {
    document.getElementById('status').textContent = String(error);
  }
})();`;

test("bundled Three.js and Lucide render in offline previews and standalone downloads", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  context.on("weberror", (error) => errors.push(error.error().message));
  // Creating the artifact may access Wingman's app assets, but never a CDN.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "file:" || url.protocol === "data:") return route.continue();
    errors.push(`Unexpected external request: ${url}`);
    return route.abort();
  });
  await page.goto("/tests/browser/fixtures/html-artifacts.html");
  await page.waitForFunction(() => Boolean(window.htmlArtifactsE2E));

  const result = await page.evaluate(
    (app) =>
      window.htmlArtifactsE2E.create(`
      vfs.write('/lib/three.js', threeSource, 'text/javascript');
      vfs.write('/lib/lucide.js', lucideSource, 'text/javascript');
      const model = JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}] });
      vfs.write('/scenes/model.gltf', model, 'model/gltf+json');
      const body = '<button aria-label="Camera"><i data-lucide="camera"></i></button><pre id="status">Loading</pre>';
      const app = ${JSON.stringify(app)};
      const html = (libraries, modelUrl) => '<!doctype html><html><body>' + body + libraries +
        '<script>const modelUrl = ' + JSON.stringify(modelUrl) + ';' + app + '</script></body></html>';
      vfs.write('/scenes/index.html', html(
        '<script src="../lib/three.js"></script><script src="../lib/lucide.js"></script>',
        './model.gltf'
      ), 'text/html');
      vfs.write('/standalone.html', html(
        '<script>' + threeSource + '</script><script>' + lucideSource + '</script>',
        'data:model/gltf+json,' + encodeURIComponent(model)
      ), 'text/html');
      vfs.write('/ready.html', '<!doctype html><p>Preview ready</p>', 'text/html');
    `),
    sceneScript,
  );
  expect(result).toMatchObject({ success: true });
  expect(result.paths).toEqual(
    expect.arrayContaining(["/lib/three.js", "/lib/lucide.js", "/scenes/index.html", "/standalone.html"]),
  );

  // Establish the preview worker without first requesting either library.
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/ready.html"));
  await expect(page.frameLocator("iframe").locator("body")).toHaveText("Preview ready");
  await context.setOffline(true);
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/scenes/index.html"));
  const preview = page.frameLocator("iframe");
  await expect(preview.locator("svg.lucide-camera path")).not.toHaveCount(0);
  await expect(preview.locator("#status")).toContainText('"frames":3');
  const previewState = JSON.parse((await preview.locator("#status").textContent())!);
  expect(previewState).toMatchObject({ frames: 3, opaque: 255, cameraMoved: true, modelLoaded: true });
  expect(previewState.green).toBeGreaterThan(100);

  // Open the saved HTML directly from disk, outside Wingman's origin and worker.
  const html = await page.evaluate(() => window.htmlArtifactsE2E.read("/standalone.html"));
  expect(html).toBeTruthy();
  const downloadPath = info.outputPath("scene.html");
  await fs.mkdir(info.outputDir, { recursive: true });
  await fs.writeFile(downloadPath, html!);
  const exported = await context.newPage();
  await exported.goto(pathToFileURL(downloadPath).href);
  await expect(exported.locator("svg.lucide-camera path")).not.toHaveCount(0);
  await expect(exported.locator("#status")).toContainText('"frames":3');
  const exportedState = JSON.parse((await exported.locator("#status").textContent())!);
  expect(exportedState).toMatchObject({ frames: 3, opaque: 255, cameraMoved: true, modelLoaded: true });
  expect(exportedState.green).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
