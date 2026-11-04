import { useCallback, useEffect, useRef, useState } from "react";
import { type Adjustments, isDefaultRecipe, recipeEquals } from "../lib/recipe";
import type { Image } from "../types/canvas";

const PERSIST_DELAY_MS = 300;

export type RecipePatch = Partial<Adjustments> | ((recipe: Adjustments) => Adjustments);

export interface EditorHandle {
  recipe: Adjustments;
  /** Live update, e.g. while a slider is dragged. Does not create an undo step. */
  change: (patch: RecipePatch) => void;
  /** Close the open change as one undo step (slider released). */
  commit: () => void;
  /** Change and commit in one go, for toggles and resets. */
  apply: (patch: RecipePatch) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isDefault: boolean;
}

interface History {
  recipe: Adjustments;
  undo: Adjustments[];
  redo: Adjustments[];
}

function patched(recipe: Adjustments, patch: RecipePatch): Adjustments {
  return typeof patch === "function" ? patch(recipe) : { ...recipe, ...patch };
}

/**
 * Recipe state for one image: live edits, an undo/redo stack of committed
 * steps, and debounced persistence through `updateImage`. Mount it keyed by
 * image id so switching images starts from that image's stored recipe. State
 * updaters are pure so StrictMode's double invocation can't corrupt the stacks.
 */
export function useEditor(
  image: Image,
  updateImage: (id: string, updater: (image: Image) => Image) => void,
): EditorHandle {
  const [history, setHistory] = useState<History>({ recipe: image.recipe, undo: [], redo: [] });
  const latest = useRef(history.recipe);
  const base = useRef<Adjustments | null>(null);
  const stored = useRef(image.recipe);
  const { recipe } = history;

  useEffect(() => {
    latest.current = recipe;
  }, [recipe]);

  // Persist shortly after the last change; the pixels are untouched so this is
  // a small metadata write.
  useEffect(() => {
    if (recipeEquals(stored.current, recipe)) return;
    const timer = setTimeout(() => {
      stored.current = recipe;
      updateImage(image.id, (current) => ({ ...current, recipe }));
    }, PERSIST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [recipe, image.id, updateImage]);

  const change = useCallback((patch: RecipePatch) => {
    // The first change of a drag remembers where it started; commit() turns
    // that into the undo step.
    if (!base.current) base.current = latest.current;
    setHistory((current) => ({ ...current, recipe: patched(current.recipe, patch) }));
  }, []);

  const commit = useCallback(() => {
    const from = base.current;
    base.current = null;
    if (!from) return;
    setHistory((current) =>
      recipeEquals(from, current.recipe)
        ? current
        : { recipe: current.recipe, undo: [...current.undo, from], redo: [] },
    );
  }, []);

  const apply = useCallback(
    (patch: RecipePatch) => {
      change(patch);
      commit();
    },
    [change, commit],
  );

  const undo = useCallback(() => {
    base.current = null;
    setHistory((current) => {
      const previous = current.undo.at(-1);
      if (!previous) return current;
      return { recipe: previous, undo: current.undo.slice(0, -1), redo: [...current.redo, current.recipe] };
    });
  }, []);

  const redo = useCallback(() => {
    base.current = null;
    setHistory((current) => {
      const next = current.redo.at(-1);
      if (!next) return current;
      return { recipe: next, undo: [...current.undo, current.recipe], redo: current.redo.slice(0, -1) };
    });
  }, []);

  return {
    recipe,
    change,
    commit,
    apply,
    undo,
    redo,
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    isDefault: isDefaultRecipe(recipe),
  };
}
