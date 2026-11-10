// One SVG source for the favicon/chat logo and all installation artwork.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const check = process.argv.includes("--check");
const source = (await fs.readFile(path.join(root, "icon.svg"), "utf8")).replace(/<\?xml[^>]*>\s*/, "");
const artwork = source
  .replace(/<svg\b[^>]*>/, '<g transform="translate(64 64) scale(0.75)">')
  .replace(/<\/svg>\s*$/, "</g>");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(name, svg, size) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true });
    const file = path.join(root, name);
    if (check) {
      const existing = await fs.readFile(file).catch(() => Buffer.alloc(0));
      if (!existing.equals(png)) {
        console.error(`Out of date: ${name}`);
        process.exitCode = 1;
      }
    } else {
      await fs.writeFile(file, png);
    }
  }

  await render("icon.png", source, 512);
  for (const [variant, background] of [
    ["light_", "#fafafa"],
    ["dark_", "#171717"],
  ]) {
    // Opaque backgrounds and padding keep the artwork in the maskable safe area.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${background}"/>${artwork}</svg>`;
    for (const size of [192, 512]) {
      await render(`icon_maskable_${variant}${size}.png`, svg, size);
    }
  }
} finally {
  await browser.close();
}
