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

/** Whether a URL is safe to mask: cross-origin SVGs need CORS, which most icon hosts lack. */
function isMaskable(src: string): boolean {
  if (src.startsWith("data:")) return true;
  try {
    return new URL(src, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

/**
 * Renders an MCP provider icon from a URL (server-published icon or favicon).
 *
 * Same-origin SVGs are tinted via a CSS mask so they follow the surrounding text
 * color; cross-origin SVGs skip the mask (CORS) and render as a plain `<img>`.
 * Raster logos keep their colors and fall back to the Server icon on load failure.
 */
export function McpProviderIcon({ src, size = 14, className }: McpProviderIconProps) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  if (isSvgSource(src) && isMaskable(src)) {
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
