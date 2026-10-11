// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UiChart, type UiChartProps } from "./UiChart";

vi.mock("@/shell/hooks/useTheme", () => ({ useTheme: () => ({ theme: "light", isDark: false, setTheme: () => {} }) }));

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  if (typeof ResizeObserver === "undefined") {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

const sales = [
  { quarter: "Q1", eu: 120, us: 98 },
  { quarter: "Q2", eu: 132, us: 115 },
  { quarter: "Q3", eu: 141, us: 119 },
];

async function render(element: React.ReactElement) {
  await act(async () => {
    root!.render(element);
  });
}

it("renders a multi-series bar chart as SVG with a legend and title", async () => {
  await render(
    <UiChart kind="bar" data={sales} x="quarter" series={["eu", { key: "us", label: "US" }]} title="Revenue" />,
  );
  expect(container.textContent).toContain("Revenue");
  const svg = container.querySelector("svg");
  expect(svg).not.toBeNull();
  expect(svg?.getAttribute("aria-label") ?? container.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe(
    "Revenue",
  );
  expect(container.querySelectorAll("rect, path").length).toBeGreaterThan(0);
  expect(container.textContent).toContain("US");
  expect(container.textContent).toContain("eu");
});

it("renders line, area, scatter and donut kinds from number arrays and objects", async () => {
  await render(<UiChart kind="line" data={[1, 4, 9, 16]} title="Squares" />);
  expect(container.querySelector("svg")).not.toBeNull();
  await render(<UiChart kind="area" data={sales} stacked />);
  expect(container.querySelector("svg")).not.toBeNull();
  await render(
    <UiChart
      kind="scatter"
      data={[
        { x: 1, y: 2 },
        { x: 3, y: 5 },
      ]}
    />,
  );
  expect(container.querySelector("svg")).not.toBeNull();
  await render(
    <UiChart
      kind="donut"
      data={[
        { name: "A", v: 3 },
        { name: "B", v: 1 },
      ]}
    />,
  );
  expect(container.querySelector("svg")).not.toBeNull();
  expect(container.textContent).toContain("A");
});

it("shows an empty state without data", async () => {
  await render(<UiChart kind="bar" data={[]} />);
  expect(container.textContent).toContain("No data to chart");
  expect(container.querySelector("svg")).toBeNull();
});

it("keeps distinct series separate when their display labels match", async () => {
  await render(
    <UiChart
      kind="line"
      data={sales}
      x="quarter"
      series={[
        { key: "eu", label: "Revenue" },
        { key: "us", label: "Revenue" },
      ]}
    />,
  );
  expect(container.querySelectorAll('svg path[stroke="#2a78d6"]')).toHaveLength(1);
  expect(container.querySelectorAll('svg path[stroke="#eb6834"]')).toHaveLength(1);
});

it.each(["pie", "donut"] as const)(
  "keeps all %s categories and calculates shares from the full total",
  async (kind) => {
    await render(
      <UiChart kind={kind} data={Array.from({ length: 10 }, (_, i) => ({ name: `Category ${i + 1}`, value: 1 }))} />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(10);
    for (const [index, item] of [...items].entries()) {
      expect(item.textContent).toBe(`Category ${index + 1}10%`);
    }
  },
);

it.each([null, [null], [7], [{ key: null }]])("handles invalid resolved chart series %j", async (series) => {
  await render(<UiChart kind="bar" data={sales} series={series as unknown as UiChartProps["series"]} />);
  expect(container.textContent).toContain("No data to chart");
  expect(container.querySelector("svg")).toBeNull();
  await render(<UiChart kind="bar" data={sales} series={["eu"]} />);
  expect(container.querySelector("svg")).not.toBeNull();
});

it("overlaps area comparisons unless stacking is explicitly requested", async () => {
  const maximumTick = () =>
    Math.max(
      ...[...container.querySelectorAll("svg text")].map((node) => Number(node.textContent)).filter(Number.isFinite),
    );
  await render(<UiChart kind="area" data={sales} x="quarter" series={["eu", "us"]} />);
  expect(maximumTick()).toBeGreaterThanOrEqual(141);
  expect(maximumTick()).toBeLessThan(200);
  await render(<UiChart kind="area" data={sales} x="quarter" series={["eu", "us"]} stacked />);
  expect(maximumTick()).toBeGreaterThanOrEqual(260);
});
