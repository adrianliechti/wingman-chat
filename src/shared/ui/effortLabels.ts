import type { Model } from "@/shared/types/chat";

type Effort = NonNullable<Model["effort"]>;

// One name per API level — `xhigh` and `max` are distinct tiers, so they must
// not share a label. Names follow the vendor consoles (…/Extra/Max).
export const EFFORT_LABEL: Record<Effort, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};
