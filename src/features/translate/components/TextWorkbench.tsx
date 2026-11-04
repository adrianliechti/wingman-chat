import {
  AlertCircle,
  CornerDownLeft,
  GlobeIcon,
  Handshake,
  Loader2,
  Paperclip,
  PenLine,
  RotateCcw,
  ScanText,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslate } from "../hooks/useTranslate";
import { languageName, type SupportedFile } from "../lib/languages";
import { replaceContext, selectionOffsets } from "../lib/selection";
import { errorMessage } from "../lib/translationJobs";
import type { Translation } from "../types/translate";
import { type DriveConfig, getConfig } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { notify } from "@/shared/lib/notify";
import { CopyButton } from "@/shared/ui/CopyButton";
import { DriveIcon } from "@/shared/ui/DriveIcon";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { PlayButton } from "@/shared/ui/PlayButton";
import { SelectorMenu } from "@/shared/ui/SelectorMenu";
import { useTextSelection, type TextSelectionSnapshot } from "@/shared/ui/selection/useTextSelection";
import { type Alternatives, AlternativesPopover } from "./AlternativesPopover";
import { PANE_INSET_CLASS, PANE_LABEL_CLASS, PaneHeader } from "./PaneHeader";
import { LanguagePicker } from "./LanguagePicker";

interface TextWorkbenchProps {
  /** Opens the file picker. */
  onPickFiles: () => void;
  /** Opens a drive browser. */
  onPickDrive: (drive: DriveConfig) => void;
}

const FOOTER_CLASS = `flex h-11 shrink-0 items-center gap-1 pr-3 ${PANE_INSET_CLASS}`;
// Negative margin: the icon, not the hover background, sits on the pane's inset.
const ATTACH_BUTTON_CLASS =
  "-ml-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-black/5 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200";
const ICON_BUTTON_CLASS =
  "rounded p-1.5 text-neutral-500 transition-colors hover:bg-black/5 hover:text-neutral-800 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200";

function fileTypeHint(files: SupportedFile[]): string {
  const names = files.map((file) => file.ext.toLowerCase());
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

async function loadAlternatives(
  root: HTMLElement | null,
  text: string,
  snapshot: TextSelectionSnapshot,
): Promise<Alternatives> {
  const offsets = root ? selectionOffsets(root, text, snapshot.text) : null;
  if (!offsets) throw new Error("Select a passage of the translation first.");
  const config = getConfig();
  const result = await config.client.rewriteSelection(config.translator?.model ?? "", text, offsets.start, offsets.end);
  return {
    options: result.alternatives.map((alternative, index) => ({
      text: alternative,
      keyChange: result.keyChanges[index] ?? "",
    })),
    context: result.contextToReplace,
  };
}

/** Text translation: the source on one side, the translation and its refinements on the other. */
export function TextWorkbench({ onPickFiles, onPickDrive }: TextWorkbenchProps) {
  const config = getConfig();
  const {
    active,
    draft,
    languages,
    providers,
    files,
    acceptedFiles,
    setSourceText,
    setTargetLang,
    setProvider,
    translateNow,
    addFiles,
  } = useTranslate();
  const job = active?.kind === "text" ? active : null;
  const maxTextLength = config.translator?.maxTextLength;
  const overLimit = maxTextLength != null && draft.sourceText.length > maxTextLength;

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length === 0) return;
    event.preventDefault();
    void addFiles(pasted);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* Source */}
        <section aria-label="Source text" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <PaneHeader>
            <span className={PANE_LABEL_CLASS} title="The source language is detected automatically">
              <ScanText size={15} className="shrink-0 text-neutral-500 dark:text-neutral-400" />
              <span className="truncate">Detect language</span>
            </span>
          </PaneHeader>
          <textarea
            value={draft.sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            onPaste={onPaste}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                translateNow();
              }
            }}
            autoFocus
            spellCheck={false}
            placeholder="Type or paste text to translate…"
            aria-label="Text to translate"
            className="min-h-0 flex-1 resize-none bg-transparent px-5 pt-2 pb-2 text-base leading-relaxed text-neutral-800 outline-none placeholder:text-neutral-400 md:px-8 md:pt-4 dark:text-neutral-200 dark:placeholder:text-neutral-500"
          />
          <div className={FOOTER_CLASS}>
            {/* With drives configured the button offers them; otherwise it opens the file picker itself. */}
            {acceptedFiles.length > 0 &&
              (config.drives.length > 0 ? (
                <DropdownMenu
                  anchor="top start"
                  trigger={
                    <MenuButton className={ATTACH_BUTTON_CLASS}>
                      <Paperclip size={14} />
                      Translate a document
                    </MenuButton>
                  }
                >
                  <DropdownMenuItem
                    icon={<Upload size={15} />}
                    description={fileTypeHint(files.length ? files : acceptedFiles)}
                    onClick={onPickFiles}
                  >
                    Upload
                  </DropdownMenuItem>
                  {config.drives.map((drive) => (
                    <DropdownMenuItem
                      key={drive.id}
                      icon={<DriveIcon drive={drive} size={15} />}
                      onClick={() => onPickDrive(drive)}
                    >
                      {drive.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenu>
              ) : (
                <button
                  type="button"
                  onClick={onPickFiles}
                  className={ATTACH_BUTTON_CLASS}
                  title={`Translate a ${fileTypeHint(files.length ? files : acceptedFiles)} file`}
                >
                  <Paperclip size={14} />
                  Translate a document
                </button>
              ))}
            <div className="ml-auto flex items-center gap-1">
              {draft.sourceText && (
                <>
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      overLimit ? "text-red-600 dark:text-red-400" : "text-neutral-400 dark:text-neutral-500",
                    )}
                    title={maxTextLength != null ? `Up to ${maxTextLength.toLocaleString()} characters` : undefined}
                  >
                    {draft.sourceText.length.toLocaleString()}
                    {maxTextLength != null && ` / ${maxTextLength.toLocaleString()}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSourceText("")}
                    className={ICON_BUTTON_CLASS}
                    title="Clear text"
                    aria-label="Clear text"
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
          </div>
        </section>

        <div aria-hidden="true" className="h-px shrink-0 bg-black/10 md:h-auto md:w-px dark:bg-white/10" />

        {/* Translation */}
        <TranslationResult
          job={job}
          hint={fileTypeHint(acceptedFiles)}
          header={
            <LanguagePicker
              value={draft.targetLang}
              languages={languages}
              onChange={setTargetLang}
              providers={providers}
              provider={draft.provider}
              onProviderChange={setProvider}
            />
          }
        />
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-3 px-5 pt-3 md:px-8 md:pt-5" aria-hidden="true">
      {[92, 100, 76, 88, 58].map((width, index) => (
        <div
          key={index}
          className="h-3.5 rounded bg-neutral-200/80 dark:bg-neutral-800"
          style={{ width: `${width}%` }}
        />
      ))}
    </div>
  );
}

function TranslationResult({
  job,
  hint,
  header,
}: {
  job: Translation | null;
  hint: string;
  /** The target language picker, at the left edge of the pane. */
  header: React.ReactNode;
}) {
  const config = getConfig();
  const { formalityOptions, styleOptions, setFormality, setStyle, retry, refine, revertRefinement, replaceResult } =
    useTranslate();
  const text = job?.resultText ?? "";
  const running = job?.status === "running";
  const [preview, setPreview] = useState<{ id: string; text: string } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [refining, setRefining] = useState<string | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const { selection, clear: clearSelection } = useTextSelection(root, { enabled: !!text && !running && !refining });

  // Another job or a new result retires any preview.
  useEffect(() => {
    setPreview(null);
  }, [job?.id, text]);

  const shown = preview && preview.id === job?.id ? preview.text : text;
  const refined = !!job && job.translatedText !== undefined && job.resultText !== job.translatedText;

  const runRefine = useCallback(
    (what: string) => {
      if (!job) return;
      setRefining(job.id);
      refine(job.id, what)
        .catch((error: unknown) => notify.error("Couldn't refine the translation", error))
        .finally(() => setRefining(null));
    },
    [job, refine],
  );

  const submitInstruction = (event: React.FormEvent) => {
    event.preventDefault();
    const what = instruction.trim();
    if (!what || refining) return;
    setInstruction("");
    runRefine(what);
  };

  const idle = !job || (!text && !running && job.status !== "error");

  return (
    <section aria-label="Translation" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <PaneHeader>{header}</PaneHeader>
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {idle ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="flex max-w-xs flex-col items-center gap-3 text-center select-none">
              <div className="flex size-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                <GlobeIcon size={22} className="text-neutral-400 dark:text-neutral-500" />
              </div>
              <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">The translation appears here</p>
              {hint && (
                <p className="text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
                  Drop a {hint} file anywhere to translate the whole document.
                </p>
              )}
            </div>
          </div>
        ) : job?.status === "error" && !text ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center gap-3 text-center">
              <AlertCircle size={22} className="text-red-500" />
              <p className="text-sm text-red-700 dark:text-red-300">{job.error ?? "Translation failed."}</p>
              <button
                type="button"
                onClick={() => retry(job.id)}
                className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
              >
                Try again
              </button>
            </div>
          </div>
        ) : running && !text ? (
          <Skeleton />
        ) : (
          <div
            ref={setRoot}
            className={cn(
              "px-5 pt-2 pb-4 text-base leading-relaxed whitespace-pre-wrap text-neutral-800 transition-opacity select-text md:px-8 md:pt-4 dark:text-neutral-200",
              (running || refining) && "opacity-50",
            )}
          >
            {shown}
          </div>
        )}
        {(running || refining) && text && (
          <div className="pointer-events-none absolute top-3 right-3">
            <Loader2 size={16} className="animate-spin text-neutral-400" aria-label="Translating" />
          </div>
        )}
      </div>

      {job && job.status === "error" && text && (
        <div className="mx-5 mb-2 flex items-center gap-2 rounded-lg border border-red-200/80 md:mx-8 bg-red-50/80 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle size={13} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={job.error}>
            {job.error ?? "Translation failed."}
          </span>
          <button
            type="button"
            onClick={() => retry(job.id)}
            className="font-medium underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {job && text && (
        <form onSubmit={submitInstruction} className={`flex shrink-0 items-center gap-2 pr-3 pb-1 ${PANE_INSET_CLASS}`}>
          <Sparkles size={14} className="shrink-0 text-violet-500" aria-hidden="true" />
          <input
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            disabled={!!refining || running}
            placeholder="Refine the translation, e.g. more formal, shorter, use “Sie”…"
            aria-label="Refine the translation"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-50 dark:text-neutral-200 dark:placeholder:text-neutral-500"
          />
          <button
            type="submit"
            disabled={!instruction.trim() || !!refining || running}
            className={ICON_BUTTON_CLASS}
            title="Apply"
            aria-label="Apply refinement"
          >
            {refining ? <Loader2 size={14} className="animate-spin" /> : <CornerDownLeft size={14} />}
          </button>
        </form>
      )}

      {job && (text || running) && (
        <div className={FOOTER_CLASS}>
          <span className="-ml-1">
            <SelectorMenu
              icon={<Handshake size={14} />}
              label={
                (job.formality && formalityOptions.find((option) => option.value === job.formality)?.label) ||
                "Formality"
              }
              options={formalityOptions}
              onSelect={setFormality}
              anchor="top start"
            />
          </span>
          <SelectorMenu
            icon={<PenLine size={14} />}
            label={(job.style && styleOptions.find((option) => option.value === job.style)?.label) || "Style"}
            options={styleOptions}
            onSelect={setStyle}
            anchor="top start"
          />
          <div className="ml-auto flex items-center gap-1 pr-1">
            {refined && (
              <button
                type="button"
                onClick={() => revertRefinement(job.id)}
                disabled={running || !!refining}
                className={ICON_BUTTON_CLASS}
                title="Back to the translation without refinements"
                aria-label="Back to the translation"
              >
                <RotateCcw size={14} />
              </button>
            )}
            {text && config.tts && <PlayButton text={text} className="h-4 w-4" />}
            {text && <CopyButton text={text} className="h-4 w-4" />}
          </div>
        </div>
      )}

      {job && (
        <AlternativesPopover
          selection={selection}
          onDismiss={clearSelection}
          onLoadAlternatives={(snapshot) => loadAlternatives(root, text, snapshot)}
          onPreview={(alternative, context) =>
            setPreview(alternative === null ? null : { id: job.id, text: replaceContext(text, context, alternative) })
          }
          onApply={(alternative, context) => {
            setPreview(null);
            replaceResult(job.id, replaceContext(text, context, alternative));
            clearSelection();
          }}
          onInstruction={(what, snapshot) => {
            clearSelection();
            runRefine(`Change only this passage: “${snapshot.text}”. ${what}. Leave everything else exactly as it is.`);
          }}
        />
      )}
    </section>
  );
}

export { languageName, errorMessage };
