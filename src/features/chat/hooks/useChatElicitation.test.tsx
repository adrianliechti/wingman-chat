// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useChatElicitation } from "./useChatElicitation";
import type { ElicitationResult } from "@/shared/types/elicitation";

let root: Root;
let api!: ReturnType<typeof useChatElicitation>;
const url = { mode: "url" as const, elicitationId: "auth", message: "Connect", url: "https://example.test/connect" };
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  function Harness() {
    api = useChatElicitation();
    return null;
  }
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
});

it.each(["accept", "decline", "cancel"] as const)("settles a form with %s and clears its UI", async (action) => {
  let request!: Promise<ElicitationResult>;
  act(() => {
    request = api.requestElicitation("call", "ask", { message: "Confirm" });
  });
  act(() => api.resolveElicitation({ action }));
  expect(await request).toEqual({ action });
  expect(api.pendingElicitation).toBeNull();
});

it("sends URL consent immediately while keeping completion tracking", async () => {
  const onCancel = vi.fn();
  let request!: Promise<ElicitationResult>;
  act(() => {
    request = api.requestElicitation("call", "ask", url, undefined, onCancel);
  });
  act(() => api.resolveElicitation({ action: "accept" }));
  expect(await request).toEqual({ action: "accept" });
  expect(api.pendingElicitation?.waiting).toBe(true);
  act(() => api.completeElicitation("different"));
  expect(api.pendingElicitation?.waiting).toBe(true);
  act(() => api.completeElicitation("auth"));
  expect(api.pendingElicitation?.completed).toBe(true);
  act(() => api.clearElicitation());
  expect(onCancel).not.toHaveBeenCalled();
});

it.each(["cancel", "abort", "clear"])("cancels the tool after URL consent on %s", async (action) => {
  const controller = new AbortController();
  const onCancel = vi.fn();
  let request!: Promise<ElicitationResult>;
  act(() => {
    request = api.requestElicitation("call", "ask", url, controller.signal, onCancel);
  });
  act(() => api.resolveElicitation({ action: "accept" }));
  await request;
  act(() => {
    if (action === "cancel") api.resolveElicitation({ action: "cancel" });
    if (action === "abort") controller.abort();
    if (action === "clear") api.clearElicitation();
  });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(api.pendingElicitation).toBeNull();
  act(() => api.completeElicitation("auth"));
  expect(api.pendingElicitation).toBeNull();
});
