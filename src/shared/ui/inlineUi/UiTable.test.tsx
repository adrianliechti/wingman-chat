// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiTable } from "./UiTable";

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
const rows = Array.from({ length: 20 }, (_, index) => ({ value: index + 1 }));
const render = (count: number, pageSize = 2) =>
  act(async () => root.render(<UiTable rows={rows.slice(0, count)} pageSize={pageSize} />));
const click = (name: string) =>
  act(async () => container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!.click());
const cells = () => [...container.querySelectorAll("tbody td")].map((cell) => cell.textContent);

it("navigates from the visible page immediately after bound data shrinks", async () => {
  await render(20);
  for (let i = 0; i < 8; i++) await click("Next page");
  expect(cells()).toEqual(["17", "18"]);
  await render(4);
  expect(cells()).toEqual(["3", "4"]);
  await click("Previous page");
  expect(cells()).toEqual(["1", "2"]);
});

it("uses whole pages for fractional page sizes", async () => {
  await render(6, 2.8);
  expect(cells()).toEqual(["1", "2"]);
  await click("Next page");
  expect(cells()).toEqual(["3", "4"]);
});

it("exposes sortable headers as native keyboard controls", async () => {
  await render(4);
  const button = container.querySelector<HTMLButtonElement>("th button");
  expect(button).not.toBeNull();
  await act(async () => button!.click());
  expect(container.querySelector("th")?.getAttribute("aria-sort")).toMatch(/ascending|descending/);
});
