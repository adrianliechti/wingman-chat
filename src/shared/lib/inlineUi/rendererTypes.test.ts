import { expectTypeOf, it } from "vitest";
import type { ComponentNode } from "@a2ui/web_core/v1_0";
import type { BasicProps, WingmanProps } from "./rendererTypes";
import type { ComponentProps } from "react";
import type { BasicRenderers, WingmanRenderers } from "@/shared/ui/inlineUi/rendererRegistry";

it("preserves resolved types instead of widening dynamic props to any", () => {
  expectTypeOf<BasicProps["Text"]["text"]>().toEqualTypeOf<string>();
  expectTypeOf<BasicProps["CheckBox"]["value"]>().toEqualTypeOf<boolean>();
  expectTypeOf<BasicProps["TextField"]["value"]>().toEqualTypeOf<string | undefined>();
  expectTypeOf<BasicProps["ChoicePicker"]["value"]>().toEqualTypeOf<string[]>();
  expectTypeOf<BasicProps["Button"]["action"]>().toEqualTypeOf<() => Promise<void>>();
  expectTypeOf<BasicProps["Card"]["child"]>().toEqualTypeOf<ComponentNode>();
  expectTypeOf<BasicProps["Tabs"]["tabs"][number]["child"]>().toEqualTypeOf<ComponentNode>();
  expectTypeOf<WingmanProps["Metric"]["delta"]>().toEqualTypeOf<number | undefined>();
  expectTypeOf<WingmanProps["Grid"]["children"]>().toEqualTypeOf<ComponentNode[]>();
  expectTypeOf<WingmanProps["Chart"]["kind"]>().toEqualTypeOf<"line" | "area" | "bar" | "pie" | "donut" | "scatter">();
  expectTypeOf<NonNullable<WingmanProps["Table"]["columns"]>[number]["label"]>().toEqualTypeOf<string | undefined>();
  expectTypeOf<WingmanProps["Select"]["options"][number]["label"]>().toEqualTypeOf<string>();
  expectTypeOf<WingmanProps["Toggle"]["value"]>().toEqualTypeOf<boolean>();
  expectTypeOf<ComponentProps<WingmanRenderers["Toggle"]>["change"]>().toEqualTypeOf<(value: boolean) => void>();
  expectTypeOf<ComponentProps<BasicRenderers["ChoicePicker"]>["change"]>().toEqualTypeOf<(value: string[]) => void>();
});

it("rejects incompatible renderer props while preserving optional schema fields", () => {
  const chart: WingmanProps["Chart"] = { kind: "bar", data: [{ month: "Jan", total: 12 }] };
  // @ts-expect-error Unknown chart kinds must not pass through a dynamic any.
  chart.kind = "radar";
  // @ts-expect-error Nested resolved labels must stay strings.
  const column: NonNullable<WingmanProps["Table"]["columns"]>[number] = { key: "total", label: 42 };
  // @ts-expect-error Controls write their standard types, not string equivalents.
  const toggle: WingmanProps["Toggle"] = { value: "true" };
  // @ts-expect-error This legacy renderer option is not in the catalog.
  const select: WingmanProps["Select"] = { value: "a", options: [], placeholder: "Choose" };
  expectTypeOf(chart).toExtend<WingmanProps["Chart"]>();
  void column;
  void toggle;
  void select;
});
