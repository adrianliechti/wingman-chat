// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { icons } from "lucide";
import { getValue } from "@a2ui/web_core/v1_0";
import { BASIC_CATALOG_ID, WINGMAN_CATALOG_ID } from "@/shared/lib/inlineUi/catalog";
import { InlineUiRuntime } from "@/shared/lib/inlineUi/runtime";
import {
  BasicIcon,
  BasicImage,
  BasicText,
  BASIC_ICONS,
  dateTimeInputType,
  dateTimeInputValue,
  dateTimeModelValue,
} from "./BasicContent";
import { InlineUiViewContext, NodeView } from "./NodeView";
import { iconKey } from "./UiIcon";

vi.mock("./WingmanComponent", () => ({
  WingmanComponent: ({ props }: { props: Record<string, unknown> }) => {
    if (props.value === "broken") throw new Error("Invalid resolved value");
    return <span>{String(props.value)}</span>;
  },
}));

let root: Root, container: HTMLDivElement;
const runtimes: InlineUiRuntime[] = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("TZ", "UTC");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  runtimes.splice(0).forEach((runtime) => runtime.dispose());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const render = async (node: ReactNode) => {
  await act(async () => root.render(node));
};
const input = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

async function surface(
  components: unknown[],
  dataModel: Record<string, unknown> = {},
  renderText?: (text: string) => ReactNode,
) {
  const runtime = new InlineUiRuntime();
  runtimes.push(runtime);
  runtime.sync([
    {
      key: "test",
      source: JSON.stringify({
        version: "v1.0",
        createSurface: { surfaceId: "main", catalogId: BASIC_CATALOG_ID, components, dataModel },
      }),
    },
  ]);
  const node = getValue(runtime.resolvers.get("main")!.rootNode)!;
  await render(
    <InlineUiViewContext value={{ streaming: false, renderText }}>
      <NodeView node={node} />
    </InlineUiViewContext>,
  );
  return runtime.getSurface("main")!.dataModel;
}

describe("standard icons", () => {
  const catalog = JSON.parse(
    readFileSync(new URL("./schemas/catalogs/basic/catalog.json", import.meta.resolve("@a2ui/web_core/v1_0")), "utf8"),
  );
  const names = catalog.components.Icon.properties.name.oneOf[0].enum as string[];

  it("maps every name in the pinned catalog to an installed icon", () => {
    expect(names).toHaveLength(59);
    expect(Object.keys(BASIC_ICONS).sort()).toEqual([...names].sort());
    for (const name of names)
      expect(icons[iconKey(BASIC_ICONS[name as keyof typeof BASIC_ICONS]) as keyof typeof icons], name).toBeDefined();
  });

  it.each(names)("renders %s without falling back", async (name) => {
    await render(<BasicIcon name={name} />);
    const svg = container.querySelector("svg")!;
    expect(svg.dataset.icon).toBe(iconKey(BASIC_ICONS[name as keyof typeof BASIC_ICONS]));
    expect(svg.children.length).toBeGreaterThan(0);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses a trash can for delete rather than Lucide's keyboard-delete symbol", async () => {
    await render(<BasicIcon name="delete" />);
    expect(container.querySelector("svg")?.dataset.icon).toBe("Trash2");
  });

  it("renders custom SVG paths as path data and handles unknown bound names", async () => {
    const path = "M0 0L24 24 <script>alert(1)</script>";
    await render(<BasicIcon name={{ svgPath: path }} />);
    expect(container.querySelector("path")?.getAttribute("d")).toBe(path);
    expect(container.querySelector("script")).toBeNull();
    await render(<BasicIcon name="notAnIcon" />);
    expect(container.querySelector("svg")?.dataset.icon).toBe("CircleHelp");
  });
});

describe("basic image presentation", () => {
  it.each([
    ["icon", "1.5rem", "1 / 1"],
    ["avatar", "3rem", "1 / 1"],
    ["smallFeature", "6rem", "1 / 1"],
    ["mediumFeature", "20rem", "16 / 9"],
    ["largeFeature", "30rem", "16 / 9"],
    ["header", "100%", "3 / 1"],
  ])("applies %s sizing and preserves accessibility", async (variant, width, aspectRatio) => {
    await render(<BasicImage url="https://example.com/photo.png" description="A mountain" variant={variant} />);
    const image = container.querySelector("img")!;
    expect(image.style.width).toBe(width);
    expect(image.style.aspectRatio).toBe(aspectRatio);
    expect(image.alt).toBe("A mountain");
    expect(image.classList.contains("rounded-full")).toBe(variant === "avatar");
  });

  it.each(["contain", "cover", "fill", "none", "scaleDown"])("maps %s to valid CSS", async (fit) => {
    await render(<BasicImage url="https://example.com/photo.png" fit={fit} />);
    const image = container.querySelector("img")!;
    expect(image.style.objectFit).toBe(fit === "scaleDown" ? "scale-down" : fit);
    expect(image.dataset.a2uiImageVariant).toBe("mediumFeature");
  });

  it("does not create active or local media URLs", async () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<script>alert(1)</script>"]) {
      await render(<BasicImage url={url} />);
      expect(container.querySelector("img")?.getAttribute("src")).toBeNull();
    }
  });
});

describe("basic text", () => {
  it("renders headings, formatting, nested lists, quotes and literal code", async () => {
    await render(
      <BasicText
        text={
          '# Title\n\n**Bold** and *emphasis*, ~~removed~~, `code`.\n\n1. First\n   - Nested\n\n> Quotation\n\n```ui\n{"component":"Button"}\n```'
        }
      />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("em")?.textContent).toBe("emphasis");
    expect(container.querySelector("s")?.textContent).toBe("removed");
    expect(container.querySelector("ol ul li")?.textContent).toContain("Nested");
    expect(container.querySelector("blockquote")?.textContent).toBe("Quotation");
    expect(container.querySelector("pre code")?.textContent).toBe('{"component":"Button"}');
    expect(container.querySelector("button, [data-a2ui-component]")).toBeNull();
  });

  it("keeps link and image labels without interactive elements or media", async () => {
    await render(
      <BasicText
        text={
          '[**Read** more](https://example.com) ![Scenic view](https://example.com/photo.png) <https://example.com>\n\n<img src="https://example.com/tracker" onerror="alert(1)">\n<script>alert(1)</script>\n<iframe src="https://example.com"></iframe>'
        }
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Read");
    expect(container.textContent).toContain("Scenic view");
    expect(container.querySelector("a, img, script, iframe, button")).toBeNull();
  });

  it("renders through the basic renderer even when the host supplies rich Markdown", async () => {
    const renderText = vi.fn(() => <button>Host extension</button>);
    await surface([{ id: "root", component: "Text", text: "## Inline title" }], {}, renderText);
    expect(container.querySelector("h2")?.textContent).toBe("Inline title");
    expect(renderText).not.toHaveBeenCalled();
  });
});

describe("ISO date and time bindings", () => {
  it.each([
    [undefined, undefined, "text"],
    [false, false, "text"],
    [true, undefined, "date"],
    [undefined, true, "time"],
    [true, true, "datetime-local"],
  ])("selects the native control for enableDate=%s enableTime=%s", (date, time, expected) => {
    expect(dateTimeInputType(date, time)).toBe(expected);
  });

  it("converts absolute timestamps to local input values, including offsets and bounds", () => {
    const value = "2026-10-11T19:20:30.123+02:00";
    expect(dateTimeInputValue(value, "datetime-local")).toBe("2026-10-11T17:20:30.123");
    expect(dateTimeInputValue(value, "date")).toBe("2026-10-11");
    expect(dateTimeInputValue(value, "time")).toBe("17:20:30.123");
    expect(dateTimeInputValue("2026-10-11T00:30:00+02:00", "date")).toBe("2026-10-10");
  });

  it("keeps date-only, time-only and floating local values without shifting their meaning", () => {
    expect(dateTimeInputValue("2026-10-11", "date")).toBe("2026-10-11");
    expect(dateTimeInputValue("19:20:30", "time")).toBe("19:20:30");
    expect(dateTimeInputValue("2026-10-11T19:20", "datetime-local")).toBe("2026-10-11T19:20");
    expect(dateTimeModelValue("2026-10-12", "2026-10-11", "date")).toBe("2026-10-12");
    expect(dateTimeModelValue("20:30", "19:20", "time")).toBe("20:30");
    expect(dateTimeModelValue("20:30", "19:20+02:00", "time")).toBe("20:30+02:00");
    expect(dateTimeModelValue("2026-10-12T20:30", "2026-10-11T19:20", "datetime-local")).toBe("2026-10-12T20:30");
  });

  it("writes partial edits as ISO timestamps without dropping hidden fields", () => {
    const original = "2026-10-11T19:20:30.123+02:00";
    expect(dateTimeModelValue("2026-10-12", original, "date")).toBe("2026-10-12T17:20:30.123Z");
    expect(dateTimeModelValue("18:40", original, "time")).toBe("2026-10-11T18:40:00.000Z");
    expect(dateTimeModelValue("2026-10-13T18:40", original, "datetime-local")).toBe("2026-10-13T18:40:00.000Z");
    expect(dateTimeModelValue("2026-10-11T17:20:30.123", original, "datetime-local")).toBe(original);
    expect(dateTimeModelValue("2026-10-12", "2026-10-11T19:20", "date")).toBe("2026-10-12T19:20");
  });

  it("handles unset values and invalid dates without throwing", () => {
    for (const value of [null, undefined, "", "not-a-date", "2026-99-99T19:20:30Z"]) {
      expect(dateTimeInputValue(value, "datetime-local")).toBe("");
    }
    expect(dateTimeModelValue("", "2026-10-11T19:20:30Z", "datetime-local")).toBe("");
  });

  it("preserves an unchanged instant during a repeated daylight-saving hour", () => {
    vi.stubEnv("TZ", "America/New_York");
    const original = "2026-11-01T06:30:00Z";
    expect(dateTimeInputValue(original, "datetime-local")).toBe("2026-11-01T01:30:00");
    expect(dateTimeModelValue("2026-11-01T01:30", original, "datetime-local")).toBe(original);
    expect(dateTimeModelValue("01:30", original, "time")).toBe(original);
  });

  it("renders the upstream invitation timestamp and persists native input edits", async () => {
    const model = await surface(
      [
        {
          id: "root",
          component: "DateTimeInput",
          label: "Event",
          value: { "@path": "/date" },
          enableDate: true,
          enableTime: true,
          min: "2025-07-01T00:00:00Z",
          max: "2025-07-31T23:59:00Z",
        },
      ],
      { date: "2025-07-15T19:00:00Z" },
    );
    const field = container.querySelector("input")!;
    expect(field.type).toBe("datetime-local");
    expect(field.value).toContain("2025-07-15T19:00");
    expect(field.min).toBe("2025-07-01T00:00:00");
    expect(field.max).toBe("2025-07-31T23:59:00");
    await input(field, "2025-07-16T20:30");
    expect(model.get("/date")).toBe("2025-07-16T20:30:00.000Z");
    await input(field, "");
    expect(model.get("/date")).toBe("");
  });

  it("does not enable a picker when both flags are omitted", async () => {
    await surface([{ id: "root", component: "DateTimeInput", value: { "@path": "/date" } }], { date: "2025-07-15" });
    const field = container.querySelector("input")!;
    expect(field.type).toBe("text");
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe("2025-07-15");
  });
});

it("isolates component render failures and recovers after a data update", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const model = await surface(
    [
      { id: "root", component: "Column", children: ["metric", "sibling"] },
      {
        id: "metric",
        component: "Metric",
        catalogId: WINGMAN_CATALOG_ID,
        label: "Broken",
        value: { "@path": "/value" },
      },
      { id: "sibling", component: "Text", text: "Still visible" },
    ],
    { value: "broken" },
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Cannot render Metric.");
  expect(container.textContent).toContain("Still visible");
  await act(async () => model.set("/value", "Recovered"));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Recovered");
  expect(container.textContent).toContain("Still visible");
});
