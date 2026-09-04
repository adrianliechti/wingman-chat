import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const port = 4175;

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  // Keep traces outside Vite's watched repository tree; writing a trace while
  // the dev server is active can otherwise trigger a full-page reload.
  outputDir: path.join(os.tmpdir(), "wingman-playwright-results"),
  expect: { timeout: 30_000 },
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vp dev --config tests/browser/vite.config.ts --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/tests/browser/fixtures/interpreter.html`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
