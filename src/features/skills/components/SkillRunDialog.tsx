import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Check, ChevronDown, Loader2, Play, Upload, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { cn } from "@/shared/lib/cn";
import { formatBytes } from "@/shared/lib/utils";
import { FileIcon } from "@/shared/ui/FileIcon";
import { SelectMenu } from "@/shared/ui/SelectMenu";
import { buttonClass, fieldLabelClass, inputClass, primaryButtonClass } from "@/shared/ui/forms/controlStyles";
import { defaultRunValues, type RunFiles, type RunValues, type SkillWorkflow } from "../lib/runForm";

function FileSlot({
  id,
  label,
  accept,
  required,
  file,
  disabled,
  fullWidth,
  onChange,
}: {
  id: string;
  label: string;
  accept: string[];
  required: boolean;
  file?: File;
  disabled: boolean;
  fullWidth: boolean;
  onChange: (file: File | undefined) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const choose = (selected: File[]) => {
    setDragging(false);
    if (disabled || !selected.length) return;
    if (selected.length !== 1) {
      setError("Choose one document for this version.");
      return;
    }
    if (!accept.some((extension) => selected[0].name.toLowerCase().endsWith(extension))) {
      setError(`Choose ${accept.join(", ")}.`);
      return;
    }
    setError("");
    onChange(selected[0]);
  };
  return (
    <div className={cn("min-w-0", fullWidth && "sm:col-span-2")}>
      <label htmlFor={id} className={cn(fieldLabelClass, "mb-1.5 block")}>
        {label}
        {!required && " (optional)"}
      </label>
      <div
        className="relative"
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
            setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          choose(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          id={id}
          type="file"
          aria-label={label}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={`${id}-hint`}
          accept={accept.join(",")}
          disabled={disabled}
          className="peer sr-only"
          onChange={(event) => {
            choose(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <label
          htmlFor={id}
          className={cn(
            "flex min-h-28 sm:min-h-36 min-w-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-4 sm:py-5 text-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-neutral-400 peer-focus-visible:ring-offset-2 dark:peer-focus-visible:ring-offset-neutral-950",
            file
              ? "border-solid border-neutral-300 bg-neutral-50/60 dark:border-neutral-600 dark:bg-neutral-900"
              : "border-neutral-300 bg-neutral-50/30 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/40 dark:hover:border-neutral-500",
            dragging && "border-neutral-500 bg-neutral-100 dark:border-neutral-400 dark:bg-neutral-800",
            disabled && "cursor-wait",
          )}
        >
          {file ? (
            <FileIcon name={file.name} contentType={file.type} size={25} />
          ) : (
            <Upload size={23} strokeWidth={1.5} className="text-neutral-400" />
          )}
          <span
            className="max-w-full truncate text-sm font-medium text-neutral-700 dark:text-neutral-200"
            title={file?.name}
          >
            {file?.name ?? "Choose a document"}
          </span>
          <span className="text-xs text-neutral-400">
            {file ? `${formatBytes(file.size)} · Click to replace` : "or drop it here"}
          </span>
          {file && <Check size={14} className="absolute left-3 top-3 text-neutral-500" aria-hidden="true" />}
        </label>
        {file && (
          <button
            type="button"
            disabled={disabled}
            aria-label={`Remove ${label}`}
            onClick={() => {
              onChange(undefined);
              setError("");
            }}
            className="absolute right-2 top-2 rounded-md p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <p
        id={`${id}-hint`}
        role={error ? "alert" : undefined}
        className={cn("mt-1.5 text-xs", error ? "text-red-600 dark:text-red-400" : "text-neutral-400")}
      >
        {error || accept.map((ext) => ext.slice(1).toUpperCase()).join(", ")}
      </p>
    </div>
  );
}

export function SkillRunDialog({
  workflow,
  contextLabel,
  onClose,
  onRun,
}: {
  workflow: SkillWorkflow;
  contextLabel: string;
  onClose: () => void;
  onRun: (values: RunValues, files: RunFiles) => Promise<void>;
}) {
  const id = useId();
  const [values, setValues] = useState(() => defaultRunValues(workflow.form));
  const [files, setFiles] = useState<RunFiles>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onRun(values, files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start this workflow. Try again.");
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      className="fixed inset-0 z-90"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-3 sm:p-6">
        <DialogPanel className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-950">
          <form noValidate onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col">
            <div className="flex shrink-0 items-start gap-4 px-6 pt-6">
              <div className="flex-1">
                <DialogTitle className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {workflow.form.title}
                </DialogTitle>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{workflow.form.description}</p>
              </div>
              <button
                type="button"
                aria-label="Close workflow"
                disabled={busy}
                onClick={onClose}
                className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto px-6 py-5">
              {workflow.form.atLeastOneOf && (
                <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
                  Add at least one:{" "}
                  {workflow.form.fields
                    .filter((field) => workflow.form.atLeastOneOf!.includes(field.id))
                    .map((field) => field.label)
                    .join(" or ")}
                  .
                </p>
              )}
              <fieldset disabled={busy} className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 disabled:opacity-60">
                {workflow.form.fields.map((field) =>
                  field.type === "file" ? (
                    <FileSlot
                      key={field.id}
                      id={`${id}-${field.id}`}
                      label={field.label}
                      accept={field.accept}
                      required={field.required}
                      file={files[field.id]}
                      disabled={busy}
                      fullWidth={workflow.form.fields.filter((entry) => entry.type === "file").length === 1}
                      onChange={(file) => setFiles((current) => ({ ...current, [field.id]: file }))}
                    />
                  ) : field.type === "select" ? (
                    <SelectMenu
                      key={field.id}
                      label={`${field.label}${field.required ? "" : " (optional)"}`}
                      value={values[field.id] ?? ""}
                      onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                      options={[
                        ...(!field.required ? [{ value: "", label: "None" }] : []),
                        ...field.options.map((value) => ({ value, label: value })),
                      ]}
                      disabled={busy}
                      placeholder="Choose…"
                    />
                  ) : (
                    <div key={field.id} className="sm:col-span-2">
                      <label htmlFor={`${id}-${field.id}`} className={cn(fieldLabelClass, "mb-1.5 block")}>
                        {field.label}
                        {!field.required && " (optional)"}
                      </label>
                      <textarea
                        id={`${id}-${field.id}`}
                        required={field.required}
                        maxLength={field.maxLength ?? 4000}
                        rows={field.rows ?? 2}
                        placeholder={field.placeholder}
                        value={values[field.id] ?? ""}
                        onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                        className={`${inputClass} resize-y`}
                      />
                    </div>
                  ),
                )}
              </fieldset>
              <details className="group mt-5 rounded-lg border border-neutral-200/70 px-3 py-2.5 text-sm dark:border-neutral-800">
                <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-neutral-500 dark:text-neutral-400 [&::-webkit-details-marker]:hidden">
                  Example output
                  <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {workflow.form.example}
                </p>
              </details>
            </div>
            {error && (
              <p role="alert" className="shrink-0 px-6 pb-4 text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-200 bg-neutral-50/50 px-6 py-4 dark:border-neutral-800 dark:bg-neutral-900/30">
              <p className="text-xs text-neutral-500">
                Starts a new conversation<span className="mt-0.5 block text-neutral-400">{contextLabel}</span>
              </p>
              <button
                type="submit"
                disabled={busy}
                className={cn(buttonClass, primaryButtonClass, "inline-flex items-center gap-2")}
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
                {busy ? "Starting…" : "Run workflow"}
              </button>
            </div>
          </form>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
