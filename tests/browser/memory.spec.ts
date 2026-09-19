import { expect, test, type Page } from "@playwright/test";
import type { ComposedMemories } from "../../src/features/agent/lib/memoryCompose";

function composed(body: string): ComposedMemories {
  return {
    notes: [
      {
        path: "preferences/writing.md",
        title: "Writing style",
        description: "Writing preferences",
        type: "Preference",
        body,
        core: true,
        scope: null,
        tags: ["writing"],
      },
    ],
  };
}

async function open(page: Page, output?: ComposedMemories | null) {
  await page.route("**/config.json", (route) => route.fulfill({ json: { models: [], memory: {} } }));
  await page.route("**/api/v1/responses", (route) => {
    const request = route.request().postDataJSON();
    expect(request.model).toBe("memory-test");
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "add_memory", strict: true });
    const result = output === undefined ? composed(JSON.parse(request.input).memory) : output;
    return route.fulfill({
      json: {
        id: "memory-response",
        model: "memory-test",
        status: "completed",
        output: result
          ? [
              {
                type: "message",
                role: "assistant",
                phase: "final_answer",
                content: [{ type: "output_text", text: JSON.stringify(result), annotations: [] }],
              },
            ]
          : [],
      },
    });
  });
  await page.goto("/tests/browser/fixtures/memory.html");
  await expect(page.getByRole("button", { name: "Disable memory" })).toBeVisible();
}

test("enabling memory waits for a delayed settings save without showing a disabled error", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Disable memory" }).click();
  await page.evaluate(() => window.memoryE2E.flush());
  await page.evaluate(() => window.memoryE2E.holdAgentSave());
  await page.getByRole("button", { name: "Enable memory" }).click();
  await page.waitForFunction(() => window.memoryE2E.saveHeld());
  try {
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Memory", exact: true })).toBeVisible();
  } finally {
    await page.evaluate(() => window.memoryE2E.releaseAgentSave());
  }
  await page.evaluate(() => window.memoryE2E.flush());
  await expect.poll(() => page.evaluate(() => window.memoryE2E.settings())).toMatchObject({ memory: true });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page.getByLabel("Memory to remember").fill("This memory was enabled successfully.");
  await page.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(page.getByText("This memory was enabled successfully.", { exact: true })).toBeVisible();
});

test("real OPFS serializes tabs, refreshes indexes, and rejects stale file-tool writes", async ({ page, context }) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  await Promise.all(
    [page, other].map((tab, i) =>
      tab.evaluate(async (i) => {
        for (let n = 0; n < 3; n++)
          await window.memoryE2E.call("create", {
            file_path: `/.memory/topic-${i}-${n}.md`,
            content: `Topic ${i} ${n}`,
          });
      }, i),
    ),
  );
  expect(Object.keys(await page.evaluate(() => window.memoryE2E.files()))).toHaveLength(6);
  const index = await page.evaluate(() => window.memoryE2E.index());
  expect(index).toContain("topic-0-0.md");
  expect(index).toContain("topic-1-2.md");
  await expect.poll(() => other.evaluate(() => window.memoryE2E.updates())).toBeGreaterThan(3);
  await page.evaluate(() => window.memoryE2E.call("read", { file_path: "/.memory/topic-0-0.md" }));
  await other.evaluate(() => window.memoryE2E.externalWrite("topic-0-0.md", "Newer from another tab"));
  const result = await page.evaluate(() =>
    window.memoryE2E.call("create", { file_path: "/.memory/topic-0-0.md", content: "Stale overwrite" }),
  );
  expect(JSON.stringify(result)).toContain("changed since");
  await page.reload();
  await page.waitForFunction(() => window.memoryE2E);
  expect((await page.evaluate(() => window.memoryE2E.files()))["topic-0-0.md"]).toContain("Newer from another tab");
});

test("plain text memories protect edits across tabs and persist the memory switch", async ({ page, context }) => {
  await open(page);
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page.getByLabel("Memory to remember").fill("Prefer concise answers.");
  await expect(page.getByLabel("Memory file path")).toHaveCount(0);
  await page.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(page.getByText("Prefer concise answers.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "All memories", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Memory content")).toHaveValue("Prefer concise answers.");
  await page.getByLabel("Memory content").fill("Prefer short answers with examples.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Prefer short answers with examples.", { exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.memoryE2E.files()))["preferences/writing.md"]).toContain("core: true");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Memory content").fill("Stale human edit");
  const other = await context.newPage();
  await open(other);
  await other.evaluate(() => window.memoryE2E.externalWrite("preferences/writing.md", "Newer human edit"));
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("changed since");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Memory notes" })
    .getByRole("button", { name: "Forget Writing style", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", { name: "Forget this memory?" });
  await confirmation.getByRole("button", { name: "Forget", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.memoryE2E.files())).toEqual({});
  expect(await page.evaluate(() => window.memoryE2E.index())).not.toContain("writing.md");
  await page.getByRole("button", { name: "Close memory" }).click();
  await page.getByRole("button", { name: "Disable memory" }).click();
  await page.evaluate(() => window.memoryE2E.flush());
  expect(await page.evaluate(() => window.memoryE2E.settings())).toMatchObject({ memory: false });
  await page.reload();
  await expect(page.getByRole("button", { name: "Enable memory" })).toBeVisible();
});

test("structured additions split topics and Clear all requires confirmation", async ({ page }) => {
  const output = composed("Prefer concise answers.");
  output.notes.push({
    ...output.notes[0],
    path: "projects/wingman.md",
    title: "Wingman",
    type: "Reference",
    body: "Wingman uses browser storage.",
    scope: "Wingman",
    core: false,
  });
  await open(page, output);
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page.getByLabel("Memory to remember").fill("I prefer concise answers. Wingman uses browser storage.");
  await page.getByRole("button", { name: "Remember", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Memory notes" });
  await expect(nav.getByRole("button", { name: "Wingman", exact: true })).toBeVisible();
  await expect(page.getByText("2 notes", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all memory", exact: true }).click();
  let confirmation = page.getByRole("dialog", { name: "Clear all memory?" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  expect(Object.keys(await page.evaluate(() => window.memoryE2E.files()))).toHaveLength(2);
  await page.getByRole("button", { name: "Clear all memory", exact: true }).click();
  confirmation = page.getByRole("dialog", { name: "Clear all memory?" });
  await confirmation.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.memoryE2E.files())).toEqual({});
  await expect(
    page.getByRole("dialog", { name: "Memory", exact: true }).getByText("No memories yet", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all memory", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close memory", exact: true }).click();
  await page.getByRole("button", { name: "Disable memory", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable memory", exact: true })).toBeVisible();
});

test("a failed structured addition keeps the user's text and writes nothing", async ({ page }) => {
  await open(page, null);
  await page.getByRole("button", { name: "Manage", exact: true }).click();
  await page.getByRole("button", { name: "Add memory", exact: true }).click();
  await page.getByLabel("Memory to remember").fill("Keep this text if the model is unavailable.");
  await page.getByRole("button", { name: "Remember", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("could not be organized");
  await expect(page.getByLabel("Memory to remember")).toHaveValue("Keep this text if the model is unavailable.");
  expect(await page.evaluate(() => window.memoryE2E.files())).toEqual({});
});
