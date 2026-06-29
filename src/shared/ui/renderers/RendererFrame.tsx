import type { ReactNode } from "react";

interface RendererFrameProps {
  /** Leading uppercase tag (usually the language). */
  label: string;
  /** Optional secondary caption after the label (a title or filename). */
  name?: string;
  /** Action buttons (preview toggle, copy…); revealed on hover. */
  actions?: ReactNode;
  children: ReactNode;
}

// Shared chrome for code/preview blocks: the language tag + actions sit on a row
// *above* a borderless, faintly tinted content card. Keep this in sync with
// CodeRenderer, which renders the same frame.
export function RendererFrame({ label, name, actions, children }: RendererFrameProps) {
  return (
    <div className="relative my-4">
      {(label || name || actions) && (
        <div className="flex items-center justify-between gap-2 mb-1 text-[10px] text-neutral-400 dark:text-neutral-500">
          <span className="truncate font-medium uppercase tracking-wide">
            {label}
            {name && <span className="ml-1.5 font-normal normal-case">• {name}</span>}
          </span>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="relative overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-900/40">{children}</div>
    </div>
  );
}
