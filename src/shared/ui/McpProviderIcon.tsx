import { Server } from "lucide-react";
import { useState } from "react";

interface McpProviderIconProps {
  src: string;
  size?: number;
  className?: string;
}

/** Whether a source is an SVG (by extension or data URI) — those we can recolor. */
function isSvgSource(src: string): boolean {
  return /\.svg(\?|#|$)/i.test(src) || src.startsWith("data:image/svg+xml");
}

/**
 * Renders an MCP provider icon from a URL (server-published icon or favicon).
 *
 * SVG sources are tinted to `currentColor` via a CSS mask, so a monochrome logo
 * follows the surrounding text color and stays visible in dark mode. Raster logos
 * keep their real colors and fall back to the Lucide Server icon if they fail to
 * load (a mask can't report load errors, so SVGs just render blank if missing).
 */
export function McpProviderIcon({ src, size = 14, className }: McpProviderIconProps) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  if (isSvgSource(src)) {
    return (
      <span
        aria-hidden
        className={className ?? "shrink-0"}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          backgroundColor: "currentColor",
          maskImage: `url("${src}")`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
          WebkitMaskImage: `url("${src}")`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
        }}
      />
    );
  }

  if (erroredSrc === src) {
    return <Server size={size} className={className} />;
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className ?? "shrink-0 object-contain"}
      onError={() => setErroredSrc(src)}
    />
  );
}
