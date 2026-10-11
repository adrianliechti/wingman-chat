import { createElement, isValidElement, memo, type ReactNode, useMemo } from "react";
import { sanitizeHtmlToReact, svgAttributeName } from "@/shared/lib/htmlToReact";

export interface UiSvgProps {
  /** SVG markup, already template-resolved, so attribute values follow state. */
  markup: string;
  height?: number;
  label?: string;
}

// Inline SVG profile: shapes, text, gradients, filters and SMIL animation, with
// scripts, foreign objects, event handlers and external references removed.
const SVG_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ["animate", "set"],
  FORBID_TAGS: ["script", "foreignObject", "use", "image"],
  FORBID_ATTR: ["href", "xlink:href"],
};

// The root element is rebuilt from an allowlist, so only sizing and
// presentation attributes survive on it whatever the sanitizer does with it.
const ROOT_ATTRIBUTES = new Set([
  "viewBox",
  "width",
  "height",
  "preserveAspectRatio",
  "fill",
  "fill-rule",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
]);

const ROOT_TAG = /<svg\b([^>]*)>/i;
const ATTRIBUTE = /([A-Za-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function rootAttributes(markup: string): Record<string, string> {
  const props: Record<string, string> = {};
  const match = ROOT_TAG.exec(markup);
  if (!match) return props;
  for (const attribute of match[1].matchAll(ATTRIBUTE)) {
    const name = attribute[1];
    if (ROOT_ATTRIBUTES.has(name)) props[svgAttributeName(name)] = attribute[2] ?? attribute[3] ?? "";
  }
  return props;
}

function stripOuterWrapper(markup: string): string {
  // Models sometimes wrap the drawing in a fence label or a paragraph of text.
  const start = markup.indexOf("<svg");
  const end = markup.lastIndexOf("</svg>");
  return start >= 0 && end > start ? markup.slice(start, end + 6) : markup;
}

/** The sanitized drawing's content: the root's children when the sanitizer kept the root, else every node. */
function innerNodes(nodes: ReactNode[]): ReactNode[] {
  const first = nodes[0];
  if (nodes.length === 1 && isValidElement<{ children?: ReactNode }>(first) && first.type === "svg") {
    const children = first.props.children;
    return Array.isArray(children) ? children : children === undefined ? [] : [children];
  }
  return nodes;
}

/**
 * A declarative drawing whose attributes are templates: as state changes, the
 * same elements receive new transforms, opacity or colours, and CSS transitions
 * animate between them. Elements keep their identity across renders because
 * the markup structure is stable; only values change.
 */
export const UiSvg = memo(function UiSvg({ markup, height, label }: UiSvgProps) {
  const drawing = useMemo(() => {
    const source = stripOuterWrapper(markup);
    const nodes = innerNodes(sanitizeHtmlToReact(source, { config: SVG_CONFIG, namespace: "svg" }));
    if (!nodes.length) return null;
    return createElement("svg", { xmlns: "http://www.w3.org/2000/svg", ...rootAttributes(source) }, ...nodes);
  }, [markup]);
  return (
    <div
      role="img"
      aria-label={label}
      className="w-full overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-900/60 [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full [&_svg_*]:transition-[transform,opacity,fill,stroke,stroke-width] [&_svg_*]:duration-300 [&_svg_*]:ease-out [&_svg_*]:[transform-box:fill-box]"
      style={height ? { maxHeight: height } : undefined}
    >
      {drawing ?? <p className="p-3 text-xs text-neutral-500">No drawing to show.</p>}
    </div>
  );
});
