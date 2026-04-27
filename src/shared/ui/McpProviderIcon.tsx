import { Server } from "lucide-react";
import { useState } from "react";

interface McpProviderIconProps {
  src: string;
  size?: number;
  className?: string;
}

/**
 * Renders an MCP provider icon from a URL (server-published icon or favicon).
 * Falls back to the Lucide Server icon if the image fails to load.
 */
export function McpProviderIcon({ src, size = 14, className }: McpProviderIconProps) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);
  const errored = erroredSrc === src;

  if (errored) {
    return <Server size={size} className={className} />;
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className ?? "shrink-0 object-contain"}
      style={{ width: size, height: size }}
      onError={() => setErroredSrc(src)}
    />
  );
}
