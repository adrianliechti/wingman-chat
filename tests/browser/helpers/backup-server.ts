import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test as base } from "@playwright/test";

// Use the production storage routes and an isolated directory, never the developer's store.
export const test = base.extend<{}, { backupServer: string }>({
  backupServer: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture arguments to use object destructuring.
    async ({}, use) => {
      const directory = await mkdtemp(path.join(os.tmpdir(), "wingman-backup-e2e-"));
      let child: ReturnType<typeof spawn> | undefined;
      try {
        const binary = path.join(directory, "wingman");
        await promisify(execFile)("go", ["build", "-o", binary, "."], { timeout: 120_000 });
        const reservation = createServer();
        reservation.listen(0, "127.0.0.1");
        await once(reservation, "listening");
        const address = reservation.address();
        if (!address || typeof address === "string") throw new Error("Missing test server port");
        await new Promise<void>((resolve, reject) => reservation.close((error) => (error ? reject(error) : resolve())));
        const url = `http://127.0.0.1:${address.port}`;
        child = spawn(binary, [], {
          cwd: directory,
          env: {
            ...process.env,
            PORT: String(address.port),
            PREFIX: "/api",
            ONLINE_BACKUP_ENABLED: "true",
            STORE_ENABLED: "true",
            BACKUP_STORE_PATH: path.join(directory, "store"),
            WINGMAN_URL: "http://127.0.0.1:1",
          },
          stdio: "pipe",
        });
        let logs = "";
        child.stdout?.on("data", (data) => {
          logs += String(data);
        });
        child.stderr?.on("data", (data) => {
          logs += String(data);
        });
        child.on("error", (error) => {
          logs += error.message;
        });
        await expect
          .poll(
            async () => {
              if (child?.exitCode !== null) throw new Error(`Backup server exited: ${logs}`);
              return fetch(`${url}/api/v1/me`, { headers: { "X-Forwarded-User": "health-check" } })
                .then((response) => response.status)
                .catch(() => 0);
            },
            { timeout: 15_000 },
          )
          .toBe(200);
        await use(url);
      } finally {
        if (child && child.exitCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGKILL");
          await exited;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
    { scope: "worker", timeout: 150_000 },
  ],
});
