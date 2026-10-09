import { createElement, memo, type SVGProps, useEffect, useState } from "react";
import { stringify } from "@/shared/lib/intelligentUi/expression";

type IconNode = [string, Record<string, string | number>][];
type IconSet = Record<string, IconNode>;

// The full Lucide set (about 2,100 icons as path data) is one lazy chunk,
// loaded on the first icon and shared by every icon after it. Per-icon code
// splitting would scatter thousands of tiny files through the build instead.
let iconSet: IconSet | null = null;
let iconSetPromise: Promise<IconSet> | null = null;

function loadIcons(): Promise<IconSet> {
  iconSetPromise ??= import("lucide").then((module) => {
    iconSet = module.icons as IconSet;
    return iconSet;
  });
  return iconSetPromise;
}

/** Lucide icon names are kebab-case (`chef-hat`); tolerate PascalCase, spaces and underscores from the model. */
export function iconKey(raw: unknown): string {
  return stringify(raw)
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

const FALLBACK = "CircleHelp";

export interface UiIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: unknown;
  size?: number;
}

/** A Lucide icon by name, drawn from the shared icon set; unknown names show a help circle. */
export const UiIcon = memo(function UiIcon({ name, size = 20, ...rest }: UiIconProps) {
  const [icons, setIcons] = useState<IconSet | null>(iconSet);
  useEffect(() => {
    if (icons) return;
    let cancelled = false;
    loadIcons()
      .then((loaded) => {
        if (!cancelled) setIcons(loaded);
      })
      .catch((error) => console.error("Failed to load icons:", error));
    return () => {
      cancelled = true;
    };
  }, [icons]);

  const key = iconKey(name);
  const node = icons ? (icons[key] ?? icons[FALLBACK]) : null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-icon={key}
      {...rest}
    >
      {node?.map(([tag, attrs], index) => createElement(tag, { ...attrs, key: index }))}
    </svg>
  );
});
