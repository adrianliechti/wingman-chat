import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import JSZip from "jszip";

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

test("virtual .lib/ references load bundled libraries in previews, offline, and inline on export", async ({
  page,
  context,
}, info) => {
  const errors: string[] = [];
  context.on("weberror", (error) => errors.push(error.error().message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.protocol === "file:" || url.protocol === "data:") return route.continue();
    errors.push(`Unexpected external request: ${url}`);
    return route.abort();
  });
  await page.goto("/tests/browser/fixtures/html-artifacts.html");
  await page.waitForFunction(() => Boolean(window.htmlArtifactsE2E));

  const model = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{}] });
  const body = '<button aria-label="Camera"><i data-lucide="camera"></i></button><pre id="status">Loading</pre>';
  // No interpreter run and no library bytes: the page just references the virtual folder.
  const html =
    "<!doctype html><html><body>" +
    body +
    '<script src="/.lib/three.js"></script><script src="../.lib/lucide.js"></script>' +
    `<script>const modelUrl = ${JSON.stringify(`data:model/gltf+json,${encodeURIComponent(model)}`)};${sceneScript}</script></body></html>`;
  await page.evaluate(([path, content]) => window.htmlArtifactsE2E.write(path, content), ["/scenes/deck.html", html] as const);
  await page.evaluate(() => window.htmlArtifactsE2E.write("/ready.html", "<!doctype html><p>Preview ready</p>"));
  expect(html.length).toBeLessThan(6000);

  const preview = page.frameLocator("iframe");
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/scenes/deck.html"));
  await expect(preview.locator("svg.lucide-camera path")).not.toHaveCount(0);
  await expect(preview.locator("#status")).toContainText('"frames":3');

  // "Download all" ships the libraries and makes the absolute reference relative.
  const zip = await JSZip.loadAsync(
    Buffer.from(await page.evaluate(() => window.htmlArtifactsE2E.exportZip()), "base64"),
  );
  const exportedPage = await zip.file("scenes/deck.html")!.async("string");
  expect(exportedPage).toContain('<script src="../.lib/three.js"></script>');
  expect(exportedPage).not.toContain('"/.lib/');
  expect(zip.file(".lib/three.js")).not.toBeNull();
  expect(zip.file(".lib/lucide.js")).not.toBeNull();
  expect((await zip.file(".lib/three.js")!.async("string")).length).toBeGreaterThan(500_000);
  const exportDir = info.outputPath("deck-export");
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const target = path.join(exportDir, entry.name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await entry.async("nodebuffer"));
  }

  // Offline, the worker serves the libraries from CacheStorage.
  await context.setOffline(true);
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/ready.html"));
  await expect(preview.locator("body")).toHaveText("Preview ready");
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/scenes/deck.html"));
  await expect(preview.locator("#status")).toContainText('"frames":3');

  // The extracted folder opens from disk with no worker and no network.
  const opened = await context.newPage();
  await opened.goto(pathToFileURL(path.join(exportDir, "scenes/deck.html")).href);
  await expect(opened.locator("svg.lucide-camera path")).not.toHaveCount(0);
  await expect(opened.locator("#status")).toContainText('"frames":3');
  expect(errors).toEqual([]);
});

test("/.lib/tailwind.js compiles utility classes and @theme overrides in the preview", async ({ page, context }) => {
  const errors: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    errors.push(`Unexpected external request: ${url}`);
    return route.abort();
  });
  await page.goto("/tests/browser/fixtures/html-artifacts.html");
  await page.waitForFunction(() => Boolean(window.htmlArtifactsE2E));
  await page.evaluate(() =>
    window.htmlArtifactsE2E.write(
      "/styled.html",
      '<!doctype html><html><head><script src="/.lib/tailwind.js"></script>' +
        '<style type="text/tailwindcss">@theme { --color-brand: #167c80; }</style></head>' +
        '<body><p id="box" class="p-4 text-brand">Styled</p></body></html>',
    ),
  );
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/styled.html"));
  const box = page.frameLocator("iframe").locator("#box");
  await expect(box).toHaveText("Styled");
  await expect.poll(() => box.evaluate((element) => getComputedStyle(element).paddingTop)).toBe("16px");
  const color = await box.evaluate((element) => getComputedStyle(element).color);
  expect(color).toMatch(/rgb\(22, 124, 128\)|oklch|color\(/);
  expect(errors).toEqual([]);
});

test("/.lib/daisyui.css styles components on top of Tailwind and ships in folder exports", async ({ page, context }) => {
  const errors: string[] = [];
  // A failed Tailwind compile surfaces as an unhandled rejection inside the preview.
  context.on("weberror", (error) => errors.push(error.error().message));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    errors.push(`Unexpected external request: ${url}`);
    return route.abort();
  });
  await page.goto("/tests/browser/fixtures/html-artifacts.html");
  await page.waitForFunction(() => Boolean(window.htmlArtifactsE2E));
  await page.evaluate(() =>
    window.htmlArtifactsE2E.write(
      "/ui/components.html",
      '<!doctype html><html data-theme="dark"><head><link rel="stylesheet" href="/.lib/daisyui.css">' +
        '<script src="/.lib/tailwind.js"></script>' +
        // daisyUI colours and radii are Tailwind tokens: usable in @apply, with variants and modifiers.
        '<style type="text/tailwindcss">.panel { @apply bg-base-200 rounded-box p-6; }</style></head>' +
        '<body><button id="cta" class="btn btn-primary">Go</button><section id="panel" class="panel">Panel</section>' +
        '<span id="chip" class="bg-primary/50 hover:bg-secondary">Chip</span></body></html>',
    ),
  );
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/ui/components.html"));
  const frame = page.frameLocator("iframe");
  const button = frame.locator("#cta");
  await expect(button).toHaveText("Go");
  await expect.poll(() => button.evaluate((element) => getComputedStyle(element).display)).toBe("inline-flex");
  expect(await button.evaluate((element) => getComputedStyle(element).borderRadius)).not.toBe("0px");
  const panel = frame.locator("#panel");
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).paddingTop)).toBe("24px");
  const panelStyle = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, radius: style.borderRadius, baseVariable: style.getPropertyValue("--color-base-200") };
  });
  expect(panelStyle.baseVariable.trim()).not.toBe("");
  expect(panelStyle.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(panelStyle.radius).not.toBe("0px");
  const chip = frame.locator("#chip");
  const chipBackground = () => chip.evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect.poll(chipBackground).toMatch(/\/ 0\.5\)$/);
  const translucent = await chipBackground();
  await chip.hover();
  await expect.poll(chipBackground).not.toBe(translucent);

  const zip = await JSZip.loadAsync(
    Buffer.from(await page.evaluate(() => window.htmlArtifactsE2E.exportZip()), "base64"),
  );
  expect(await zip.file("ui/components.html")!.async("string")).toContain('href="../.lib/daisyui.css"');
  expect(zip.file(".lib/daisyui.css")).not.toBeNull();
  expect(await zip.file(".lib/tailwind.js")!.async("string")).toContain("@theme inline reference default {");
  expect(errors).toEqual([]);
});

test("/.lib/alpine.js drives declarative state in the preview", async ({ page, context }) => {
  const errors: string[] = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    errors.push(`Unexpected external request: ${url}`);
    return route.abort();
  });
  await page.goto("/tests/browser/fixtures/html-artifacts.html");
  await page.waitForFunction(() => Boolean(window.htmlArtifactsE2E));
  await page.evaluate(() =>
    window.htmlArtifactsE2E.write(
      "/counter.html",
      '<!doctype html><html><head><script defer src="/.lib/alpine.js"></script></head>' +
        '<body><div x-data="{ n: 1 }"><button id="inc" @click="n++">+</button><span id="n" x-text="n"></span>' +
        '<p id="hidden" x-show="n > 1">shown</p></div></body></html>',
    ),
  );
  await page.evaluate(() => window.htmlArtifactsE2E.preview("/counter.html"));
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#n")).toHaveText("1");
  await expect(frame.locator("#hidden")).toBeHidden();
  await frame.locator("#inc").click();
  await expect(frame.locator("#n")).toHaveText("2");
  await expect(frame.locator("#hidden")).toBeVisible();
  expect(errors).toEqual([]);
});
