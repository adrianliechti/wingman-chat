import fs from "node:fs/promises";
import { expect, test } from "@playwright/test";

// Exercise the real document head without booting the chat application.
const html = (await fs.readFile("index.html", "utf8")).replace(/<script type="module"[^>]*><\/script>/g, "");

for (const appearance of ["light", "dark"] as const) {
  test(`install artwork follows the ${appearance} OS appearance independently of the app theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: appearance });
    await page.addInitScript(
      (theme) => localStorage.setItem("app_theme", theme),
      appearance === "dark" ? "light" : "dark",
    );
    await page.route("**/install-icon-review", (route) => route.fulfill({ contentType: "text/html", body: html }));
    await page.goto("/install-icon-review");

    const manifestLink = page.locator('link[rel="manifest"]');
    const touchIcon = page.locator('link[rel="apple-touch-icon"]');
    const manifestPath = `/manifest.json?color-scheme=${appearance}`;
    const iconPath = appearance === "dark" ? "/icon_maskable_dark_512.png" : "/icon_maskable_light_512.png";
    await expect(manifestLink).toHaveAttribute("href", manifestPath);
    await expect(manifestLink).toHaveAttribute("crossorigin", "use-credentials");
    await expect(touchIcon).toHaveAttribute("href", iconPath);

    // Both installers receive a real, opaque PNG with the selected background.
    const pixel = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(0, 0, 1, 1).data];
    }, iconPath);
    expect(pixel).toEqual(appearance === "dark" ? [23, 23, 23, 255] : [250, 250, 250, 255]);

    // Changing the OS appearance before installing updates both installer inputs.
    await page.emulateMedia({ colorScheme: appearance === "dark" ? "light" : "dark" });
    await expect(manifestLink).toHaveAttribute(
      "href",
      `/manifest.json?color-scheme=${appearance === "dark" ? "light" : "dark"}`,
    );
    await expect(touchIcon).toHaveAttribute(
      "href",
      appearance === "dark" ? "/icon_maskable_light_512.png" : "/icon_maskable_dark_512.png",
    );
  });
}

test("blocked storage still initializes the page and install icons from the OS", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/install-icon-review", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/install-icon-review");
  await expect(page.locator("html")).toHaveClass("dark");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.json?color-scheme=dark");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icon_maskable_dark_512.png");
  expect(errors).toEqual([]);
});

test("install PNGs are opaque and keep the artwork inside the safe circle", async ({ page }) => {
  await page.route("**/install-icon-review", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/install-icon-review");
  for (const scheme of ["light", "dark"]) {
    for (const size of [192, 512]) {
      const stats = await page.evaluate(
        async ({ scheme, size }) => {
          const image = new Image();
          image.src = `/icon_maskable_${scheme}_${size}.png`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, size, size).data;
          const bg = scheme === "light" ? 250 : 23;
          let opaque = true;
          let radius = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] !== 255) opaque = false;
            if (pixels[i] !== bg || pixels[i + 1] !== bg || pixels[i + 2] !== bg) {
              const x = (i / 4) % size;
              const y = Math.floor(i / 4 / size);
              radius = Math.max(radius, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / size);
            }
          }
          return { width: image.naturalWidth, height: image.naturalHeight, opaque, radius };
        },
        { scheme, size },
      );
      expect(stats.width).toBe(size);
      expect(stats.height).toBe(size);
      expect(stats.opaque).toBe(true);
      expect(stats.radius).toBeGreaterThan(0.2);
      expect(stats.radius).toBeLessThanOrEqual(0.4);
    }
  }
});
