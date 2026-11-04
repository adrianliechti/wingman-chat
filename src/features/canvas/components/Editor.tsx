import { Download, Eye, Palette, PanelRight, PlusIcon, Redo2, RotateCcw, Sparkles, Sun, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "../hooks/useEditor";
import { useRenderer } from "../hooks/useRenderer";
import { EXPORT_FORMATS, exportFilename, type ExportFormat, renderExport } from "../lib/exportImage";
import { type Adjustments, isDefaultRecipe, resetDevelop } from "../lib/recipe";
import type { Image } from "../types/canvas";
import { cn } from "@/shared/lib/cn";
import { notify } from "@/shared/lib/notify";
import { decodeDataURL, downloadBlob } from "@/shared/lib/utils";
import { DropdownMenu, DropdownMenuItem, MenuButton } from "@/shared/ui/DropdownMenu";
import { useNavigation } from "@/shell/hooks/useNavigation";
import { Inspector, InspectorAction, type InspectorTab, type InspectorTabMeta } from "./Inspector";
import { ColorPanel } from "./panels/ColorPanel";
import { EffectsPanel } from "./panels/EffectsPanel";
import { LightPanel } from "./panels/LightPanel";
import { Stage } from "./Stage";

const TABS: InspectorTabMeta[] = [
  { id: "light", label: "Light", icon: <Sun size={16} /> },
  { id: "color", label: "Color", icon: <Palette size={16} /> },
  { id: "effects", label: "Effects", icon: <Sparkles size={16} /> },
];

export const NAV_BUTTON_CLASS =
  "p-2 text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 rounded transition-all duration-150 ease-out disabled:opacity-30 disabled:pointer-events-none";

interface EditorProps {
  image: Image;
  updateImage: (id: string, updater: (image: Image) => Image) => void;
  /** Phone layout: inspector as a bottom sheet, fewer nav actions. */
  compact: boolean;
  onNew: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

async function exportImage(image: Image, recipe: Adjustments, format: ExportFormat): Promise<void> {
  const blob = await renderExport(decodeDataURL(image.data), recipe, format);
  await downloadBlob(blob, exportFilename(image.title || image.prompt, format));
}

/**
 * Stage plus inspector for one image, owning its recipe state, the top-bar
 * actions and the editing shortcuts. Mount it keyed by image id.
 */
export function Editor({ image, updateImage, compact, onNew }: EditorProps) {
  const { setRightActions } = useNavigation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRenderer(canvasRef, image.data);
  const editor = useEditor(image, updateImage);
  const [tab, setTab] = useState<InspectorTab>("light");
  const [panelOpen, setPanelOpen] = useState(!compact);
  const [compare, setCompare] = useState(false);
  const [holdOriginal, setHoldOriginal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const showOriginal = compare || holdOriginal;
  const editable = renderer.status === "ready";

  useEffect(() => {
    renderer.draw(editor.recipe, { original: showOriginal });
  }, [renderer, editor.recipe, showOriginal]);

  const exportAs = useCallback(
    (format: ExportFormat) => {
      setExporting(true);
      exportImage(image, editor.recipe, format)
        .catch((error: unknown) => notify.error("Export failed", error))
        .finally(() => setExporting(false));
    },
    [image, editor.recipe],
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
            <MenuButton className={NAV_BUTTON_CLASS} disabled={exporting} title="Export" aria-label="Export">
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
  }, [setRightActions, onNew, compare, editable, exporting, exportAs, panelOpen]);

  // Shortcuts: ⌘Z / ⇧⌘Z for the recipe, hold "\" to peek at the original.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.redo();
        else editor.undo();
      } else if (event.key === "\\" && !event.repeat) {
        event.preventDefault();
        setHoldOriginal(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "\\") setHoldOriginal(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => setHoldOriginal(false));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [editor]);

  const actions = (
    <>
      <InspectorAction label="Undo" onClick={editor.undo} disabled={!editor.canUndo}>
        <Undo2 size={14} />
      </InspectorAction>
      <InspectorAction label="Redo" onClick={editor.redo} disabled={!editor.canRedo}>
        <Redo2 size={14} />
      </InspectorAction>
      <InspectorAction
        label="Reset adjustments"
        onClick={() => editor.apply(resetDevelop(editor.recipe))}
        disabled={isDefaultRecipe(resetDevelop(editor.recipe))}
      >
        <RotateCcw size={14} />
      </InspectorAction>
    </>
  );

  return (
    <div className={cn("flex min-h-0 flex-1", compact ? "flex-col" : "flex-row")}>
      <Stage
        canvasRef={canvasRef}
        renderer={renderer}
        recipe={editor.recipe}
        fallbackSrc={image.data}
        alt={image.title || image.prompt || "Image"}
        badge={showOriginal ? "Original" : undefined}
        className="p-4"
      />
      {panelOpen && (
        <Inspector tabs={TABS} tab={tab} onTab={setTab} compact={compact} actions={actions}>
          {tab === "light" && <LightPanel editor={editor} disabled={!editable} />}
          {tab === "color" && <ColorPanel editor={editor} disabled={!editable} />}
          {tab === "effects" && <EffectsPanel editor={editor} disabled={!editable} />}
        </Inspector>
      )}
    </div>
  );
}
