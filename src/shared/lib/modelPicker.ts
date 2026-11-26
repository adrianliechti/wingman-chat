import type { Model } from "@/shared/types/chat";

export interface ModelPickerTiers {
  /** Rows the picker lists itself. */
  quick: Model[];
  /** The complete list, one level down; empty when `quick` already is the complete list. */
  all: Model[];
  /** Offered only on request (Option-click). */
  hidden: Model[];
}

/**
 * Splits a picker's models into the rows it lists itself and the complete list
 * one level down. Without a slider the picker lists every visible model itself;
 * with one, only featured models stay below it and the list moves behind it.
 * `exclude` names a model the slider already offers as its own stop.
 */
export function modelPickerTiers(
  models: readonly Model[],
  { slider = false, exclude }: { slider?: boolean; exclude?: string } = {},
): ModelPickerTiers {
  const selectable = models.filter((model) => model.id !== "realtime");
  const visible = selectable.filter((model) => !model.hidden);
  const hidden = selectable.filter((model) => model.hidden);
  if (!slider) return { quick: visible, all: [], hidden };
  const quick = visible.filter((model) => model.featured && model.id !== exclude);
  const more = visible.some((model) => !quick.includes(model) && model.id !== exclude);
  return { quick, all: more ? visible : [], hidden };
}
