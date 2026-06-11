import { AlertCircle, FileCode, FileJson, FileText, ImageIcon, X } from "lucide-react";
import type { ExportFormat } from "../lib/output-export";

export interface ExportModalOption {
  /** Icon component (a Lucide icon). */
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  /** Subtitle override shown when `disabled` is true (e.g. "No contracts to export"). */
  disabledReason?: string;
}

interface ExportModalProps {
  title: string;
  options: ExportModalOption[];
  onClose: () => void;
  /** When true, the close button is disabled (e.g. while an export is rasterising). */
  busy?: boolean;
  /** Error from the last export attempt — shown above the options. */
  error?: string | null;
  /** Width in px — defaults to 320. Wider for catalogs that show longer subtitles. */
  width?: number;
}

/**
 * Centered export modal shared by the architecture and data-catalog viewers.
 * Visually mirrors the slide-export overlay in `StudioPanel` so the entry
 * point feels consistent across output types.
 */
export function ExportModal({ title, options, onClose, busy = false, error = null, width = 320 }: ExportModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        style={{ width }}
        className="bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-700 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-40"
          >
            <X size={14} className="text-neutral-400" />
          </button>
        </div>
        <div className="p-3 space-y-1">
          {error && (
            <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 px-3 py-2.5 rounded-lg mb-2">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {options.map((opt) => (
            <ExportRow key={opt.title} option={opt} busy={busy} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers shared across export-modal callers ─────────────────────────

const EXPORT_ICONS: Record<string, typeof FileText> = {
  png: ImageIcon,
  svg: FileCode,
  pdf: FileText,
  dcat: FileJson,
  odcs: FileText,
  openlineage: FileCode,
};

/** Map `getExportFormats(output)` output into `ExportModalOption[]` ready
 *  for the modal — picks the right icon per format id and wires the click. */
export function exportFormatsToOptions(
  formats: ExportFormat[],
  onPick: (format: ExportFormat) => void,
): ExportModalOption[] {
  return formats.map((f) => ({
    icon: EXPORT_ICONS[f.id] ?? FileText,
    title: f.label,
    subtitle: f.description,
    disabled: f.disabled,
    disabledReason: f.disabledReason,
    onClick: () => onPick(f),
  }));
}

function ExportRow({ option, busy }: { option: ExportModalOption; busy: boolean }) {
  const Icon = option.icon;
  const disabled = busy || option.disabled;
  const subtitle = option.disabled && option.disabledReason ? option.disabledReason : option.subtitle;
  return (
    <button
      type="button"
      onClick={option.onClick}
      disabled={disabled}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors text-left disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon size={16} className="text-neutral-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{option.title}</p>
        <p className="text-xs text-neutral-400">{subtitle}</p>
      </div>
    </button>
  );
}
