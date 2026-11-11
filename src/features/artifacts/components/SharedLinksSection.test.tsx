// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getConfirmRequest, settleConfirm } from "@/shared/lib/confirm";
import { SharedLinksSection } from "./SharedLinksSection";

const share = (id: string, title: string) => ({
  id,
  url: `/artifacts/${id}`,
  title,
  entry: "index.html",
  files: 3,
  size: 2048,
  created: "2026-10-22T12:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
});

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/** Serves `GET /artifacts` from `list` and records every other request. */
function serve(list: () => Response, other: (url: string, init?: RequestInit) => Response = () => new Response()) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      return method === "GET" && url === "/artifacts" ? list() : other(url, init);
    }),
  );
  return calls;
}

const render = () => act(async () => root.render(<SharedLinksSection />));
const rows = () => [...container.querySelectorAll("li")].map((row) => row.textContent);
const button = (name: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

it("lists the user's links and removes one once the server has revoked it", async () => {
  const calls = serve(() => Response.json([share("abc", "Q3 deck"), share("def", "Budget")]));
  await render();

  expect(rows()).toEqual([expect.stringContaining("Q3 deck"), expect.stringContaining("Budget")]);
  // The date follows the viewer's locale.
  expect(rows()[0]).toMatch(/3 files · 2 KB · Expires .*2099/);
  expect(container.querySelector('a[aria-label="Open Q3 deck"]')?.getAttribute("href")).toMatch(/\/artifacts\/abc$/);

  // Declining the question leaves the link shared.
  await act(async () => button("Stop sharing Q3 deck").click());
  expect(getConfirmRequest()).toMatchObject({ title: "Stop sharing “Q3 deck”?", danger: true });
  await act(async () => settleConfirm(false));
  expect(calls).toEqual(["GET /artifacts"]);
  expect(rows()).toHaveLength(2);

  await act(async () => button("Stop sharing Q3 deck").click());
  await act(async () => settleConfirm(true));

  expect(calls).toEqual(["GET /artifacts", "DELETE /artifacts/abc"]);
  expect(rows()).toEqual([expect.stringContaining("Budget")]);
});

it("keeps a link listed when revoking fails", async () => {
  serve(
    () => Response.json([share("abc", "Q3 deck")]),
    () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  await render();

  await act(async () => button("Stop sharing Q3 deck").click());
  await act(async () => settleConfirm(true));

  expect(rows()).toEqual([expect.stringContaining("Q3 deck")]);
  expect(button("Stop sharing Q3 deck").disabled).toBe(false);
});

it("says so when nothing is shared, when the server keeps no list, and when loading fails", async () => {
  serve(() => Response.json([]));
  await render();
  expect(container.textContent).toContain("Nothing is shared right now.");

  serve(() => new Response("shares are listed per signed-in user\n", { status: 403 }));
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain("does not know who is signed in");

  let healthy = false;
  serve(() => (healthy ? Response.json([share("abc", "Q3 deck")]) : new Response("", { status: 500 })));
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(container.textContent).toContain("The shared links could not be loaded (500).");

  healthy = true;
  const retry = [...container.querySelectorAll("button")].find((item) => item.textContent === "Try again")!;
  await act(async () => retry.click());
  expect(rows()).toEqual([expect.stringContaining("Q3 deck")]);
});
