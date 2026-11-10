import type { ReactNode } from "react";

/** The label at the left edge of a pane header: what the pane holds. Its icon sits on the pane's inset. */
export const PANE_LABEL_CLASS =
  "inline-flex min-w-0 items-center gap-1.5 py-1.5 pr-3 text-sm text-neutral-700 dark:text-neutral-300";

/** Left inset shared by a pane's header, text column and footer, so their left edges line up. */
export const PANE_INSET_CLASS = "pl-5 md:pl-8";

/**
 * Header row of one workbench pane: a label or picker at the left edge saying
 * what the pane holds, and actions at the right edge. The same height in both
 * panes, so the two headers read as one row across the divider.
 */
export function PaneHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`flex h-12 shrink-0 items-center gap-2 pr-2 ${PANE_INSET_CLASS}`}>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
