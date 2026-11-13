import { useId } from "react";
import { ArrowLeft, LoaderCircle, TriangleAlert } from "lucide-react";

interface PinFormProps {
  title: string;
  description?: string;
  warning?: string;
  /** "current" fields accept the existing PIN; others choose a new one. */
  fields: { label: string; value: string; setter: (value: string) => void; current?: boolean }[];
  error: string | null;
  busy: boolean;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
  busyLabel?: string;
  cancelLabel?: string;
  autoFocus?: boolean;
}

export function PinForm({
  title,
  description,
  warning,
  fields,
  error,
  busy,
  onSubmit,
  onCancel,
  confirmLabel = "Save",
  busyLabel = "Saving…",
  cancelLabel = "Cancel",
  autoFocus = false,
}: PinFormProps) {
  const formId = useId();
  return (
    <form
      className="space-y-4"
      aria-labelledby={`${formId}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <div className="space-y-1.5">
        <h4 id={`${formId}-title`} className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
          {title}
        </h4>
        {description && <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</p>}
      </div>
      {warning && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <TriangleAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{warning}</span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field, index) => (
          <label
            key={field.label}
            className={`block text-xs font-medium text-neutral-700 dark:text-neutral-300 ${field.label === "New PIN" ? "sm:col-start-1" : ""}`}
          >
            {field.label}
            <input
              type="password"
              value={field.value}
              disabled={busy}
              autoFocus={autoFocus && index === 0}
              autoComplete={field.current ? "current-password" : "new-password"}
              aria-describedby={error ? `${formId}-error` : undefined}
              onChange={(event) => field.setter(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-normal text-neutral-900 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
            />
          </label>
        ))}
      </div>
      {error && (
        <p id={`${formId}-error`} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-500 transition-colors hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          {cancelLabel === "Back" && <ArrowLeft size={13} aria-hidden="true" />}
          {cancelLabel}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center justify-center justify-self-end gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {busy && <LoaderCircle size={13} aria-hidden="true" className="animate-spin" />}
          {busy ? busyLabel : confirmLabel}
        </button>
      </div>
    </form>
  );
}
