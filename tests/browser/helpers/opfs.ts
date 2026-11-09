import { randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

/** WebKit's persistent profiles share origin OPFS; keep test data isolated across profiles and reloads. */
export async function isolateOpfs(context: BrowserContext): Promise<() => Promise<void>> {
  const namespace = `playwright-${randomUUID()}`;
  await context.addInitScript({
    content: `(() => {
      const prototype = Object.getPrototypeOf(navigator.storage);
      const key = Symbol.for("wingman.playwright.opfsRoot");
      const getDirectory = prototype[key] || prototype.getDirectory;
      Object.defineProperty(prototype, key, { configurable: true, value: getDirectory });
      Object.defineProperty(prototype, "getDirectory", {
        configurable: true,
        value: function () {
          return getDirectory.call(this).then(root => root.getDirectoryHandle(${JSON.stringify(namespace)}, { create: true }));
        }
      });
    })();`,
  });

  return async () => {
    const page = context.pages().find((page) => /^https?:/.test(page.url()));
    await page
      ?.evaluate(async (name) => {
        const prototype = Object.getPrototypeOf(navigator.storage) as StorageManager;
        const getDirectory = Reflect.get(
          prototype,
          Symbol.for("wingman.playwright.opfsRoot"),
        ) as StorageManager["getDirectory"];
        const root = await getDirectory.call(navigator.storage);
        await root.removeEntry(name, { recursive: true });
      }, namespace)
      .catch(() => {});
  };
}
