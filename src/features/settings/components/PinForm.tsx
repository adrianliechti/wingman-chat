import { useId } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";

interface PinFormProps {
  title: string;
  description?: string;
  fields: { label: string; value: string; setter: (value: string) => void }[];
  error: string | null;
  busy: boolean;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function PinForm({
  title,
  description,
  fields,
  error,
  busy,
  onSubmit,
  onCancel,
  confirmLabel = "Save",
  cancelLabel = "Cancel",
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
        <h4 id={`${formId}-title`} className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          {title}
        </h4>
        {description && <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">{description}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.label} className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {field.label}
            <input
              type="password"
              value={field.value}
              disabled={busy}
              autoComplete={field.label === "Current PIN" ? "current-password" : "new-password"}
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-500 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        >
          {busy && <LoaderCircle size={13} aria-hidden="true" className="animate-spin" />}
          {busy ? "Saving…" : confirmLabel}
        </button>
      </div>
    </form>
  );
}
