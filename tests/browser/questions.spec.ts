import { expect, test, type Page } from "@playwright/test";

async function ask(page: Page, questions: object[], dark = false) {
  test.setTimeout(45_000);
  await page.setViewportSize({ width: dark ? 390 : 1000, height: 1100 });
  await page.addInitScript((dark) => localStorage.setItem("app_theme", dark ? "dark" : "light"), dark);
  await page.route("**/config.json", (route) => route.fulfill({ json: { models: [] } }));
  await page.goto("/tests/browser/fixtures/react-ui.html");
  const input = page.getByRole("textbox", { name: "Chat message input" });
  await input.fill("Help me plan the report");
  await input.press("Enter");
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate((questions) => {
    window.reactUiE2E.callTool("ask_questions", {
      message: "A few details will help me tailor the result.",
      questions,
    });
  }, questions);
  const form = page.getByRole("form", { name: /quick questions?/ });
  await expect(form).toBeVisible();
  return form;
}

async function submittedResult(page: Page) {
  return page.evaluate(() => {
    const content = window.reactUiE2E.state().input.findLast((message) => message.role === "tool")?.content;
    return typeof content === "string" ? JSON.parse(content) : content;
  });
}

for (const dark of [false, true]) {
  test(`questions use explicit answers and preserve a readable summary (${dark ? "dark narrow" : "light"})`, async ({
    page,
  }, info) => {
    const form = await ask(
      page,
      [
        {
          id: "audience",
          label: "Who is this for?",
          type: "select",
          required: true,
          options: [
            {
              value: "team",
              label: "The team",
              description: "Useful detail for the people doing the work.",
              recommended: true,
            },
            { value: "leaders", label: "Leadership", description: "Focus on decisions and the bigger picture." },
          ],
        },
        { id: "publish", label: "Publish the report?", type: "boolean", required: true },
        {
          id: "include",
          label: "What should it include?",
          type: "multi_select",
          options: [
            { value: "numbers", label: "Key numbers" },
            { value: "next", label: "Next steps" },
          ],
        },
      ],
      dark,
    );
    await expect(page.locator("html")).toHaveClass(dark ? /dark/ : /^(?!.*dark)/);
    await expect(form.locator("legend")).toHaveText([
      "Who is this for?",
      "Publish the report?",
      "What should it include?Optional",
    ]);
    const team = form.getByRole("radio", { name: "The team", exact: true });
    await expect(team).not.toBeChecked();
    await expect(form.getByText("Recommended", { exact: true })).toBeVisible();
    await expect(form.getByRole("radio", { name: "No", exact: true })).not.toBeChecked();
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(team).toBeFocused();
    await expect(form.getByText("Choose Yes or No.", { exact: true })).toBeVisible();
    await team.press("Space");
    // Clearing one error must not move focus to a different unanswered question.
    await expect(team).toBeFocused();
    await expect(team).toBeChecked();
    await form.getByRole("radio", { name: "No", exact: true }).focus();
    await page.keyboard.press("Space");
    await form.getByRole("checkbox", { name: "Key numbers", exact: true }).check();
    await form
      .getByRole("textbox", { name: "Your answer for What should it include?", exact: true })
      .fill("Risks and assumptions");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Fit the whole form in the capture without the sticky composer covering its footer.
    await page.setViewportSize({ width: dark ? 390 : 1000, height: 1400 });
    await form.getByRole("button", { name: "Continue", exact: true }).scrollIntoViewIfNeeded();
    await form.screenshot({ path: info.outputPath("question-form.png"), animations: "disabled" });
    await page.setViewportSize({ width: dark ? 390 : 1000, height: 1100 });
    await form.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
    expect(await submittedResult(page)).toEqual({
      answered: true,
      answers: { audience: "team", publish: false, include: ["numbers", "Risks and assumptions"] },
    });
    await expect(form).toHaveCount(0);
    await page.evaluate(() => window.reactUiE2E.finish("I have the details. Here is the plan."));
    const summary = page.getByRole("button", { name: /Answers received/ });
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("The team");
    await summary.click();
    await expect(page.getByText("Publish the report?", { exact: true })).toBeVisible();
    await expect(page.locator("p").filter({ hasText: "Publish the report?" })).toHaveText(/Publish the report\?\s*No/);
    await expect(page.locator("p").filter({ hasText: "What should it include?" })).toContainText(
      "Key numbers, Risks and assumptions",
    );
    await page.evaluate(() => window.reactUiE2E.flush());
    await page.reload();
    await expect(page.getByRole("button", { name: /Answers received/ })).toBeVisible();
  });
}

test("written single-choice answers, clearing, and optional Yes/No stay explicit", async ({ page }) => {
  const form = await ask(page, [
    {
      id: "format",
      label: "Which format?",
      type: "select",
      required: true,
      options: [
        { value: "brief", label: "Brief" },
        { value: "report", label: "Report" },
      ],
    },
    { id: "publish", label: "Publish it?", type: "boolean" },
    { id: "count", label: "How many?", type: "number", required: true },
  ]);
  await form.getByRole("radio", { name: "Brief", exact: true }).check();
  await form.getByRole("textbox", { name: "Your answer for Which format?", exact: true }).fill("A slide deck");
  await expect(form.getByRole("radio", { name: "Brief", exact: true })).not.toBeChecked();
  await form.getByRole("button", { name: "Clear answer for Which format?" }).click();
  await expect(form.getByRole("textbox", { name: "Your answer for Which format?", exact: true })).toHaveValue("");
  await form.getByRole("textbox", { name: "Your answer for Which format?", exact: true }).fill("A slide deck");
  await form.getByRole("spinbutton", { name: "How many?", exact: true }).fill("0");
  await form.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(await submittedResult(page)).toEqual({ answered: true, answers: { format: "A slide deck", count: 0 } });
  await page.evaluate(() => window.reactUiE2E.finish("Ready"));
  await page.getByRole("button", { name: /Answers received/ }).click();
  await expect(page.locator("p").filter({ hasText: "Which format?" })).toContainText("A slide deck");
  await expect(page.locator("p").filter({ hasText: "How many?" })).toHaveText(/How many\?\s*0/);
  await expect(page.getByText("Publish it?", { exact: true })).toHaveCount(0);
});

test("fixed choices omit written answers and Skip resumes without submitting defaults", async ({ page }) => {
  const form = await ask(page, [
    {
      id: "format",
      label: "Which format?",
      type: "select",
      allow_other: false,
      options: [
        { value: "a", label: "A", recommended: true },
        { value: "b", label: "B" },
      ],
    },
  ]);
  await expect(form.getByRole("textbox")).toHaveCount(0);
  await form.getByRole("button", { name: "Skip", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.reactUiE2E.state().calls)).toBe(2);
  expect(await submittedResult(page)).toEqual({ answered: false, action: "decline" });
  await page.evaluate(() => window.reactUiE2E.finish("Continuing with the available context."));
  await expect(page.getByRole("button", { name: /Questions skipped/ })).toBeVisible();
});

test("Stop clears a pending question without resuming the model or restoring it on reload", async ({ page }) => {
  const form = await ask(page, [{ id: "answer", label: "Which direction?", type: "text", required: true }]);
  await page.getByRole("button", { name: "Stop generating (Esc)", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(await page.evaluate(() => window.reactUiE2E.state().calls)).toBe(1);
  await page.evaluate(() => window.reactUiE2E.flush());
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Chat message input" })).toBeVisible();
  await expect(page.getByRole("form", { name: /quick questions?/ })).toHaveCount(0);
});
