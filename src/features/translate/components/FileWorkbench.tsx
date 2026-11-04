import { AlertCircle, Download, Loader2, Square } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslate } from "../hooks/useTranslate";
import { languageName, type TranslatorProvider } from "../lib/languages";
import { readTranslationFile } from "../lib/translationStorage";
import type { StoredFile, Translation } from "../types/translate";
import { artifactKind } from "@/features/artifacts/lib/artifacts";
import { useBreakpoint } from "@/shared/hooks/useMediaQuery";
import { cn } from "@/shared/lib/cn";
import { fileMatchesTypeList } from "@/shared/lib/fileTypes";
import { notify } from "@/shared/lib/notify";
import { downloadBlob, downloadMarkdownAsDocx, formatBytes, readAsDataURL } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/CopyButton";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { FileIcon } from "@/shared/ui/FileIcon";
import { FilePreview, type FilePreviewProps } from "@/shared/ui/editors/FilePreview";
import { LanguagePicker } from "./LanguagePicker";
import { PANE_LABEL_CLASS, PaneHeader } from "./PaneHeader";

type View = "original" | "translation" | "both";

type Loaded =
  | { status: "loading" }
  | { status: "ready"; file: FilePreviewProps }
  | { status: "missing" }
  | { status: "error"; message: string };

const TEXT_KINDS = new Set(["text", "code", "markdown", "html", "svg", "mermaid", "data"]);

const ICON_BUTTON_CLASS =
  "rounded p-1.5 text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-800 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200";

/** Turn stored bytes into what the viewers take: text for text files, a data URL otherwise. */
async function toPreview(file: File): Promise<FilePreviewProps> {
  const kind = artifactKind(file.name, file.type);
  const content = TEXT_KINDS.has(kind) ? await file.text() : await readAsDataURL(file);
  return { path: file.name, content, contentType: file.type || undefined };
}

/** Loads a job's stored document for display; reloads when the descriptor changes. */
function useStoredPreview(id: string, which: "source" | "result", info: StoredFile | undefined): Loaded {
  const name = info?.name;
  const contentType = info?.contentType;
  const size = info?.size;
  const key = name !== undefined ? `${name}\0${contentType ?? ""}\0${size ?? ""}` : null;
  const [state, setState] = useState<{ key: string | null; loaded: Loaded }>({
    key: null,
    loaded: { status: "loading" },
  });
  useEffect(() => {
    if (!key || name === undefined) return;
    let cancelled = false;
    const descriptor = { name, contentType: contentType ?? "", size: size ?? 0 };
    void readTranslationFile(id, which, descriptor)
      .then(async (file) =>
        file ? ({ status: "ready", file: await toPreview(file) } as const) : ({ status: "missing" } as const),
      )
      .catch((error: unknown) => ({
        status: "error" as const,
        message: error instanceof Error ? error.message : "The document couldn't be read.",
      }))
      .then((loaded) => {
        if (!cancelled) setState({ key, loaded });
      });
    return () => {
      cancelled = true;
    };
  }, [id, which, key, name, contentType, size]);
  if (!key) return { status: "missing" };
  return state.key === key ? state.loaded : { status: "loading" };
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">{children}</div>
    </div>
  );
}

function StoredPreview({ loaded }: { loaded: Loaded }) {
  switch (loaded.status) {
    case "loading":
      return (
        <Centered>
          <Loader2 size={20} className="animate-spin text-neutral-400" />
        </Centered>
      );
    case "missing":
      return (
        <Centered>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">This document is no longer stored.</p>
        </Centered>
      );
    case "error":
      return (
        <Centered>
          <AlertCircle size={20} className="text-red-500" />
          <p className="text-sm text-red-700 dark:text-red-300">{loaded.message}</p>
        </Centered>
      );
    default:
      return <FilePreview {...loaded.file} />;
  }
}

function Pane({
  leading,
  actions,
  children,
}: {
  /** What the pane holds, at its left edge: the document or the language picker. */
  leading: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHeader actions={actions}>{leading}</PaneHeader>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

async function downloadResult(job: Translation): Promise<void> {
  if (!job.resultFile) return;
  if (job.resultText != null) {
    await downloadBlob(new Blob([job.resultText], { type: job.resultFile.contentType }), job.resultFile.name);
    return;
  }
  const file = await readTranslationFile(job.id, "result", job.resultFile);
  if (!file) throw new Error("The translated document is no longer stored.");
  await downloadBlob(file, job.resultFile.name);
}

/** A document and its translation side by side; the header retargets or downloads it. */
export function FileWorkbench({ job }: { job: Translation }) {
  const { languages, providers, setTargetLang, setProvider, retry, cancel } = useTranslate();
  const wide = useBreakpoint("md");
  const [view, setView] = useState<View>("both");
  const effectiveView: View = wide ? view : view === "both" ? "translation" : view;
  const showOriginal = effectiveView !== "translation";
  const showTranslation = effectiveView !== "original";

  const source = useStoredPreview(job.id, "source", job.sourceFile);
  const resultIsText = job.resultText != null;
  const result = useStoredPreview(job.id, "result", resultIsText ? undefined : job.resultFile);

  const name = job.sourceFile?.name ?? "Document";
  const target = languageName(job.targetLang);
  const providerDisabledReason = (provider: TranslatorProvider) =>
    job.sourceFile && !fileMatchesTypeList(job.sourceFile.name, job.sourceFile.contentType, provider.files)
      ? `${provider.name} can't translate this file type`
      : null;

  const download = () => {
    downloadResult(job).catch((error: unknown) => notify.error("Couldn't download the translation", error));
  };
  const downloadAsWord = () => {
    if (!job.resultText || !job.resultFile) return;
    downloadMarkdownAsDocx(job.resultText, job.resultFile.name.replace(/\.(md|markdown|txt)$/i, "") + ".docx").catch(
      (error: unknown) => notify.error("Couldn't convert to Word", error),
    );
  };

  const views: { value: View; label: string }[] = [
    { value: "original", label: "Original" },
    { value: "translation", label: "Translation" },
    ...(wide ? [{ value: "both" as const, label: "Side by side" }] : []),
  ];

  // View and download controls sit at the right end of the pane header row,
  // so the language bar stays balanced around its arrow.
  const controls = (
    <>
      <div
        role="radiogroup"
        aria-label="View"
        className="mr-1 flex shrink-0 items-center gap-0.5 rounded-full bg-neutral-200/50 p-0.5 ring-1 ring-black/5 dark:bg-neutral-800/50 dark:ring-white/5"
      >
        {views.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={effectiveView === option.value}
            onClick={() => setView(option.value)}
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors",
              effectiveView === option.value
                ? "bg-white text-neutral-900 shadow-sm ring-1 ring-black/5 dark:bg-neutral-950 dark:text-neutral-50 dark:ring-white/10"
                : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {resultIsText && job.resultText && <CopyButton text={job.resultText} className="h-3.5 w-3.5" />}
      {job.status === "done" &&
        job.resultFile &&
        (resultIsText && job.resultFile.name.match(/\.(md|markdown|txt)$/i) ? (
          <DropdownMenu
            anchor="bottom end"
            trigger={
              <MenuButton className={ICON_BUTTON_CLASS} title="Download" aria-label="Download">
                <Download size={14} />
              </MenuButton>
            }
          >
            <DropdownMenuItem icon={<Download size={14} />} onClick={download}>
              Download {job.resultFile.name}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<img src="/icons/file-word.svg" alt="" width={14} height={14} className="dark:invert" />}
              onClick={downloadAsWord}
            >
              Download as Word
            </DropdownMenuItem>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            onClick={download}
            className={ICON_BUTTON_CLASS}
            title={`Download ${job.resultFile.name}`}
            aria-label="Download translation"
          >
            <Download size={14} />
          </button>
        ))}
    </>
  );

  const documentLabel = (
    <span className={PANE_LABEL_CLASS}>
      {job.sourceFile && <FileIcon name={job.sourceFile.name} contentType={job.sourceFile.contentType} size={15} />}
      <span className="truncate font-medium" title={name}>
        {name}
      </span>
      {wide && job.sourceFile && (
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
          {formatBytes(job.sourceFile.size)}
        </span>
      )}
    </span>
  );
  const picker = (
    <LanguagePicker
      value={job.targetLang}
      languages={languages}
      onChange={setTargetLang}
      providers={providers}
      provider={job.provider}
      onProviderChange={setProvider}
      providerDisabledReason={providerDisabledReason}
      disabled={job.status === "running"}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {showOriginal && (
          <Pane leading={documentLabel} actions={showTranslation ? undefined : controls}>
            <StoredPreview loaded={source} />
          </Pane>
        )}
        {showOriginal && showTranslation && (
          <div aria-hidden="true" className="h-px shrink-0 bg-black/10 md:h-auto md:w-px dark:bg-white/10" />
        )}
        {showTranslation && (
          <Pane leading={picker} actions={controls}>
            {job.status === "running" ? (
              <Centered>
                <Loader2 size={22} className="animate-spin text-neutral-400" />
                <p className="text-sm text-neutral-500 dark:text-neutral-400">Translating to {target}…</p>
                <button
                  type="button"
                  onClick={() => cancel(job.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 dark:border-neutral-600 dark:text-neutral-200"
                >
                  <Square size={12} />
                  Cancel
                </button>
              </Centered>
            ) : job.status === "error" ? (
              <Centered>
                <AlertCircle size={22} className="text-red-500" />
                <p className="text-sm text-red-700 dark:text-red-300">{job.error ?? "Translation failed."}</p>
                <button
                  type="button"
                  onClick={() => retry(job.id)}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
                >
                  Try again
                </button>
              </Centered>
            ) : job.status === "idle" ? (
              <Centered>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  {job.resultFile || job.resultText ? "Translation stopped." : "Waiting to translate…"}
                </p>
                <button
                  type="button"
                  onClick={() => retry(job.id)}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
                >
                  Translate to {target}
                </button>
              </Centered>
            ) : resultIsText && job.resultFile ? (
              <FilePreview
                path={job.resultFile.name}
                content={job.resultText ?? ""}
                contentType={job.resultFile.contentType}
              />
            ) : (
              <StoredPreview loaded={result} />
            )}
          </Pane>
        )}
      </div>
    </div>
  );
}
