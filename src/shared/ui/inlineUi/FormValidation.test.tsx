// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getValue } from "@a2ui/web_core/v1_0";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BASIC_CATALOG_ID, WINGMAN_CATALOG_ID } from "@/shared/lib/inlineUi/catalog";
import { InlineUiRuntime } from "@/shared/lib/inlineUi/runtime";
import { NodeView } from "./NodeView";

let root: Root, container: HTMLDivElement, runtime: InlineUiRuntime;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  runtime = new InlineUiRuntime();
});
afterEach(async () => {
  await act(async () => root.unmount());
  runtime.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

const required = (path: string) => ({
  condition: { "@call": "required", catalogId: BASIC_CATALOG_ID, args: { value: { "@path": path } } },
  message: "Required",
});

it("tracks descendant validity and custom Select accessibility after submitting", async () => {
  runtime.sync([
    {
      key: "form",
      source: JSON.stringify({
        version: "v1.0",
        createSurface: {
          surfaceId: "main",
          catalogId: BASIC_CATALOG_ID,
          dataModel: { email: "", plan: "", notes: "" },
          components: [
            {
              id: "root",
              component: "Form",
              catalogId: WINGMAN_CATALOG_ID,
              children: ["email", "column"],
              submit: "Submit",
              action: { event: { name: "save" } },
            },
            {
              id: "email",
              component: "TextField",
              label: "Email",
              value: { "@path": "/email" },
              checks: [required("/email")],
            },
            { id: "column", component: "Column", children: ["plan", "notes"] },
            {
              id: "plan",
              component: "Select",
              catalogId: WINGMAN_CATALOG_ID,
              label: "Plan",
              value: { "@path": "/plan" },
              options: [{ value: "pro", label: "Pro" }],
              checks: [required("/plan")],
            },
            {
              id: "notes",
              component: "TextField",
              label: "Notes",
              value: { "@path": "/notes" },
              checks: [required("/notes")],
            },
          ],
        },
      }),
    },
  ]);
  const onSubmit = vi.fn();
  runtime.onSubmit = onSubmit;
  const node = getValue(runtime.resolvers.get("main")!.rootNode)!;
  await act(async () => root.render(<NodeView node={node} />));
  const plan = container.querySelector<HTMLButtonElement>('[data-a2ui-component="Select"] button')!;
  expect(plan.getAttribute("aria-invalid")).toBeNull();
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(container.textContent).toContain("Check the highlighted fields.");
  expect(plan.getAttribute("aria-invalid")).toBe("true");
  const errorId = plan.getAttribute("aria-errormessage")!;
  expect(document.getElementById(errorId)?.textContent).toBeTruthy();
  expect(onSubmit).not.toHaveBeenCalled();

  const model = runtime.getSurface("main")!.dataModel;
  await act(async () => {
    model.set("/email", "ada@example.com");
    model.set("/plan", "pro");
  });
  expect(plan.getAttribute("aria-invalid")).toBeNull();
  expect(container.textContent).toContain("Check the highlighted fields.");
  await act(async () => model.set("/notes", "Ready"));
  expect(container.textContent).not.toContain("Check the highlighted fields.");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(onSubmit).toHaveBeenCalledOnce();

  await act(async () => model.set("/plan", ""));
  expect(container.textContent).toContain("Check the highlighted fields.");
  expect(plan.getAttribute("aria-invalid")).toBe("true");
});
