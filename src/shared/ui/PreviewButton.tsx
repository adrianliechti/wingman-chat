import { Code, Eye } from "lucide-react";
import { ACTION_ICON_SIZE, actionButtonClassName } from "./actionButton";

type PreviewButtonProps = {
  showCode: boolean;
  onToggle: () => void;
  className?: string;
  /** Render as a small labeled action button (icon + "Code"/"Preview"). */
  label?: boolean;
};

export const PreviewButton = ({ showCode, onToggle, className, label }: PreviewButtonProps) => {
  const title = showCode ? "Show preview" : "Show code";
  const Icon = showCode ? Eye : Code;

  if (label) {
    return (
      <button type="button" onClick={onToggle} className={actionButtonClassName} title={title}>
        <Icon size={ACTION_ICON_SIZE} />
        <span>{showCode ? "Preview" : "Code"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-300 transition-colors opacity-60 hover:opacity-100 p-1"
      title={title}
    >
      <Icon className={className || "h-4 w-4"} />
    </button>
  );
};
