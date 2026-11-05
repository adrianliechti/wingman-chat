import {
  Crop,
  Download,
  Eye,
  History,
  Palette,
  PanelRight,
  PlusIcon,
  Redo2,
  RotateCcw,
  Sparkles,
  Sun,
  Undo2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "../hooks/useEditor";
import { newVersion } from "../hooks/useImages";
import { useRenderer } from "../hooks/useRenderer";
import { EXPORT_FORMATS, exportFilename, type ExportFormat, renderExport } from "../lib/exportImage";
import { cropBounds, GEOMETRY, isDefaultGeometry, NO_CROP, outputSize, sourceMatrix } from "../lib/geometry";
import { imageDimensions } from "../lib/images";
import { loadVersionBlob } from "../lib/imageStorage";
import { clearSelection, createSelection, hasSelectedPixels, invertSelection, type Selection } from "../lib/mask";
import { type Adjustments, isDefaultRecipe, recipeEquals, resetDevelop } from "../lib/recipe";
import { type RetouchKind, type RetouchRequest, runRetouch } from "../lib/retouch";
import { appendVersion, restoreImageVersion, versionRecipe } from "../lib/versions";
import type { Image } from "../types/canvas";
import { cn } from "@/shared/lib/cn";
import { confirm } from "@/shared/lib/confirm";
import { flushPersistence } from "@/shared/lib/persistence";
import { notify } from "@/shared/lib/notify";
import { decodeDataURL, downloadBlob, readAsDataURL } from "@/shared/lib/utils";
import type { Model } from "@/shared/types/chat";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { Inspector, InspectorAction, type InspectorTab, type InspectorTabMeta } from "./Inspector";
import { CropOverlay } from "./overlays/CropOverlay";
import { MaskOverlay } from "./overlays/MaskOverlay";
import { ColorPanel } from "./panels/ColorPanel";
import { type AspectPreset, CropPanel } from "./panels/CropPanel";
import { EffectsPanel } from "./panels/EffectsPanel";
import { LightPanel } from "./panels/LightPanel";
import { DEFAULT_SELECTION_SETTINGS, RetouchPanel, type SelectionSettings } from "./panels/RetouchPanel";
import { VersionsPanel } from "./panels/VersionsPanel";
import { Stage } from "./Stage";

const TABS: InspectorTabMeta[] = [
  { id: "light", label: "Light", icon: <Sun size={16} /> },
  { id: "color", label: "Color", icon: <Palette size={16} /> },
  { id: "effects", label: "Effects", icon: <Sparkles size={16} /> },
  { id: "crop", label: "Crop", icon: <Crop size={16} /> },
  { id: "retouch", label: "Retouch", icon: <Wand2 size={16} /> },
  { id: "versions", label: "Versions", icon: <History size={16} /> },
];

export const NAV_BUTTON_CLASS =
  "p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out disabled:opacity-30 disabled:pointer-events-none";

interface EditorProps {
  image: Image;
  updateImage: (id: string, updater: (image: Image) => Image) => void;
  /** Renderer used for AI retouching. */
  model: Model | null;
  /** Phone layout: inspector as a bottom sheet, fewer nav actions. */
  compact: boolean;
  onNew: () => void;
}

interface Pixels {
  data: string;
  width: number;
  height: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

async function exportImage(image: Image, recipe: Adjustments, format: ExportFormat): Promise<void> {
  const blob = await renderExport(decodeDataURL(image.data), recipe, format);
  await downloadBlob(blob, exportFilename(image.title || image.prompt, format));
}

async function toPixels(blob: Blob): Promise<Pixels> {
  const [data, size] = await Promise.all([readAsDataURL(blob), imageDimensions(blob)]);
  return { data, ...size };
}

async function performRetouch(
  model: Model,
  image: Image,
  request: RetouchRequest,
  selection: Selection | null,
): Promise<Pixels & { label: string }> {
  const result = await runRetouch(model, image, request, selection);
  return { ...(await toPixels(result.blob)), label: result.label };
}

async function performFlatten(image: Image, recipe: Adjustments): Promise<Pixels> {
  return toPixels(await renderExport(decodeDataURL(image.data), recipe, "png"));
}

async function loadVersion(image: Image, versionId: string): Promise<Pixels> {
  const blob = await loadVersionBlob(image, versionId);
  if (!blob) throw new Error("This version's pixels are no longer stored");
  return toPixels(blob);
}

/**
 * Stage plus inspector for one image, owning its recipe state, the top-bar
 * actions and the editing shortcuts. Mount it keyed by image id.
 */
export function Editor({ image, updateImage, model, compact, onNew }: EditorProps) {
  const { setRightActions } = useNavigation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [versionPreview, setVersionPreview] = useState<{ id: string; pixels: Pixels; recipe: Adjustments } | null>(
    null,
  );
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const previewRequest = useRef(0);
  const renderer = useRenderer(canvasRef, versionPreview?.pixels.data ?? image.data);
  const editor = useEditor(image, updateImage);
  const [tab, setTab] = useState<InspectorTab>("light");
  const [panelOpen, setPanelOpen] = useState(!compact);
  const [compare, setCompare] = useState(false);
  const [holdOriginal, setHoldOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aspect, setAspect] = useState<{ preset: AspectPreset; swapped: boolean }>({ preset: "free", swapped: false });
  const [settings, setSettings] = useState<SelectionSettings>(DEFAULT_SELECTION_SETTINGS);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [running, setRunning] = useState<RetouchKind | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [decoded, setDecoded] = useState<{ data: string; width: number; height: number } | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const showOriginal = compare || holdOriginal;
  const working = running !== null || busy;
  const editable = renderer.status === "ready" && !working && !versionPreview && !previewLoading;
  const cropping = tab === "crop" && panelOpen;
  const retouching = tab === "retouch" && panelOpen;

  const clearPreview = useCallback(() => {
    previewRequest.current++;
    setVersionPreview(null);
    setPreviewLoading(null);
  }, []);

  const previewVersion = useCallback(
    async (versionId: string | null) => {
      if (!versionId) {
        clearPreview();
        return;
      }
      const version = image.versions.find((item) => item.id === versionId);
      if (!version) return;
      const request = ++previewRequest.current;
      setPreviewLoading(versionId);
      try {
        await flushPersistence();
        const pixels = await loadVersion(image, versionId);
        if (request === previewRequest.current)
          setVersionPreview({ id: versionId, pixels, recipe: versionRecipe(version) });
      } catch (error) {
        if (request === previewRequest.current) notify.error("Couldn't preview the version", error);
      }
      if (request === previewRequest.current) setPreviewLoading(null);
    },
    [image, clearPreview],
  );

  useEffect(() => {
    clearPreview();
    return () => {
      previewRequest.current++;
    };
  }, [image.data, image.versions, clearPreview]);

  useEffect(() => {
    if (tab !== "versions" || !panelOpen) clearPreview();
  }, [tab, panelOpen, clearPreview]);

  // Full-resolution pixel size: stored with newer images, decoded for older ones.
  const known = image.width && image.height ? { width: image.width, height: image.height } : null;
  useEffect(() => {
    if (known || decoded?.data === image.data) return;
    let cancelled = false;
    void imageDimensions(decodeDataURL(image.data)).then((size) => {
      if (!cancelled) setDecoded({ data: image.data, ...size });
    });
    return () => {
      cancelled = true;
    };
  }, [known, decoded, image.data]);
  const full: [number, number] | null = known
    ? [known.width, known.height]
    : decoded?.data === image.data
      ? [decoded.width, decoded.height]
      : null;

  // The selection lives in source pixels; a new version (possibly another
  // size) starts with an empty one.
  useEffect(() => {
    if (!full) return;
    setSelection(createSelection(full[0], full[1]));
    setHasSelection(false);
    setSelectionRevision((value) => value + 1);
    return () => {
      setSelection(null);
    };
  }, [full?.[0], full?.[1], image.data]);

  // Crop mode shows the whole (turned, straightened) picture with the frame on top.
  const displayed = useMemo<Adjustments>(
    () =>
      versionPreview?.recipe ??
      (cropping ? { ...editor.recipe, geometry: { ...editor.recipe.geometry, crop: NO_CROP } } : editor.recipe),
    [versionPreview, cropping, editor.recipe],
  );
  const source: [number, number] = full ?? [renderer.size.width || 3, renderer.size.height || 2];
  const crop = cropBounds(editor.recipe.geometry.crop);

  useEffect(() => {
    renderer.draw(displayed, { original: !versionPreview && showOriginal });
  }, [renderer, displayed, showOriginal, versionPreview]);

  const exportAs = useCallback(
    (format: ExportFormat) => {
      setExporting(true);
      exportImage(
        versionPreview ? { ...image, ...versionPreview.pixels } : image,
        versionPreview?.recipe ?? editor.recipe,
        format,
      )
        .catch((error: unknown) => notify.error("Export failed", error))
        .finally(() => setExporting(false));
    },
    [image, editor.recipe, versionPreview],
  );

  const openTab = useCallback((next: InspectorTab) => {
    setTab(next);
    setPanelOpen(true);
  }, []);

  const resetSelection = useCallback(() => {
    if (selection) clearSelection(selection);
    setHasSelection(false);
    setSelectionRevision((value) => value + 1);
  }, [selection]);

  const invert = useCallback(() => {
    if (!selection) return;
    invertSelection(selection);
    setHasSelection(hasSelectedPixels(selection));
    setSelectionRevision((value) => value + 1);
  }, [selection]);

  /** Persist the previous pixels before another queued version can supersede them. */
  const addVersion = useCallback(
    async (source: Image, pixels: Pixels, version: Image["versions"][number]) => {
      await flushPersistence();
      updateImage(source.id, (current) => appendVersion(current, source, pixels, version));
    },
    [updateImage],
  );

  const retouch = useCallback(
    (request: RetouchRequest) => {
      if (operation.current) return;
      if (!model) {
        notify.error("No image model is available for retouching");
        return;
      }
      operation.current = true;
      setRunning(request.kind);
      performRetouch(model, image, request, hasSelection ? selection : null)
        .then(async (result) => {
          await addVersion(image, result, newVersion("edit", result.label, model.id));
          resetSelection();
        })
        .catch((error: unknown) => notify.error("Retouch failed", error))
        .finally(() => {
          operation.current = false;
          setRunning(null);
        });
    },
    [model, image, selection, hasSelection, addVersion, resetSelection],
  );

  const flatten = useCallback(() => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    const source = { ...image, recipe: editor.recipe };
    performFlatten(source, source.recipe)
      .then((pixels) => addVersion(source, pixels, newVersion("flatten")))
      .catch((error: unknown) => notify.error("Flatten failed", error))
      .finally(() => {
        operation.current = false;
        setBusy(false);
      });
  }, [image, editor, addVersion]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      const index = image.versions.findIndex((version) => version.id === versionId);
      if (index < 0) return;
      const newer = image.versions.length - index - 1;
      const confirmed = await confirm({
        title: "Restore this version?",
        message:
          newer > 0
            ? `${newer === 1 ? "The newer version" : `The ${newer} newer versions`} will be removed and the saved adjustments restored.`
            : "Your current adjustments will be replaced with this version's saved settings.",
        confirmLabel: "Restore",
        danger: true,
      });
      if (!confirmed || operation.current) return;
      operation.current = true;
      setBusy(true);
      flushPersistence()
        .then(() => loadVersion(image, versionId))
        .then((pixels) => updateImage(image.id, (current) => restoreImageVersion(current, image, versionId, pixels)))
        .catch((error: unknown) => notify.error("Couldn't restore the version", error))
        .finally(() => {
          operation.current = false;
          setBusy(false);
        });
    },
    [image, updateImage],
  );

  const deleteVersion = useCallback(
    (versionId: string) => {
      updateImage(image.id, (current) => ({
        ...current,
        versions: current.versions.filter((version) => version.id !== versionId),
      }));
    },
    [image.id, updateImage],
  );

  useEffect(() => {
    setRightActions(
      <>
        <button type="button" className={NAV_BUTTON_CLASS} onClick={onNew} title="New image" aria-label="New image">
          <PlusIcon size={20} />
        </button>
        <button
          type="button"
          className={cn(NAV_BUTTON_CLASS, compare && "text-blue-600 dark:text-blue-400")}
          onClick={() => setCompare((value) => !value)}
          disabled={!editable}
          aria-pressed={compare}
          title="Show original (hold \)"
          aria-label="Show original"
        >
          <Eye size={20} />
        </button>
        <DropdownMenu
          anchor="bottom end"
          trigger={
            <MenuButton
              className={NAV_BUTTON_CLASS}
              disabled={exporting || !!previewLoading}
              title="Export"
              aria-label="Export"
            >
              <Download size={20} className={exporting ? "animate-pulse" : undefined} />
            </MenuButton>
          }
        >
          {EXPORT_FORMATS.map((format) => (
            <DropdownMenuItem
              key={format.value}
              description={format.description}
              onClick={() => exportAs(format.value)}
            >
              {format.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
        <button
          type="button"
          className={cn(NAV_BUTTON_CLASS, panelOpen && "text-blue-600 dark:text-blue-400")}
          onClick={() => setPanelOpen((value) => !value)}
          aria-pressed={panelOpen}
          title="Adjustments"
          aria-label="Adjustments"
        >
          <PanelRight size={20} />
        </button>
      </>,
    );
    return () => setRightActions(null);
  }, [setRightActions, onNew, compare, editable, exporting, exportAs, panelOpen, previewLoading]);

  // Shortcuts: ⌘Z / ⇧⌘Z for the recipe, hold "\" to peek at the original,
  // C and R toggle crop and retouch, Escape returns to the sliders.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (working || versionPreview || previewLoading) return;
        if (event.shiftKey) editor.redo();
        else editor.undo();
      } else if (event.key === "\\" && !event.repeat) {
        event.preventDefault();
        setHoldOriginal(true);
      } else if (plain && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (cropping) setTab("light");
        else openTab("crop");
      } else if (plain && event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (retouching) setTab("light");
        else openTab("retouch");
      } else if (event.key === "Escape" && (cropping || retouching)) {
        setTab("light");
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "\\") setHoldOriginal(false);
    };
    const blur = () => setHoldOriginal(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [editor, cropping, retouching, openTab, working, versionPreview, previewLoading]);

  const actions = (
    <>
      <InspectorAction label="Undo" onClick={editor.undo} disabled={!editable || !editor.canUndo}>
        <Undo2 size={14} />
      </InspectorAction>
      <InspectorAction label="Redo" onClick={editor.redo} disabled={!editable || !editor.canRedo}>
        <Redo2 size={14} />
      </InspectorAction>
      {tab === "crop" ? (
        <InspectorAction
          label="Reset crop and rotation"
          onClick={() => {
            setAspect({ preset: "free", swapped: false });
            editor.apply((recipe) => ({ ...recipe, geometry: GEOMETRY }));
          }}
          disabled={!editable || isDefaultGeometry(editor.recipe.geometry)}
        >
          <RotateCcw size={14} />
        </InspectorAction>
      ) : (
        <InspectorAction
          label="Reset adjustments"
          onClick={() => editor.apply(resetDevelop(editor.recipe))}
          disabled={!editable || recipeEquals(editor.recipe, resetDevelop(editor.recipe))}
        >
          <RotateCcw size={14} />
        </InspectorAction>
      )}
    </>
  );

  const stageBadge = versionPreview
    ? "Version preview"
    : showOriginal
      ? "Original"
      : cropping
        ? "Crop"
        : retouching
          ? "Retouch"
          : undefined;

  return (
    <div className={cn("flex min-h-0 flex-1", compact ? "flex-col" : "flex-row")}>
      <Stage
        canvasRef={canvasRef}
        renderer={renderer}
        recipe={displayed}
        fallbackSrc={versionPreview?.pixels.data ?? image.data}
        alt={image.title || image.prompt || "Image"}
        badge={stageBadge}
        className="p-4"
      >
        {cropping && editable && (
          <CropOverlay
            crop={editor.recipe.geometry.crop}
            ratio={aspect.preset === "free" ? 0 : crop.width / crop.height}
            onChange={(crop) => editor.change((recipe) => ({ ...recipe, geometry: { ...recipe.geometry, crop } }))}
            onCommit={editor.commit}
          />
        )}
        {retouching && editable && full && selection && (
          <MaskOverlay
            selection={selection}
            revision={selectionRevision}
            tool={settings.tool}
            mode={settings.mode}
            size={settings.size}
            feather={settings.feather}
            matrix={sourceMatrix(editor.recipe.geometry, full[0], full[1])}
            output={outputSize(editor.recipe.geometry, full[0], full[1])}
            disabled={working}
            onStroke={() => {
              setHasSelection(hasSelectedPixels(selection));
              setSelectionRevision((value) => value + 1);
            }}
          />
        )}
        {(working || previewLoading) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
            <div className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
              {previewLoading ? "Loading preview…" : running ? "Retouching…" : "Working…"}
            </div>
          </div>
        )}
      </Stage>
      {panelOpen && (
        <Inspector tabs={TABS} tab={tab} onTab={setTab} compact={compact} actions={actions}>
          {tab === "light" && <LightPanel editor={editor} disabled={!editable} />}
          {tab === "color" && <ColorPanel editor={editor} disabled={!editable} />}
          {tab === "effects" && <EffectsPanel editor={editor} disabled={!editable} />}
          {tab === "crop" && (
            <CropPanel
              editor={editor}
              source={source}
              preset={aspect.preset}
              swapped={aspect.swapped}
              onPreset={(preset, swapped) => setAspect({ preset, swapped })}
              onDone={() => setTab("light")}
              disabled={!editable}
            />
          )}
          {tab === "retouch" && (
            <RetouchPanel
              settings={settings}
              onSettings={setSettings}
              hasSelection={hasSelection}
              onInvert={invert}
              onClear={resetSelection}
              running={running}
              modelName={model?.name ?? model?.id}
              transparent={!!model?.supportedBackgrounds?.includes("transparent")}
              onRun={retouch}
              onFlatten={flatten}
              flattenDisabled={isDefaultRecipe(editor.recipe)}
              disabled={!editable || !full || busy}
            />
          )}
          {tab === "versions" && (
            <VersionsPanel
              image={image}
              recipe={editor.recipe}
              previewId={versionPreview?.id ?? null}
              loadingId={previewLoading}
              onPreview={(versionId) => void previewVersion(versionId)}
              onRestore={(versionId) => void restoreVersion(versionId)}
              onDelete={deleteVersion}
              disabled={working}
            />
          )}
        </Inspector>
      )}
    </div>
  );
}
