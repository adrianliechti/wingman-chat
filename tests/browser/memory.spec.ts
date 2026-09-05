import { expect, test, type Page } from "@playwright/test";

type OpResult = Record<string, unknown> & { op: string; error?: string };

declare global {
  interface Window {
    memoryE2E: {
      runFlow(agentId: string): Promise<{
        migrated: { path: string; title: string; type: string }[];
        legacyGone: boolean;
        batch: { results: OpResult[] };
        entries: { path: string; title: string; description?: string; size: number }[];
        runtimeContext: string;
        onDisk: { deploy?: string; index?: string; log?: string; files: string[] };
        events: { agentId: string }[];
      }>;
    };
  }
}

async function openFixture(page: Page): Promise<void> {
  await page.goto("/tests/browser/fixtures/memory.html");
  await page.waitForFunction(() => Boolean(window.memoryE2E));
}

test("memory tool migrates, batches ops, redacts, and persists through real OPFS", async ({ page }) => {
  await openFixture(page);
  const agentId = `memory-${crypto.randomUUID()}`;
  const result = await page.evaluate((id) => window.memoryE2E.runFlow(id), agentId);

  // Legacy MEMORY.md split into one entry per section and removed.
  expect(result.legacyGone).toBe(true);
  expect(result.migrated.map((e) => e.path).sort()).toEqual(["project-context.md", "user-preferences.md"]);

  // One tool call, six ops, per-op results in order.
  const [read, write, edit, search, remove, readGone] = result.batch.results;
  expect(read).toMatchObject({ op: "read", path: "/user-preferences.md" });
  expect(String(read.content)).toContain("Likes tables");
  expect(write).toMatchObject({ op: "write", path: "/deploy.md", action: "created" });
  expect(String(write.note)).toContain("redacted");
  expect(edit).toMatchObject({ op: "write", path: "/user-preferences.md", action: "updated" });
  // "fridays" in the deploy body; "terse" in the edited body and in the description regenerated from it.
  expect(search).toMatchObject({ op: "search", total: 3 });
  expect(new Set((search.matches as { path: string }[]).map((m) => m.path))).toEqual(
    new Set(["/deploy.md", "/user-preferences.md"]),
  );
  expect(remove).toMatchObject({ op: "remove", path: "/project-context.md", action: "removed" });
  expect(readGone.error).toMatch(/No memory entry/);

  // What actually landed in OPFS.
  expect(result.onDisk.files.sort()).toEqual(["deploy.md", "index.md", "log.md", "user-preferences.md"]);
  expect(result.onDisk.deploy).toContain("[REDACTED_SECRET]");
  expect(result.onDisk.deploy).not.toContain("ghp_");
  expect(result.onDisk.deploy).toMatch(/^---\ntype: Reference\ntitle: Deploy\ndescription: How we ship\ntimestamp: /);
  expect(result.onDisk.index).toContain("* [Deploy](deploy.md) - How we ship");
  expect(result.onDisk.index).not.toContain("project-context.md");
  expect(result.onDisk.log).toContain("**Migration**");
  expect(result.onDisk.log).toContain("**Created**: [Deploy](deploy.md)");
  expect(result.onDisk.log).toContain("**Deleted**: Project Context");

  // The runtime-context block the model receives on every turn.
  expect(result.runtimeContext).toMatch(/^<memory-index>\n# Memory\n/);
  expect(result.runtimeContext).toContain("[User Preferences](user-preferences.md)");
  expect(result.runtimeContext).not.toContain("okf_version");

  // Every mutation notified the UI once: write, edit, remove.
  expect(result.events).toEqual([{ agentId }, { agentId }, { agentId }]);
  expect(result.entries.map((e) => e.path).sort()).toEqual(["deploy.md", "user-preferences.md"]);
});
