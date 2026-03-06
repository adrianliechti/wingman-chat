import { useTheme } from '@/shell/hooks/useTheme';
import type { ToolIconUrl } from '@/shared/types/chat';

interface ToolIconRendererProps {
  icon: ToolIconUrl[];
  size: number;
  className?: string;
}

/**
 * Renders the best icon from a list of MCP icon entries.
 *
 * Selection priority:
 * 1. Match current theme (light/dark), then theme-neutral, then opposite theme
 * 2. Prefer SVG (image/svg+xml) over raster formats
 * 3. Fall back to first available
 *
 * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/index#icons
 */
export function ToolIconRenderer({ icon: icons, size, className = '' }: ToolIconRendererProps) {
  const { isDark } = useTheme();

  if (!Array.isArray(icons) || icons.length === 0) return null;

  const preferred = isDark ? 'dark' : 'light';
  const opposite = isDark ? 'light' : 'dark';

  const themed = icons.filter(i => i.theme === preferred);
  const neutral = icons.filter(i => !i.theme);
  const other = icons.filter(i => i.theme === opposite);
  const ranked = [...themed, ...neutral, ...other];

  const svg = ranked.find(i => i.mimeType === 'image/svg+xml');
  const best = svg ?? ranked[0];

  return (
    <img
      src={best.src}
      width={size}
      height={size}
      alt=""
      className={`shrink-0 ${className}`}
    />
  );
}
