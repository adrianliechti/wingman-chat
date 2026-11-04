import { useCallback, useEffect, useRef, useState } from "react";
import { type Adjustments, isDefaultRecipe, recipeEquals } from "../lib/recipe";
import type { Image } from "../types/canvas";

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
  base: Adjustments | null;
}

function patched(recipe: Adjustments, patch: RecipePatch): Adjustments {
  return typeof patch === "function" ? patch(recipe) : { ...recipe, ...patch };
}

/**
 * Recipe state for one image: live edits, an undo/redo stack of committed
 * steps, and persistence through `updateImage` (the collection debounces disk writes). Mount it keyed by
 * image id so switching images starts from that image's stored recipe. State
 * updaters are pure so StrictMode's double invocation can't corrupt the stacks.
 */
export function useEditor(
  image: Image,
  updateImage: (id: string, updater: (image: Image) => Image) => void,
): EditorHandle {
  const [history, setHistory] = useState<History>({ recipe: image.recipe, undo: [], redo: [], base: null });
  const stored = useRef(image.recipe);
  const { recipe } = history;

  // Publish each edit to the collection before another image can be selected.
  // A second debounce here would discard edits when this keyed editor unmounts.
  useEffect(() => {
    if (recipeEquals(stored.current, recipe)) return;
    stored.current = recipe;
    updateImage(image.id, (current) => ({ ...current, recipe }));
  }, [recipe, image.id, updateImage]);

  const change = useCallback((patch: RecipePatch) => {
    // The first change of a drag remembers where it started; commit() turns
    // that into the undo step.
    setHistory((current) => ({
      ...current,
      base: current.base ?? current.recipe,
      recipe: patched(current.recipe, patch),
    }));
  }, []);

  const commit = useCallback(() => {
    setHistory((current) => {
      if (!current.base) return current;
      return {
        ...current,
        base: null,
        undo: recipeEquals(current.base, current.recipe) ? current.undo : [...current.undo, current.base],
        redo: recipeEquals(current.base, current.recipe) ? current.redo : [],
      };
    });
  }, []);

  const apply = useCallback(
    (patch: RecipePatch) => {
      change(patch);
      commit();
    },
    [change, commit],
  );

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.base && !recipeEquals(current.base, current.recipe)) {
        return { ...current, recipe: current.base, base: null, redo: [current.recipe] };
      }
      const previous = current.undo.at(-1);
      if (!previous) return current;
      return { recipe: previous, undo: current.undo.slice(0, -1), redo: [...current.redo, current.recipe], base: null };
    });
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => {
      if (current.base && !recipeEquals(current.base, current.recipe)) return current;
      const next = current.redo.at(-1);
      if (!next) return current;
      return { recipe: next, undo: [...current.undo, current.recipe], redo: current.redo.slice(0, -1), base: null };
    });
  }, []);

  return {
    recipe,
    change,
    commit,
    apply,
    undo,
    redo,
    canUndo: history.undo.length > 0 || (history.base !== null && !recipeEquals(history.base, recipe)),
    canRedo: history.redo.length > 0 && (history.base === null || recipeEquals(history.base, recipe)),
    isDefault: isDefaultRecipe(recipe),
  };
}
